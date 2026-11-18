import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/db.ts';
import {createPlan,approvePlan,claimPlan,getPlan,Budget,recoverInterrupted} from '../server/plans.ts';
import {assertCanStartScan,releaseScan,heartbeatScan} from '../server/scan-concurrency.ts';

const caps=(source:string,group?:string)=>({purpose:'listings',assessmentMode:'quick',sources:[source],parallelGroup:group,maxPages:6,maxListings:4,maxPhotos:20,maxAddressLookups:0,maxAiCalls:0,maxReservedUsd:0});
function draft(s:Store,source:string,group?:string){return createPlan(s,caps(source,group));}
function start(s:Store,source:string,group:string){const p=draft(s,source,group);assertCanStartScan(s,p.id);approvePlan(s,p.id,'APPROVE ONE SCAN');claimPlan(s,p.id);return p;}
test('parallel locks admit three distinct quick sources in one group and retain legacy exclusion',()=>{
 const s=new Store(':memory:'),group=randomUUID();try{
  const a=start(s,'craigslist',group),b=start(s,'rew',group),c=start(s,'vada',group);
  assert.equal(s.db.prepare('SELECT owner FROM scan_lock').get()!.owner,'parallel:'+group);
  assert.equal((s.db.prepare('SELECT count(*) n FROM parallel_scan_members').get() as any).n,3);
  assert.throws(()=>assertCanStartScan(s,draft(s,'sunstar',group).id),/three/);
  assert.throws(()=>assertCanStartScan(s,draft(s,'easyrent',randomUUID()).id),/Another/);
  assert.throws(()=>assertCanStartScan(s,draft(s,'sunstar').id),/Another/);
  const budget=new Budget(s,a.id,a.caps);budget.reserve('pages');assert.equal(getPlan(s,a.id).usage.pages,1);assert.equal(getPlan(s,b.id).usage.pages,0);
  for(const p of [a,b,c]){s.db.prepare("UPDATE plans SET state='complete' WHERE id=?").run(p.id);releaseScan(s,p.id);}
  assert.equal(s.db.prepare('SELECT 1 FROM scan_lock').get(),undefined);
 }finally{s.close();}
});
test('pending approvals and closing processes reserve their sources and Chrome lane',()=>{
 const s=new Store(':memory:'),group=randomUUID();s.set('browserExtension',{paired:true});try{
  const z=draft(s,'zillow',group);approvePlan(s,z.id,'APPROVE ONE SCAN');
  assert.throws(()=>assertCanStartScan(s,draft(s,'zillow',group).id),/source.*active/);
  assert.throws(()=>assertCanStartScan(s,draft(s,'apartments',group).id),/Chrome/);
  claimPlan(s,z.id);s.db.prepare("UPDATE plans SET state='complete' WHERE id=?").run(z.id);releaseScan(s,z.id);
  const next=draft(s,'apartments',group);assert.throws(()=>assertCanStartScan(s,next.id,[z.id]),/Chrome/);assertCanStartScan(s,next.id);
 }finally{s.close();}
});
test('finishing or cancelling one owner retains sibling locks and fresh heartbeat blocks group recovery',()=>{
 const s=new Store(':memory:'),group=randomUUID();try{
  const a=start(s,'craigslist',group),b=start(s,'rew',group);
  s.db.prepare("UPDATE plans SET state='cancelled' WHERE id=?").run(a.id);releaseScan(s,a.id);
  assert.equal((s.db.prepare('SELECT count(*) n FROM parallel_scan_members').get() as any).n,1);
  assert.ok(s.db.prepare('SELECT 1 FROM scan_lock').get());
  const stale=new Date(Date.now()-700000).toISOString();s.db.prepare('UPDATE scan_lock SET heartbeat=?').run(stale);s.db.prepare('UPDATE parallel_scan_members SET heartbeat=?').run(stale);
  heartbeatScan(s,b.id);assert.throws(()=>recoverInterrupted(s),/still be active/);
  s.db.prepare('UPDATE scan_lock SET heartbeat=?').run(stale);assert.throws(()=>recoverInterrupted(s),/still be active/);
  s.db.prepare('UPDATE parallel_scan_members SET heartbeat=?').run(stale);recoverInterrupted(s);
  assert.equal(getPlan(s,b.id).state,'interrupted');assert.equal(getPlan(s,a.id).state,'cancelled');assert.equal(s.db.prepare('SELECT 1 FROM scan_lock').get(),undefined);
 }finally{s.close();}
});
test('parallel authorization never permits AI, address calls, full reviews or multiple sources',()=>{
 const s=new Store(':memory:'),group=randomUUID();try{
  for(const change of [{maxAiCalls:1},{maxAddressLookups:1},{assessmentMode:'full'},{sources:['craigslist','rew']},{refreshActiveListings:true}])assert.throws(()=>createPlan(s,{...caps('craigslist',group),...change}),/Parallel|zero AI/);
  const serial=draft(s,'craigslist');approvePlan(s,serial.id,'APPROVE ONE SCAN');claimPlan(s,serial.id);assert.throws(()=>assertCanStartScan(s,draft(s,'rew',group).id),/Another/);
 }finally{s.close();}
});

test('two cached home assessments can share a source and quick scan group but cannot access source pages',()=>{
 const s=new Store(':memory:'),group=randomUUID();try{
  const review=(home:number)=>createPlan(s,{purpose:'listings',assessmentMode:'full',phase:'assessment',cachedReviewOnly:true,fullReviewHomeIds:[home],sources:['apartments'],parallelGroup:group,billingMode:'chatgpt',maxPages:1,maxListings:1,maxPhotos:0,maxAddressLookups:0,maxAiCalls:3,maxReservedUsd:0});
  const a=review(1);approvePlan(s,a.id,'APPROVE ONE SCAN');claimPlan(s,a.id);
  const b=review(2);assertCanStartScan(s,b.id);approvePlan(s,b.id,'APPROVE ONE SCAN');claimPlan(s,b.id);
  assert.throws(()=>assertCanStartScan(s,review(3).id),/two active cached/);
  const quick=start(s,'craigslist',group);assert.equal(getPlan(s,quick.id).usage.aiCalls,0);
  const budget=new Budget(s,a.id,a.caps);for(const kind of ['pages','photos','requests'] as const)assert.throws(()=>budget.reserve(kind),/Cached assessment/);
  assert.equal(getPlan(s,a.id).usage.pages,0);assert.equal(getPlan(s,b.id).usage.aiCalls,0);
 }finally{s.close();}
});
