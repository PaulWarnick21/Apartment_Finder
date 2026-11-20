import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {Store} from '../server/db.ts';import {Budget,createPlan,approvePlan,claimPlan,getPlan} from '../server/plans.ts';
import {sourceById} from '../server/sources.ts';import {runInventorySource,type InventoryRoute} from '../server/inventory-discovery.ts';
import {releaseScan} from '../server/scan-concurrency.ts';import {readQueue} from '../server/discovery-queue.ts';

test('repeated unrecognized inventory backs off five minutes, fifteen minutes, then hourly until recognition clears it',async()=>{
 const store=new Store(':memory:'),source=sourceById('easyrent'),dir=mkdtempSync(join(tmpdir(),'inventory-route-retry-'));
 let captures=0;
 const attempt=async(html:string)=>{
  const plan=createPlan(store,{phase:'inventory',sources:[source.id],trafficPolicy:'session',maxPages:1,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});
  approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);const budget=new Budget(store,plan.id,plan.caps);
  try{
   await runInventorySource(store,source,budget,dir,undefined,{session:()=>({stopped:false,start:async()=>{},close:async()=>{},resource:async()=>{throw Error('No resource request expected');},image:async()=>{throw Error('No images expected');},html:async url=>{assert.equal(url,source.search);budget.reserve('pages');captures++;return html;}})});
   assert.equal(getPlan(store,plan.id).usage.pages,1);
  }finally{store.db.prepare("UPDATE plans SET state='partial' WHERE id=?").run(plan.id);releaseScan(store,plan.id);}
  return store.get<InventoryRoute[]>(`inventoryCoverage:${source.id}`)![0];
 };
 try{
  for(const [index,delay] of [300000,900000,3600000,3600000].entries()){
   const route=await attempt('<main><div class="loading-container">Loading</div></main>');
   assert.equal(route.status,'blocked');assert.equal(route.noCardsFailures,index+1);assert.equal(route.next,source.search);
   const actualDelay=Date.parse(route.retryAt!)-Date.parse(route.checkedAt!);assert.ok(actualDelay>=delay&&actualDelay<delay+1000,`failure ${index+1}: ${actualDelay}ms`);
   assert.equal(route.pages,index+1);assert.equal(route.recognized,0);
   // Advance only this persisted retry deadline; no sleeps, network, or counter reset.
   route.retryAt=new Date(Date.now()-1).toISOString();store.set(`inventoryCoverage:${source.id}`,[route]);
  }
  const recovered=await attempt('<main><a href="/listings/recovered-suite/">Vancouver apartment</a></main>');
  assert.equal(captures,5);assert.equal(recovered.status,'exhausted');assert.equal(recovered.noCardsFailures,0);assert.equal(recovered.retryAt,undefined);
  assert.equal(recovered.pages,5);assert.equal(recovered.recognized,1);assert.deepEqual(readQueue(store,source.id).urls,['https://www.easyrent.ca/listings/recovered-suite/']);
  assert.equal(store.health().length,0);assert.equal(store.homes().length,0);
 }finally{store.close();}
});
