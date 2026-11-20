import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {emptyUsage} from '../server/plans.ts';
import {admissionDeferredDetail,isScanAdmissionConflict,scannerOccupied,unstartedSystemCancellation,assertCoordinatorHandoff} from '../server/supervisor-admission.ts';
import {sourceRecovery} from '../server/scan-recovery.ts';

test('only system-cancelled unstarted drafts bypass source recovery',()=>{
 const plan={id:'owned',state:'cancelled',detail:admissionDeferredDetail,usage:emptyUsage(),sources:[]};
 assert.equal(unstartedSystemCancellation(plan,['owned']),true);
 assert.equal(unstartedSystemCancellation({...plan,detail:'Local approval failed; unstarted batch retained'},['owned']),true);
 assert.equal(unstartedSystemCancellation({...plan,detail:'Local snapshot lock deferred this unstarted batch; no source request was approved'},['owned']),true);
 assert.equal(unstartedSystemCancellation(plan,[]),false,'a user cancellation is not reclassified');
 assert.equal(unstartedSystemCancellation({...plan,state:'running'},['owned']),false);
 for(const field of ['pages','listings','photos','aiCalls','reservedUsd','requests'])assert.equal(unstartedSystemCancellation({...plan,usage:{...plan.usage,[field]:1}},['owned']),false,field);
 assert.equal(unstartedSystemCancellation({...plan,sources:[{source:'rew',detail:'Navigation timeout'}]},['owned']),false);
 assert.equal(unstartedSystemCancellation({...plan,detail:'Coverage validation watchdog: ten minutes without traffic progress; retry after cleanup'},['owned']),false);
 assert.ok(sourceRecovery('Worker stalled; retry after cleanup',undefined,0),'real watchdog still receives backoff');
 assert.ok(sourceRecovery('Navigation timeout',undefined,0),'real source failure still receives backoff');
});

test('coordinator handoff waits beside proven cached reviews but refuses owned work and unknown locks',()=>{
 const store=new Store(':memory:');
 const caps={purpose:'listings',assessmentMode:'full',phase:'assessment',sources:['rew'],fullReviewHomeIds:[7],cachedReviewOnly:true,parallelGroup:'reviews',billingMode:'chatgpt',maxPages:1,maxListings:1,maxPhotos:0,maxAiCalls:12,maxAddressLookups:0,maxReservedUsd:0};
 const insert=(id:string,state:string,value:unknown)=>store.db.prepare('INSERT INTO plans(id,caps,state,created_at,expires_at,usage,detail) VALUES(?,?,?,?,?,?,?)').run(id,JSON.stringify(value),state,'2026-11-19T12:00:00Z','2026-11-19T13:00:00Z',JSON.stringify(emptyUsage()),'Fixture');
 try{
  insert('old-owned','complete',{sources:['rew']});
  insert('review','approved',caps);
  assert.doesNotThrow(()=>assertCoordinatorHandoff(store,['old-owned']));
  store.db.prepare("UPDATE plans SET state='running' WHERE id='review'").run();
  store.db.prepare('INSERT INTO scan_lock VALUES(1,?,?)').run('parallel:reviews','2026-11-19T12:00:00Z');
  store.db.prepare('INSERT INTO parallel_scan_members(plan_id,group_id,source,heartbeat) VALUES(?,?,?,?)').run('review','reviews','review:7','2026-11-19T12:00:00Z');
  assert.doesNotThrow(()=>assertCoordinatorHandoff(store,['old-owned']));
  assert.equal(scannerOccupied(store),true,'handoff does not authorize a competing scan');
  store.db.prepare("UPDATE plans SET state='draft' WHERE id='old-owned'").run();
  assert.throws(()=>assertCoordinatorHandoff(store,['old-owned']),/Owned work/);
  store.db.prepare("UPDATE plans SET state='complete' WHERE id='old-owned'").run();
  store.db.prepare("UPDATE scan_lock SET owner='unknown-worker'").run();
  assert.throws(()=>assertCoordinatorHandoff(store,['old-owned']),/Unproven scan lock/);
  store.db.prepare("UPDATE scan_lock SET owner='parallel:reviews'").run();
  store.db.prepare("UPDATE parallel_scan_members SET group_id='wrong-group'").run();
  assert.throws(()=>assertCoordinatorHandoff(store,['old-owned']),/membership mismatch/);
  store.db.prepare("UPDATE parallel_scan_members SET group_id='reviews'").run();
  store.db.prepare("UPDATE plans SET caps=? WHERE id='review'").run(JSON.stringify({...caps,cachedReviewOnly:false}));
  assert.throws(()=>assertCoordinatorHandoff(store,['old-owned']),/Only existing cached/);
  assert.equal((store.db.prepare("SELECT state FROM plans WHERE id='review'").get() as {state:string}).state,'running','foreign review is never cancelled');
 }finally{store.close();}
});

test('only exact local admission errors are treated as contention',()=>{
 assert.equal(isScanAdmissionConflict(new Error('Another scan is running or needs interrupted-run recovery')),true);
 assert.equal(isScanAdmissionConflict(new Error('Another scan is running')),true);
 for(const message of ['Source paused: access warning','Local app disconnected','Another scan is running: access challenge','Plan expired or already used'])assert.equal(isScanAdmissionConflict(new Error(message)),false);
});

test('supervisor yields to selected reviews before lock claim and during group cleanup',()=>{
 const store=new Store(':memory:');
 try{
  assert.equal(scannerOccupied(store),false);
  store.db.prepare('INSERT INTO plans(id,caps,state,created_at,expires_at,usage,detail) VALUES(?,?,?,?,?,?,?)').run('review',JSON.stringify({cachedReviewOnly:true,phase:'assessment'}),'approved','2026-11-19T12:00:00Z','2026-11-19T13:00:00Z',JSON.stringify(emptyUsage()),'Selected home');
  assert.equal(scannerOccupied(store),true,'approved cached review has not claimed a lock yet');
  store.db.prepare("UPDATE plans SET state='complete' WHERE id='review'").run();
  store.db.prepare('INSERT INTO scan_lock VALUES(1,?,?)').run('parallel:review-group','2026-11-19T12:00:00Z');
  assert.equal(scannerOccupied(store),true,'closing process still owns lock');
  store.db.prepare('DELETE FROM scan_lock').run();
  store.db.prepare('INSERT INTO parallel_scan_members(plan_id,group_id,source,heartbeat) VALUES(?,?,?,?)').run('review','review-group','review:1','2026-11-19T12:00:00Z');
  assert.equal(scannerOccupied(store),true,'orphan group membership is retained for explicit recovery');
  store.db.prepare('DELETE FROM parallel_scan_members').run();
  assert.equal(scannerOccupied(store),false);
  assert.equal((store.db.prepare("SELECT state FROM plans WHERE id='review'").get() as {state:string}).state,'complete','occupancy checks never cancel the selected review');
 }finally{store.close();}
});
