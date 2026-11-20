import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,readFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {Store,hash} from '../server/db.ts';import {createPlan,approvePlan,claimPlan,Budget,getPlan} from '../server/plans.ts';
import {releaseScan} from '../server/scan-concurrency.ts';import {sourceById} from '../server/sources.ts';import {SourceSession} from '../server/transport.ts';
import {runInventorySource,inventoryRoutes} from '../server/inventory-discovery.ts';import {readQueue} from '../server/discovery-queue.ts';
const source=sourceById('facebook'),url=source.search;
function html(ids:number[]){return '<nav>private-account-data</nav><main role="main" aria-label="Collection of Marketplace items">'+ids.map(id=>`<a href="https://www.facebook.com/marketplace/item/${id}/">1 Bed Apartment $2400 Vancouver</a>`).join('')+'</main>';}
function setup(store:Store,maxPages:number,windows:number[][],warning=false){
 store.set('facebookLocationInspection',{version:3,inspected:false,reason:'Fixture has no location controls'});
 const plan=createPlan(store,{sources:['facebook'],phase:'inventory',trafficPolicy:'session',maxPages,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);const budget=new Budget(store,plan.id,plan.caps);let scrolls=0;
 class FixtureSession extends SourceSession {async start(){}async close(){}async waitForAccess(){}async html(){budget.reserve('pages');budget.reserve('requests');return html(windows[0]);}}
 const session=new FixtureSession(source,budget,'');session.page={url:()=>url,content:async()=>html(windows[Math.min(scrolls,windows.length-1)]),locator:(selector:string)=>selector==='body'?{innerText:async()=>warning&&scrolls?'Too many requests':'Marketplace rentals'}:{count:async()=>1,locator:()=>({last:()=>({scrollIntoViewIfNeeded:async()=>{},boundingBox:async()=>({x:10,y:50,width:100,height:100})})})},mouse:{move:async()=>{},wheel:async()=>{scrolls++;}},waitForTimeout:async()=>{}} as any;
 return {plan,budget,session,scrolls:()=>scrolls};
}
test('Facebook scrolls within allowance, saves only public cards, and retains a bounded replay frontier',async()=>{
 const store=new Store(':memory:'),dir=mkdtempSync(join(tmpdir(),'facebook-inventory-'));try{
  const first=setup(store,3,[[1],[1,2],[2,3]]);
  await runInventorySource(store,source,first.budget,dir,undefined,{session:()=>first.session});
  assert.equal(first.scrolls(),2);assert.equal(getPlan(store,first.plan.id).usage.pages,3);assert.equal(getPlan(store,first.plan.id).usage.requests,3);
  assert.deepEqual(readQueue(store,'facebook').urls.map(u=>u.match(/item\/(\d+)/)![1]).sort(),['1','2','3']);
  const route=inventoryRoutes(store,source)[0];assert.equal(route.status,'partial');assert.equal(route.next,url);assert.equal(route.dynamicPending,true);assert.equal(route.recognized,3,'cumulative snapshots must not inflate unique card counts');
  assert.equal(store.get<{maxScrolls:number}>('facebookInventoryDepth:'+hash(url))?.maxScrolls,2);
  for(const file of readdirSync(join(dir,'inventory',first.plan.id)))assert.ok(!readFileSync(join(dir,'inventory',first.plan.id,file),'utf8').includes('private-account-data'));
  store.db.prepare("UPDATE plans SET state='partial' WHERE id=?").run(first.plan.id);releaseScan(store,first.plan.id);
  const second=setup(store,7,[[1],[1,2],[2,3],[3,4],[3,4],[3,4]]);
  await runInventorySource(store,source,second.budget,dir,undefined,{session:()=>second.session});
  assert.equal(second.scrolls(),5);assert.equal(getPlan(store,second.plan.id).usage.pages,6);
  assert.equal(readQueue(store,'facebook').urls.length,4,'replaying earlier windows must not duplicate candidates');
  const final=inventoryRoutes(store,source)[0];assert.equal(final.status,'unverified');assert.equal(final.next,null);assert.match(final.detail,/unverified/);assert.equal(final.recognized,4);
  assert.equal(store.get<{maxScrolls:number}>('facebookInventoryDepth:'+hash(url))?.maxScrolls,5);assert.equal(store.health().some(h=>h.needs_attention),false);
 }finally{store.close();}
});
test('Facebook traffic warnings stop continuation and retain incomplete coverage',async()=>{
 const store=new Store(':memory:');try{
  const fixture=setup(store,6,[[1],[1,2]],true);
  await assert.rejects(runInventorySource(store,source,fixture.budget,mkdtempSync(join(tmpdir(),'facebook-warning-')),undefined,{session:()=>fixture.session}),/Source access challenge/);
  assert.equal(fixture.scrolls(),1);assert.equal(getPlan(store,fixture.plan.id).usage.pages,2);assert.ok(store.health().find(h=>h.source==='facebook')?.needs_attention);
  assert.equal(inventoryRoutes(store,source)[0].status,'blocked');await assert.rejects(fixture.session.facebookContinuation(),/paused|requires attention/i);assert.equal(fixture.scrolls(),1);
 }finally{store.close();}
});
test('a closed optional location-control failure does not stop a healthy Facebook feed',async()=>{
 const store=new Store(':memory:');try{
  const fixture=setup(store,4,[[1],[1,2],[1,2]]);store.db.prepare('DELETE FROM meta WHERE key=?').run('facebookLocationInspection');
  const page=fixture.session.page as any,original=page.locator;
  const button={count:async()=>1,isVisible:async()=>true,getAttribute:async()=> 'Vancouver · 72 km',click:async()=>{throw Error('Optional location control timeout');}};
  const dialog={count:async()=>0,waitFor:async()=>{}};
  page.locator=(selector:string)=>selector.includes('[role="dialog"]')?dialog:{...original(selector),getByRole:()=>button};page.keyboard={press:async()=>{}};
  const result=await runInventorySource(store,source,fixture.budget,mkdtempSync(join(tmpdir(),'facebook-optional-')),undefined,{session:()=>fixture.session});
  assert.equal(result.state,'partial');assert.equal(fixture.scrolls(),2);assert.equal(getPlan(store,fixture.plan.id).usage.pages,4);
  assert.equal(readQueue(store,'facebook').urls.length,2);assert.equal(store.health().some(h=>h.needs_attention),false);
  assert.match(store.get<{reason:string}>('facebookLocationInspection')!.reason,/unchanged approximate search/);
 }finally{store.close();}
});
