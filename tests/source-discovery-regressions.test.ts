import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {sourceById} from '../server/sources.ts';
import {listingUrl,discoveryCards,discoverSource,nextDiscovery} from '../server/source-discovery.ts';
import {mergeDiscovery,readQueue,type DiscoverySummary} from '../server/discovery-queue.ts';
import {listingSchema} from '../src/domain.ts';
import {createPlan,approvePlan,getPlan} from '../server/plans.ts';
import {runRegularPlan} from '../server/regular-worker.ts';
import {sourceStatuses} from '../server/source-status.ts';

const unit='https://www.apartments.com/example-st-unit-201/abc1234/';
const building='https://www.apartments.com/building/example-building/def5678/';
test('Apartments.com discovery accepts profiles but never directory, transit or nested suffix matches',()=>{
 const source=sourceById('apartments');
 assert.equal(listingUrl(unit,source),unit);
 assert.equal(listingUrl('https://www.apartments.com/example-community/xyz1234/',source),'https://www.apartments.com/example-community/xyz1234/');
 for(const url of [building,'https://www.apartments.com/transit/bc/station/abc1234/','https://www.apartments.com/off-campus/example/abc1234/','https://evil.example/example/abc1234/'])assert.equal(listingUrl(url,source),null);
 const html=`<a href="${building}">Building</a><a href="${unit}">Unit</a><a rel="next" href="/condos/vancouver-bc/2/">Next</a>`;
 assert.deepEqual(discoverSource(html,source),[unit]);assert.equal(nextDiscovery(html,source),'https://www.apartments.com/condos/vancouver-bc/2/');
});

test('old invalid Apartments.com queue entries cannot consume another approved visit',async()=>{
 const store=new Store(':memory:'),dir=mkdtempSync(join(tmpdir(),'af-discovery-route-')),visited:string[]=[];
 try{
  store.set('browserExtension',{});store.set('criteria',{...store.criteria,maxRent:3600});
  store.set('discoveryQueue:apartments',{urls:[building],next:null});
  const plan=createPlan(store,{sources:['apartments'],billingMode:'chatgpt',maxPages:5,maxListings:3,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0,newListingsOnly:true,targetNewListingsPerSource:1});approvePlan(store,plan.id,'APPROVE ONE SCAN');
  await runRegularPlan(store,plan.id,dir,{fail:()=>{},request:async(budget,url)=>{
   visited.push(url);budget.reserve('pages');
   if(url===building)throw Error('Building directory must not be visited as a listing');
   return {url,title:'Example Unit 201',text:'',html:url===unit?'<header id="profileHeaderWrapper">$4000 Total Monthly Price Bedrooms 1 Bathrooms 1</header><section id="descriptionSection"><p>Example rental apartment.</p></section>':`<a href="${building}">Building</a><a href="${unit}">Unit</a>`,images:[],advertisedPhotos:0,galleryComplete:true,warning:null,truncated:false,links:url===unit?[]:[building,unit]};
  }});
  assert.deepEqual(visited,[sourceById('apartments').search,unit]);assert.equal(getPlan(store,plan.id).sources[0].newListings,1);assert.equal(store.homes().length,1);
 }finally{store.close();}
});

test('EasyRent availability removes rented backlog before detail visits, without rejecting a title mentioning rented',()=>{
 const store=new Store(':memory:'),source=sourceById('easyrent');try{
  const rented='https://www.easyrent.ca/listings/old-home/',active='https://www.easyrent.ca/listings/new-home/',unknown='https://www.easyrent.ca/listings/unknown-home/';
  const html=`<nav><a href="${rented}">Old home</a></nav><article><h2><a href="${rented}">Old home</a></h2><div>Available: Rented</div><a href="${rented}">View details &gt;</a></article>
  <article><h2><a href="${active}">Previously rented furnished</a></h2><div>Price: $2400 Available: December 1</div><a href="${active}">View details &gt;</a></article>
  <article><a href="${unknown}">Home</a><div>Available: Please enquire</div></article>`;
  const cards=discoveryCards(html,source);assert.equal(cards.find(c=>c.url===rented)?.availability,'unavailable');assert.equal(cards.find(c=>c.url===unknown)?.availability,'unknown');
  assert.deepEqual(discoverSource(html,source),[active,unknown]);
  store.set('discoveryQueue:easyrent',{urls:[rented],next:null});const queue=readQueue(store,'easyrent');mergeDiscovery(store,'easyrent',queue,cards);assert.deepEqual(queue.urls,[active,unknown]);
  assert.equal(store.get<DiscoverySummary>('discoverySummary:easyrent')?.unavailable,1);
 }finally{store.close();}
});

test('zero new inventory is explained by saved, unavailable and filtered counts',()=>{
 const store=new Store(':memory:');try{
  store.set('criteria',{...store.criteria,maxRent:3600});
  const known='https://www.mybcrental.com/listings/known/';store.ingest(listingSchema.parse({source:'sunstar',sourceId:'known',url:known,title:'Saved',address:'Example',rent:2400,beds:1}));
  const queue=readQueue(store,'sunstar');mergeDiscovery(store,'sunstar',queue,[{url:known,rent:2400},{url:known},{url:'https://www.mybcrental.com/listings/price/',rent:5000},{url:'https://www.mybcrental.com/listings/rented/',availability:'unavailable',availabilityEvidence:'Rented'}]);
  const summary=store.get<DiscoverySummary>('discoverySummary:sunstar')!;assert.deepEqual([summary.recognized,summary.alreadySaved,summary.unavailable,summary.filtered,summary.queued],[3,1,1,1,0]);
  const plan=createPlan(store,{sources:['sunstar'],maxPages:2,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});store.set(`sourceResults:${plan.id}`,[{source:'sunstar',state:'partial',detail:'No unseen candidates in this scope.',newListings:0}]);
  const status=sourceStatuses(store).find(s=>s.id==='sunstar')!;assert.equal(status.lastScan?.detail,'No unseen candidates in this scope.');assert.equal(status.discovery?.alreadySaved,1);assert.equal(status.paused,false);
 }finally{store.close();}
});
