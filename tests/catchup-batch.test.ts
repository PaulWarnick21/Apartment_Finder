import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {quickCatchupBatch} from '../server/catchup-batch.ts';
import {Store} from '../server/db.ts';
import {approvePlan,Budget,createPlan,getPlan} from '../server/plans.ts';
import {concurrentSourceBudgets} from '../server/source-budget.ts';
import {runRegularPlan} from '../server/regular-worker.ts';

const remaining={pages:600,listings:400,photos:8000,aiCalls:1500};
const sourceIds=['easyrent','sunstar','zumper'];
const quickCaps={assessmentMode:'quick',purpose:'listings',trafficPolicy:'session',billingMode:'chatgpt',maxAiCalls:0,maxReservedUsd:0,maxAddressLookups:0,refreshActiveListings:false};

test('quick catch-up shares existing aggregate allowances and target among at most three phase sources',()=>{
 const choice={phase:'assessment' as const,source:'sunstar'},batch=quickCatchupBatch(choice,['easyrent','sunstar','zumper','rew'],remaining);
 assert.deepEqual(batch.sources,['sunstar','easyrent','zumper']);
 assert.equal(batch.maxPages,90);assert.equal(batch.maxListings,60);assert.equal(batch.maxPhotos,1500);
 assert.equal(Object.values(batch.targetNewListingsBySource!).reduce((sum,n)=>sum+n,0),30);
 assert.deepEqual(remaining,{pages:600,listings:400,photos:8000,aiCalls:1500});
 assert.deepEqual(quickCatchupBatch(choice,['easyrent','zumper'],remaining,1).sources,['sunstar']);
});

test('small daily remainders produce valid plans whose per-source targets fit reserved worker shares',()=>{
 for(const allowance of [remaining,{...remaining,pages:6},{...remaining,listings:4},{...remaining,pages:4,photos:2},{pages:2,listings:1,photos:1,aiCalls:0}]){
  const batch=quickCatchupBatch({phase:'assessment',source:sourceIds[0]},sourceIds,allowance),store=new Store(':memory:');
  try{
   assert.ok(batch.sources.length<=Math.floor(allowance.pages/2));assert.ok(batch.sources.length<=allowance.photos);
   const plan=createPlan(store,{...quickCaps,...batch,phase:'assessment',newListingsOnly:true,unitListingsOnly:true});
   const shares=concurrentSourceBudgets(new Budget(store,plan.id,plan.caps),batch.sources,batch.sources.length>1);
   for(const share of shares)assert.ok(batch.targetNewListingsBySource![share.source]<=share.limits.listings);
   assert.ok(Object.values(batch.targetNewListingsBySource!).reduce((sum,n)=>sum+n,0)<=Math.min(30,allowance.listings));
   for(const [cap,kind] of [['maxPages','pages'],['maxListings','listings'],['maxPhotos','photos']] as const)assert.ok(batch[cap]<=allowance[kind]);
  }finally{store.close();}
 }
 assert.throws(()=>quickCatchupBatch({phase:'assessment',source:'easyrent'},sourceIds,{...remaining,photos:0}),/Daily allowance/);
});

test('parallel inventory shares eight pages without collecting homes, photos or AI',async()=>{
 const batch=quickCatchupBatch({phase:'inventory',source:sourceIds[0]},sourceIds,remaining),store=new Store(':memory:'),visited=new Set<string>();
 try{
  assert.equal(batch.maxPages,8);assert.equal(batch.maxListings,3);assert.equal(batch.maxPhotos,0);
  assert.deepEqual(quickCatchupBatch({phase:'inventory',source:sourceIds[0]},sourceIds,{...remaining,listings:1}).sources,[sourceIds[0]]);
  const plan=createPlan(store,{...quickCaps,...batch,phase:'inventory'});approvePlan(store,plan.id,'APPROVE ONE SCAN');
  await runRegularPlan(store,plan.id,mkdtempSync(join(tmpdir(),'catchup-batch-')),undefined,{session:(source,budget)=>({stopped:false,start:async()=>{},close:async()=>{},html:async()=>{budget.reserve('pages');visited.add(source.id);return '<main>No matching rental listings</main>';},resource:async()=>{throw Error('Inventory must not download resources');},image:async()=>{throw Error('Inventory must not download photos');}})});
  assert.deepEqual([...visited].sort(),[...sourceIds].sort());assert.equal(store.homes().length,0);
  const usage=getPlan(store,plan.id).usage;assert.ok(usage.pages<=8);assert.equal(usage.listings,0);assert.equal(usage.photos,0);assert.equal(usage.aiCalls,0);
  assert.equal(store.get<{concurrency:number}>(`sourceExecution:${plan.id}`)?.concurrency,3);
  const allocation=store.get<{selectionCount:number;lastSelected:Record<string,string>}>('sourceAllocation')!;
  assert.equal(allocation.selectionCount,1);for(const source of sourceIds)assert.ok(allocation.lastSelected[source]);
 }finally{store.close();}
});
