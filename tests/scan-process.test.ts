import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {createPlan,approvePlan,getPlan,claimPlan} from '../server/plans.ts';
import {ChromeJobs} from '../server/chrome-jobs.ts';
import {ScanProcesses,finishClosedWorker} from '../server/scan-process.ts';

test('known-closed worker crash releases its lock without authorizing a restart',()=>{
 const store=new Store(':memory:');try{
  const p=createPlan(store,{sources:['vada'],assessmentMode:'quick',maxPages:2,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});
  approvePlan(store,p.id,'APPROVE ONE SCAN');claimPlan(store,p.id);
  assert.equal(store.db.prepare('SELECT count(*) n FROM scan_lock').get()!.n,1);
  finishClosedWorker(store,p.id);
  assert.equal(getPlan(store,p.id).state,'interrupted');assert.equal(store.db.prepare('SELECT count(*) n FROM scan_lock').get()!.n,0);
  assert.equal(store.db.prepare("SELECT count(*) n FROM plans WHERE state IN ('approved','running')").get()!.n,0);
 }finally{store.close();}
});
test('isolated regular worker honors persisted source pauses without network and releases its lock',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'af-worker-process-')),store=new Store(join(dir,'apartments.sqlite')),jobs=new ChromeJobs(store),workers=new ScanProcesses(store,dir,jobs);
 try{
  const plan=createPlan(store,{sources:['zillow'],billingMode:'chatgpt',maxPages:2,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});
  store.pause('zillow','Fixture pause; never contact a source',true);approvePlan(store,plan.id,'APPROVE ONE SCAN');assert.equal(workers.hasActive,false);workers.start(plan.id);assert.equal(workers.hasActive,true,'starting child is active before it can claim the SQLite lock');
  const deadline=Date.now()+30000;while(Date.now()<deadline&&workers.hasActive)await new Promise(done=>setTimeout(done,50));
  const finished=getPlan(store,plan.id);assert.equal(finished.state,'partial');assert.equal(finished.usage.pages,0);assert.equal(finished.usage.requests,0);assert.equal(finished.usage.aiCalls,0);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM scan_lock').get()!.n,0);assert.match(finished.detail,/paused/);
  const exitDeadline=Date.now()+5000;while(workers.hasActive&&Date.now()<exitDeadline)await new Promise(done=>setTimeout(done,20));assert.equal(workers.hasActive,false,'process state clears after the exit handler');
 }finally{await workers.close();store.close();}
});

test('spawn failure clears the starting process and consumes approval without a scan',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'af-worker-spawn-failure-')),store=new Store(join(dir,'apartments.sqlite')),jobs=new ChromeJobs(store),workers=new ScanProcesses(store,dir,jobs);
 const executable=process.execPath;
 try{
  const plan=createPlan(store,{sources:['zillow'],billingMode:'chatgpt',maxPages:2,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});
  store.pause('zillow','Fixture pause; no source access permitted',true);approvePlan(store,plan.id,'APPROVE ONE SCAN');
  try{process.execPath=join(dir,'nonexistent-worker-runtime.exe');workers.start(plan.id);assert.equal(workers.hasActive,true);}finally{process.execPath=executable;}
  const deadline=Date.now()+5000;while(workers.hasActive&&Date.now()<deadline)await new Promise(done=>setTimeout(done,20));
  assert.equal(workers.hasActive,false,'error followed by close must remove an unspawned child');
  const finished=getPlan(store,plan.id);assert.equal(finished.state,'interrupted');assert.equal(finished.usage.pages,0);assert.equal(finished.usage.requests,0);assert.equal(finished.usage.aiCalls,0);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM scan_lock').get()!.n,0);
 }finally{process.execPath=executable;await workers.close();store.close();}
});
