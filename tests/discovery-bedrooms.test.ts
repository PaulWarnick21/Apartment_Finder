import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Store} from '../server/db.ts';import {sourceById} from '../server/sources.ts';
import {discoveryBedrooms} from '../server/discovery-bedrooms.ts';
import {discoveryCards} from '../server/source-discovery.ts';
import {discoveryIntakeFailure,readQueue} from '../server/discovery-queue.ts';
import {createPlan,approvePlan,getPlan} from '../server/plans.ts';import {runRegularPlan} from '../server/regular-worker.ts';
import {areaSearchRoute,intakeSearchUrls} from '../server/search-area.ts';import {inventoryRoutes,resetInventoryCycle} from '../server/inventory-discovery.ts';
const rew=sourceById('rew'),url='https://www.rew.ca/rentals/123/example';
function configure(s:Store){s.set('reviewWorkflow',{mode:'quick-first'});s.set('criteria',{...s.criteria,quickIntake:{minRent:1000,maxRent:3500,minPhotos:2,allowedBeds:[1,2]}});}

test('search-card bedrooms recognize source labels while ranges and conflicts remain unknown',()=>{
 for(const value of ['3 bd','3BR','3-bed apartment','three-bedroom home','3 bdrm'])assert.equal(discoveryBedrooms(value),3,value);
 for(const value of ['1–3 beds','1 / 2 bedrooms','1 and 2 bedrooms','3+ beds','Studio or 2 beds','1 bed and 3 beds','1.5 bedrooms','2.5 bedrooms','Bedrooms unknown'])assert.equal(discoveryBedrooms(value),null,value);
 assert.equal(discoveryBedrooms('2 beds, 3 baths'),2);assert.equal(discoveryBedrooms('0 bedrooms'),0);
});
test('a photo-only link cannot erase later REW bedroom facts',()=>{
 const cards=discoveryCards(`<a href="${url}"><img></a><article><a href="${url}">Apartment</a><ul><li>3 bd</li><li>$2800</li></ul></article>`,rew);
 assert.equal(cards.length,1);assert.equal(cards[0].beds,3);
 const s=new Store(':memory:');try{configure(s);assert.match(discoveryIntakeFailure(s,cards[0])!,/bedroom/);}finally{s.close();}
});
test('Zumper structured bedrooms survive empty visible anchors and retain explicit conflicts',()=>{
 const source=sourceById('zumper'),path='/listings/1234567p/example';
 const state={currentSearch:{listables:{listables:[{url:path,min_price:2400,max_price:2400,min_bedrooms:3,max_bedrooms:3}]}}};
 const html=(label:string)=>`<a href="${path}">${label}</a><script>window.__PRELOADED_STATE__ = ${JSON.stringify(state)};</script>`;
 assert.equal(discoveryCards(html('Apartment'),source)[0].beds,3);
 assert.equal(discoveryCards(html('1 bedroom'),source)[0].beds,null);
});

test('conflicting Zumper bedroom counts survive queue filtering and repeated result rows',()=>{
 const source=sourceById('zumper'),path='/listings/1234567p/example',s=new Store(':memory:');
 try{configure(s);
  for(const [visible,structured] of [[3,1],[1,3]])for(const copies of [1,2]){
   const row={url:path,min_price:2400,max_price:2400,min_bedrooms:structured,max_bedrooms:structured};
   const state={currentSearch:{listables:{listables:Array(copies).fill(row)}}};
   const html=`<a href="${path}">${visible} bedroom apartment</a><script>window.__PRELOADED_STATE__ = ${JSON.stringify(state)};</script>`;
   const card=discoveryCards(html,source)[0];
   assert.equal(card.beds,null);assert.equal(discoveryIntakeFailure(s,card),null);
   s.set('discoveryQueue:zumper',{urls:[card.url],next:null,cards:{[card.url]:card}});
   assert.deepEqual(readQueue(s,'zumper').urls,[card.url]);
  }
 }finally{s.close();}
});
test('resuming a saved three-bedroom queue spends no detail, photo, listing or AI allowance',async()=>{
 const s=new Store(':memory:');try{
  configure(s);s.set('discoveryQueue:rew',{urls:[url],next:null,cards:{[url]:{url,title:'Three-bedroom apartment',beds:null,rent:2800}}});
  assert.deepEqual(readQueue(s,'rew').urls,[]);
  const p=createPlan(s,{phase:'assessment',assessmentMode:'quick',sources:['rew'],maxPages:2,maxListings:2,maxPhotos:3,maxAiCalls:0,maxReservedUsd:0,newListingsOnly:true});approvePlan(s,p.id,'APPROVE ONE SCAN');
  await runRegularPlan(s,p.id,mkdtempSync(join(tmpdir(),'af-bedrooms-')),undefined,{session:()=>({stopped:false,start:async()=>{},close:async()=>{},html:async()=>{throw Error('Known three-bedroom card must not fetch details');},resource:async()=>{throw Error('No resource expected');},image:async()=>{throw Error('No photos expected');}})});
  const plan=getPlan(s,p.id);assert.equal(plan.usage.pages,0);assert.equal(plan.usage.listings,0);assert.equal(plan.usage.photos,0);assert.equal(plan.usage.aiCalls,0);assert.equal(s.homes().length,0);
 }finally{s.close();}
});
test('unknown and conflicting bedroom evidence remains eligible for detail inspection',()=>{
 const s=new Store(':memory:');try{configure(s);
  for(const card of [{url,title:'1–3 bedroom options',beds:null},{url,title:'Apartment',beds:null},{url,title:'1 bedroom apartment',beds:3}])assert.equal(discoveryIntakeFailure(s,card),null);
 }finally{s.close();}
});
test('superseded broad searches retain provenance and frontiers without reopening during refresh',()=>{
 const s=new Store(':memory:'),source=sourceById('craigslist'),broad=source.search,filtered=broad+'&min_bedrooms=1&max_bedrooms=2';
 try{
  s.set('searchAreaPolicy',{mode:'source-filters',regions:['downtown-vancouver'],existingHomeIds:[],configuredAt:new Date().toISOString(),sourceRoutes:{craigslist:[broad,filtered].map(url=>({url,region:'downtown-vancouver',scope:'vancouver-approximate'}))}});
  const old={url:broad,next:broad+'#gallery~66',visited:[broad],pages:7,recognized:200,status:'superseded',supersededBy:[filtered],detail:'Replaced by validated bedroom search'};
  s.set('inventoryCoverage:craigslist',[old]);
  assert.ok(areaSearchRoute(s,'craigslist',broad));assert.deepEqual(intakeSearchUrls(s,source),[filtered]);assert.deepEqual(inventoryRoutes(s,source).map(r=>r.url),[filtered]);
  resetInventoryCycle(s,source);assert.deepEqual(s.get<any[]>('inventoryCoverage:craigslist')!.find(r=>r.url===broad),old);
 }finally{s.close();}
});
