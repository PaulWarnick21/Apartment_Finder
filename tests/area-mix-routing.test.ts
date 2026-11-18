import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {catchupAreaWork,prioritizeInventoryAreas} from '../server/area-mix-routing.ts';
import {chooseQuickCatchupPhase} from '../server/catchup-policy.ts';
import {quickCatchupBatch} from '../server/catchup-batch.ts';
import {createPlan,approvePlan,claimPlan,Budget,getPlan} from '../server/plans.ts';
import {inventoryRoutes,runInventorySource} from '../server/inventory-discovery.ts';
import {sourceById} from '../server/sources.ts';

const downtown='https://www.rew.ca/rentals/areas/downtown-west-vancouver-bc',north='https://www.rew.ca/rentals/areas/north-vancouver-bc';
const route=(url:string,status='pending',checkedAt?:string)=>({url,next:status==='pending'?url:null,status,checkedAt,visited:[],pages:0,recognized:0,detail:'Fixture route'});
const card=(url:string,region:string)=>({searchUrl:url,searchRegion:region});
function setup(){
 const store=new Store(':memory:');store.set('reviewWorkflow',{mode:'quick-first'});
 store.set('searchAreaPolicy',{mode:'source-filters',regions:['downtown-vancouver','north-vancouver','west-vancouver'],existingHomeIds:[],configuredAt:'2026-11-18T00:00:00Z',sourceRoutes:{rew:[{url:north,region:'north-vancouver'},{url:downtown,region:'downtown-vancouver'}],craigslist:[{url:'https://www.craigslist.org/search/city/north-vancouver-bc?cat=apa',region:'north-vancouver'}]}});
 store.set('areaMixPolicy',{downtownShare:.85,configuredAt:'2026-11-18T00:00:00Z',baselineHomeIds:[]});return store;
}

test('regional inventory priority outranks freshness while preserving every route',()=>{
 const store=setup();try{
  const routes=[route(north),route(downtown,'pending','2026-11-18T01:00:00Z')];
  assert.deepEqual(prioritizeInventoryAreas(store,'rew',routes).map(item=>item.url),[downtown,north]);
  assert.deepEqual(routes.map(item=>item.url),[north,downtown]);
  store.db.prepare("DELETE FROM meta WHERE key='areaMixPolicy'").run();
  assert.deepEqual(prioritizeInventoryAreas(store,'rew',routes).map(item=>item.url),[north,downtown]);
 }finally{store.close();}
});

test('downtown discovery runs before an available North/West candidate queue',()=>{
 const store=setup();try{
  const work=catchupAreaWork(store,['rew'],['craigslist'],[{source:'rew',routes:[route(downtown)],candidates:[]},{source:'craigslist',routes:[],candidates:[{area:'North Vancouver',address:'100 Example Street, North Vancouver'}]}]);
  assert.deepEqual(work.inventory,['rew']);assert.deepEqual(work.candidates,[]);
  const chosen=chooseQuickCatchupPhase(work.inventory,work.candidates,[],{selectionCount:0,lastSelected:{}});
  assert.equal(chosen?.source,'rew');assert.equal(chosen?.phase,'inventory');
 }finally{store.close();}
});

test('parallel catch-up peers stay inside the desired geographic work pool',()=>{
 const store=setup();try{
  const work=catchupAreaWork(store,[],['craigslist','rew'],[{source:'rew',routes:[],candidates:[card(downtown,'downtown-vancouver')]},{source:'craigslist',routes:[],candidates:[{area:'North Vancouver'}]}]);
  assert.deepEqual(work.candidates,['rew']);
  const batch=quickCatchupBatch({phase:'assessment',source:work.candidates[0]},work.candidates,{pages:600,listings:400,photos:8000,aiCalls:0});
  assert.deepEqual(batch.sources,['rew']);assert.equal(batch.maxPages,90);assert.equal(batch.maxListings,60);assert.equal(batch.maxPhotos,1500);
 }finally{store.close();}
});

test('an unresolved downtown coverage gap does not fall through to North/West intake',()=>{
 const store=setup();try{
  const work=catchupAreaWork(store,[],['craigslist'],[{source:'rew',routes:[route(downtown,'blocked')],candidates:[]},{source:'craigslist',routes:[],candidates:[{area:'North Vancouver'}]}]);
  assert.deepEqual(work.inventory,[]);assert.deepEqual(work.candidates,[]);assert.match(work.reason!,/unresolved geographic coverage/);
 }finally{store.close();}
});

test('checked downtown exhaustion releases the North/West work pool; absent policy keeps original scheduling',()=>{
 const store=setup();try{
  store.set('inventoryCoverage:rew',[route(downtown,'exhausted'),route(north)]);
  const rows=[{source:'rew',routes:[route(north)],candidates:[card(north,'north-vancouver')]}];
  const fallback=catchupAreaWork(store,['rew'],['rew'],rows);
  assert.equal(fallback.focus,'north-west');assert.deepEqual(fallback.inventory,['rew']);assert.deepEqual(fallback.candidates,['rew']);
  store.db.prepare("DELETE FROM meta WHERE key='areaMixPolicy'").run();
  assert.deepEqual(catchupAreaWork(store,['missing','rew'],['craigslist','rew'],rows),{inventory:['missing','rew'],candidates:['craigslist','rew']});
 }finally{store.close();}
});

test('inventory spends a bounded page allowance on the preferred route without creating homes',async()=>{
 const store=setup();try{
  const plan=createPlan(store,{phase:'inventory',assessmentMode:'quick',sources:['rew'],trafficPolicy:'session',maxPages:1,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0,maxAddressLookups:0});
  approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);const budget=new Budget(store,plan.id,plan.caps),visited:string[]=[];
  await runInventorySource(store,sourceById('rew'),budget,mkdtempSync(join(tmpdir(),'area-route-')),undefined,{session:()=>({stopped:false,start:async()=>{},close:async()=>{},html:async url=>{visited.push(url);budget.reserve('pages');return '<body>No matching listings</body>';},resource:async()=>{throw Error('No resources');},image:async()=>{throw Error('No photos');}})});
  assert.deepEqual(visited,[downtown]);assert.equal(store.homes().length,0);assert.equal(getPlan(store,plan.id).usage.aiCalls,0);
  const routes=inventoryRoutes(store,sourceById('rew'));assert.equal(routes.find(item=>item.url===downtown)?.status,'exhausted');assert.equal(routes.find(item=>item.url===north)?.status,'pending');
 }finally{store.close();}
});
