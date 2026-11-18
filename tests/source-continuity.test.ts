import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Page} from 'playwright';
import {Store} from '../server/db.ts';
import {sourceById,allowedUrl} from '../server/sources.ts';
import {discoveryEmpty,facetPagination} from '../server/source-discovery.ts';
import {createPlan,approvePlan,claimPlan,Budget} from '../server/plans.ts';
import {runInventorySource,inventoryRoutes} from '../server/inventory-discovery.ts';
import {readQueue} from '../server/discovery-queue.ts';
import {SourceSession} from '../server/transport.ts';
import {sourceStatuses} from '../server/source-status.ts';

const north='https://www.easyrent.ca/listings/?_city=north-vancouver';
const facet=(page:number,last=2)=>`<body><div class="facetwp-template"><article><a href="/listings/home-${page}/">North Vancouver 1 bedroom $2400 Available: Now</a></article></div><div class="facetwp-type-pager"><div class="facetwp-pager"><a class="facetwp-page active" data-page="${page}">${page}</a>${page<last?`<a class="facetwp-page last" data-page="${last}">${last}</a><a class="facetwp-page next" data-page="${page+1}">Next »</a>`:''}</div></div></body>`;
const vadaUrl='https://vadapm.com/search/for-rent/north-vancouver';
const vadaEmpty=`<body><form id="search-filters-for-rent-form" action="/search/for-rent/north-vancouver"></form><main class="c-search-results__main"><h3>More Rentals Coming Soon</h3><p>Bookmark this page.</p><a href="/search/for-rent">Other cities</a></main><footer>${'Frequently asked questions about rentals. '.repeat(100)}</footer></body>`;
function setup(source='easyrent',url=north){const store=new Store(':memory:');store.set('searchAreaPolicy',{mode:'source-filters',regions:['north-vancouver'],existingHomeIds:[],sourceRoutes:{[source]:[{url,region:'north-vancouver'}]}});return store;}
function budget(store:Store,source='easyrent',pages=3){const plan=createPlan(store,{sources:[source],phase:'inventory',assessmentMode:'quick',trafficPolicy:'session',maxPages:pages,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);return new Budget(store,plan.id,plan.caps);}

test('VADA scoped empty results are recognized despite long FAQs, never from unrelated or hidden text',()=>{
 const source=sourceById('vada');assert.equal(discoveryEmpty(vadaEmpty,source,vadaUrl),true);
 for(const html of [vadaEmpty.replace('class="c-search-results__main"','class="footer"'),vadaEmpty.replace('<h3>','<h3 hidden>'),vadaEmpty.replace('north-vancouver"','west-vancouver"')])assert.equal(discoveryEmpty(html,source,vadaUrl),false);
});

test('empty VADA results complete only the checked selected-area route',async()=>{
 const store=setup('vada',vadaUrl),b=budget(store,'vada');try{
  const result=await runInventorySource(store,sourceById('vada'),b,mkdtempSync(join(tmpdir(),'vada-empty-')),undefined,{session:()=>({stopped:false,start:async()=>{},close:async()=>{},html:async()=>{b.reserve('pages');return vadaEmpty;},resource:async()=>{throw Error('No resource request');},image:async()=>{throw Error('No photos');}})});
  assert.equal(result.state,'complete');assert.equal(readQueue(store,'vada').urls.length,0);assert.equal(inventoryRoutes(store,sourceById('vada'))[0].status,'exhausted');
 }finally{store.close();}
});

test('EasyRent cannot be called exhausted while its href-less pager advertises further pages',async()=>{
 const store=setup(),b=budget(store);try{
  assert.deepEqual(facetPagination(facet(1,5),sourceById('easyrent')),{current:1,last:5,next:2,exhausted:false});
  const result=await runInventorySource(store,sourceById('easyrent'),b,mkdtempSync(join(tmpdir(),'facet-gap-')),undefined,{session:()=>({stopped:false,start:async()=>{},close:async()=>{},html:async()=>{b.reserve('pages');return facet(1,5);},resource:async()=>'',image:async()=>{throw Error('No photos');}})});
  assert.equal(result.state,'partial');assert.equal(inventoryRoutes(store,sourceById('easyrent'))[0].status,'unverified');
 }finally{store.close();}
});

test('EasyRent follows the real Next control, retains area provenance and accounts each page once',async()=>{
 const store=setup(),source=sourceById('easyrent'),b=budget(store);let current=1,url=north,clicks=0;
 class FixtureSession extends SourceSession{
  async start(){this.page={url:()=>url,content:async()=>facet(current),waitForFunction:async()=>{},locator:(selector:string)=>({first:()=>({click:async()=>{assert.match(selector,/data-page="2"/);clicks++;current=2;url=north+'&_paged=2';}}),innerText:async()=>''})} as unknown as Page;}
  async close(){}async waitForAccess(){}async html(){b.reserve('pages');return facet(current);}
 }
 try{
  await runInventorySource(store,source,b,mkdtempSync(join(tmpdir(),'facet-next-')),undefined,{session:()=>new FixtureSession(source,b,'')});
  const queue=readQueue(store,source.id),route=inventoryRoutes(store,source)[0];
  assert.equal(clicks,1);assert.equal(queue.urls.length,2);assert.equal(route.status,'exhausted');assert.equal(route.pages,2);
  assert.equal(queue.cards?.['https://www.easyrent.ca/listings/home-2/']?.searchRegion,'north-vancouver');
 }finally{store.close();}
});

test('EasyRent next pages cannot change the selected city or bypass a source pause',async()=>{
 for(const paused of [false,true]){const store=setup(),source=sourceById('easyrent'),b=budget(store);let url=north,clicks=0;
  const session=new SourceSession(source,b,'');session.waitForAccess=async()=>{};
  session.page={url:()=>url,content:async()=>facet(1),waitForFunction:async()=>{},locator:()=>({first:()=>({click:async()=>{clicks++;url='https://www.easyrent.ca/listings/?_city=burnaby&_paged=2';}})})} as unknown as Page;
  try{if(paused)store.pause(source.id,'Warning',true);await assert.rejects(()=>session.inventoryContinuation(),paused?/paused/:/geographic/);assert.equal(clicks,paused?0:1);}finally{store.close();}
 }
});

test('Austeville map assets are rendering-only and cannot become listing or photo hosts',()=>{
 const s=sourceById('austeville'),url='https://maps.googleapis.com/maps/api/js';
 assert.equal(allowedUrl(url,s.assetHosts??[]),true);assert.equal(allowedUrl(url,s.hosts),false);assert.equal(allowedUrl(url,s.mediaHosts),false);
});

test('source status holds unscoped sources and queues out, and ignores full reviews as discovery success',()=>{
 const store=setup();try{
  store.set('discoveryQueue:kijiji',{urls:['https://www.kijiji.ca/old'],next:null});
  let status=sourceStatuses(store).find(s=>s.id==='kijiji')!;
  assert.equal(status.ready,false);assert.equal(status.queued,0);assert.match(status.scanMethod,/filter/);
  const p=createPlan(store,{sources:['easyrent'],assessmentMode:'full',fullReviewHomeIds:[1],phase:'assessment',maxPages:2,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});
  store.set('sourceResults:'+p.id,[{source:'easyrent',state:'complete',detail:'Saved assessment complete'}]);
  status=sourceStatuses(store).find(s=>s.id==='easyrent')!;assert.equal(status.ready,true);assert.equal(status.lastScan,undefined);
 }finally{store.close();}
});
