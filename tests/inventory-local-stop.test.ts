import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {Store} from '../server/db.ts';import {createPlan,approvePlan,claimPlan,Budget,getPlan} from '../server/plans.ts';
import {SourceBudget} from '../server/source-budget.ts';import {SourceSession} from '../server/transport.ts';
import {sourceById} from '../server/sources.ts';import {runInventorySource,inventoryRoutes} from '../server/inventory-discovery.ts';
import {releaseScan} from '../server/scan-concurrency.ts';import {readQueue} from '../server/discovery-queue.ts';import {isLocalScanStop} from '../server/scan-stop.ts';

const source=sourceById('zumper'),url=source.search;
const row={url:'/listings/12345/one-bedroom-vancouver-bc'};
const html='<script>window.__PRELOADED_STATE__ = '+JSON.stringify({currentSearch:{pathname:new URL(url).pathname,searchString:'',hasMoreListables:true,listables:{listables:[row],matching:50,query:{offset:0,limit:25}}}})+';</script>';
const caps={phase:'inventory',sources:['zumper'],trafficPolicy:'session',maxPages:2,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0};
test('Zumper hydration hitting its source allowance retains the frontier without pausing the website',async()=>{
 const store=new Store(':memory:');try{
  const plan=createPlan(store,caps);approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);
  const budget=new SourceBudget(new Budget(store,plan.id,plan.caps),2,'zumper');let scrolls=0;
  class FixtureSession extends SourceSession {async start(){}async close(){}async waitForAccess(){}}
  const session=new FixtureSession(source,budget,'');session.page={goto:async()=>({status:()=>200}),content:async()=>html,on:()=>{},off:()=>{},locator:()=>({last:()=>({scrollIntoViewIfNeeded:async()=>{scrolls++;}})})} as any;
  const result=await runInventorySource(store,source,budget,mkdtempSync(join(tmpdir(),'inventory-local-')),undefined,{session:()=>session});
  assert.equal(result.state,'partial');assert.equal(session.stopped,false);assert.equal(scrolls,0);assert.equal(store.health().length,0);
  assert.equal(getPlan(store,plan.id).usage.pages,1);assert.equal(budget.remaining('pages'),0);
  const route=inventoryRoutes(store,source)[0];assert.equal(route.status,'partial');assert.equal(route.next,url);assert.deepEqual(route.visited,[]);assert.match(route.detail,/Per-source pages cap/);
  store.db.prepare("UPDATE plans SET state='partial' WHERE id=?").run(plan.id);releaseScan(store,plan.id);
  const next=createPlan(store,caps);approvePlan(store,next.id,'APPROVE ONE SCAN');claimPlan(store,next.id);const resumed=new Budget(store,next.id,next.caps),visits:string[]=[];
  await runInventorySource(store,source,resumed,mkdtempSync(join(tmpdir(),'inventory-resumed-')),undefined,{session:()=>({stopped:false,start:async()=>{},close:async()=>{},resource:async()=>'',image:async()=>{throw Error('No photos');},html:async address=>{visits.push(address);resumed.reserve('pages',2);return '<a href="'+row.url+'">Rental</a>';}})});
  assert.deepEqual(visits,[url]);assert.equal(readQueue(store,'zumper').urls.length,1);assert.equal(store.health().length,0);
 }finally{store.close();}
});
test('only explicit local authorization stops are distinguished from website failures',()=>{
 for(const text of ['pages cap reached; remaining work deferred','Per-source requests cap reached; remaining work deferred','Per-source page cap reached','Scan deadline reached; remaining work retained','Scan stopped','Local request allowance reached; remaining work deferred'])assert.equal(isLocalScanStop(new Error(text)),true,text);
 for(const text of ['Source access challenge','HTTP 429','Navigation timeout','Website says pages cap reached','No listing cards recognized'])assert.equal(isLocalScanStop(new Error(text)),false,text);
});
