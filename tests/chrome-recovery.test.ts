import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {ChromeJobs} from '../server/chrome-jobs.ts';
import {createPlan,approvePlan,getPlan} from '../server/plans.ts';
import {recoverChromeSource} from '../server/chrome-recovery.ts';

for(const outcome of ['success','warning','empty','truncated','cancelled'] as const)test(`Apartments.com one-page recovery: ${outcome}`,async()=>{
 const db=new Store(':memory:'),jobs=new ChromeJobs(db),dir=await mkdtemp(join(tmpdir(),'af-recovery-'));
 const search='https://www.apartments.com/downtown-vancouver-vancouver-bc/',listing='https://www.apartments.com/example-unit-201/abc1234/';
 try{
  db.set('browserExtension',{id:'a'.repeat(32),tokenHash:'test'});db.pause('apartments','Previous access warning',true,Date.now()-1);
  db.set('searchAreaPolicy',{mode:'source-filtered',regions:['downtown-vancouver'],sourceRoutes:{apartments:[{url:search,region:'downtown-vancouver'}]}});
  const queue={urls:[listing],next:search+'2/',cards:{[listing]:{url:listing,searchUrl:search}},freshCheckedAt:'2026-11-01T00:00:00.000Z'};
  db.set('discoveryQueue:apartments',queue);
  const p=createPlan(db,{purpose:'access-check',sources:['apartments'],billingMode:'chatgpt',maxPages:1,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0},{accessRecovery:true});
  await assert.rejects(recoverChromeSource(db,p.id,dir,jobs),/approved/);assert.equal(jobs.poll().job,null);
  approvePlan(db,p.id,'APPROVE ONE SCAN');const done=recoverChromeSource(db,p.id,dir,jobs),job=jobs.poll().job!;
  assert.equal(job.url,search);assert.equal(job.kind,'discovery');assert.equal(job.maxPhotos,0);
  if(outcome==='cancelled'){db.db.prepare("UPDATE plans SET state='cancelled' WHERE id=?").run(p.id);jobs.fail('Cancelled',p.id);}
  else jobs.result({id:job.id,snapshot:{url:search,title:'Rentals',text:outcome==='warning'?'Access denied':'Rentals',html:outcome==='empty'?'<main>No results</main>':`<a href="${listing}">Apartment</a>`,images:[],advertisedPhotos:0,galleryComplete:false,warning:outcome==='warning'?'Access warning: Access denied':null,truncated:outcome==='truncated',links:[]}});
  await done;
  assert.deepEqual(db.get('discoveryQueue:apartments'),queue);assert.equal(db.homes().length,0);
  assert.equal(getPlan(db,p.id).usage.pages,1);assert.equal(getPlan(db,p.id).usage.photos,0);assert.equal(getPlan(db,p.id).usage.aiCalls,0);
  assert.equal(getPlan(db,p.id).state,outcome==='success'?'complete':outcome==='cancelled'?'cancelled':'partial');
  if(outcome==='success')assert.doesNotThrow(()=>db.checkSource('apartments'));else assert.throws(()=>db.checkSource('apartments'),/paused/);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM scan_lock').get()!.n,0);
 }finally{jobs.fail('Cleanup');db.close();await rm(dir,{recursive:true,force:true});}
});
