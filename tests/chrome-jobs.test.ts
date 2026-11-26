import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {ChromeJobs,allowedChromeJobUrl} from '../server/chrome-jobs.ts';
import {createPlan,approvePlan,claimPlan,Budget,getPlan} from '../server/plans.ts';
const url='https://www.apartments.com/example/abcdefg/';
function setup(){const db=new Store(':memory:');db.set('browserExtension',{id:'a'.repeat(32),tokenHash:'test'});const p=createPlan(db,{sources:['apartments'],billingMode:'chatgpt',maxPages:2,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});return {db,p,jobs:new ChromeJobs(db),budget:new Budget(db,p.id,p.caps)};}
const page={url,title:'Example',text:'Example',html:'<main>Example</main>',images:[],advertisedPhotos:0,galleryComplete:false,warning:null,truncated:false,links:[]};
test('Chrome jobs require a running plan, consume a page before dispatch, and cannot be replayed',async()=>{
 const {db,p,jobs,budget}=setup();try{
  assert.equal(jobs.poll().job,null);assert.throws(()=>jobs.request(budget,url,'listing',3000,0),/stopped/);
  approvePlan(db,p.id,'APPROVE ONE SCAN');claimPlan(db,p.id);
  const done=jobs.request(budget,url,'listing',3000,0);const job=jobs.poll().job!;
  assert.equal(getPlan(db,p.id).usage.pages,1);assert.equal(jobs.poll().job,null);
  assert.equal(jobs.check({id:job.id}).active,true);
  assert.throws(()=>jobs.result({id:job.id,snapshot:{...page,url:'https://evil.example/'}}),/different/);
  jobs.result({id:job.id,snapshot:page});assert.equal((await done).url,url);
  assert.throws(()=>jobs.result({id:job.id,snapshot:page}),/expired/);
  assert.equal(jobs.check({id:job.id}).active,false);
 }finally{jobs.fail('test cleanup');db.close();}
});
test('Chrome warnings pause the source and fail the job without fallback navigation',async()=>{
 const {db,p,jobs,budget}=setup();try{
  approvePlan(db,p.id,'APPROVE ONE SCAN');claimPlan(db,p.id);
  const done=jobs.request(budget,url,'listing',3000,0),failed=assert.rejects(done,/Access denied/),job=jobs.poll().job!;
  jobs.result({id:job.id,snapshot:{...page,url:url+'?tracking=private',warning:'Access denied',warningEvidence:'Access denied. Reference 123.'}});await failed;
  const warnings=db.get<Array<{url:string;planId:string;excerpt:string;html?:string}>>('chromeAccessWarnings:apartments')!;
  assert.equal(warnings.length,1);assert.equal(warnings[0].url,url);assert.equal(warnings[0].planId,p.id);assert.equal(warnings[0].excerpt,'Access denied. Reference 123.');assert.equal(warnings[0].html,undefined);
  assert.throws(()=>db.checkSource('apartments'),/Access denied/);assert.equal(jobs.poll().job,null);
  assert.equal(allowedChromeJobUrl('https://www.apartments.com.evil.example/a'),false);
  assert.equal(allowedChromeJobUrl('https://user@www.apartments.com/a'),false);
 }finally{jobs.fail('test cleanup');db.close();}
});

test('same-source redirected warning still pauses; other redirects retain safe diagnostics',async()=>{
 const {db,p,jobs,budget}=setup();try{
  approvePlan(db,p.id,'APPROVE ONE SCAN');claimPlan(db,p.id);
  const done=jobs.request(budget,url,'listing',3000,0),job=jobs.poll().job!;
  assert.throws(()=>jobs.result({id:job.id,snapshot:{...page,url:'https://www.apartments.com/vancouver-bc/?tracking=private'}}),/identity unverified/);
  const rows=db.get<any[]>('chromePageMismatches:apartments')!;
  assert.equal(rows[0].returned,'https://www.apartments.com/vancouver-bc/');assert.doesNotThrow(()=>db.checkSource('apartments'));
  const rejected=assert.rejects(done,/Access denied/);
  jobs.result({id:job.id,snapshot:{...page,url:'https://www.apartments.com/blocked/',warning:'Access denied'}});await rejected;
  assert.throws(()=>db.checkSource('apartments'),/paused/);
 }finally{jobs.fail('cleanup');db.close();}
});

test('worker cleanup cannot cancel a different plan Chrome job',async()=>{
 const {db,p,jobs,budget}=setup();try{
  approvePlan(db,p.id,'APPROVE ONE SCAN');claimPlan(db,p.id);
  const done=jobs.request(budget,url,'listing',3000,0),job=jobs.poll().job!;
  jobs.fail('Another source finished','different-plan');
  assert.equal(jobs.check({id:job.id}).active,true);
  jobs.result({id:job.id,snapshot:page});assert.equal((await done).url,url);
  const cancelled=jobs.request(budget,url,'listing',3000,0),failed=assert.rejects(cancelled,/Owner finished/);
  jobs.fail('Owner finished',p.id);await failed;assert.equal(jobs.poll().job,null);
 }finally{jobs.fail('test cleanup');db.close();}
});

test('cached assessments cannot dispatch Chrome work even through pre-reserved IPC',()=>{
 const db=new Store(':memory:'),jobs=new ChromeJobs(db);
 try{
  db.set('browserExtension',{id:'a'.repeat(32),tokenHash:'test'});
  const p=createPlan(db,{sources:['apartments'],assessmentMode:'full',phase:'assessment',cachedReviewOnly:true,fullReviewHomeIds:[1],billingMode:'chatgpt',maxPages:1,maxListings:1,maxPhotos:0,maxAddressLookups:0,maxAiCalls:1,maxReservedUsd:0});
  approvePlan(db,p.id,'APPROVE ONE SCAN');claimPlan(db,p.id);const budget=new Budget(db,p.id,p.caps);
  for(const preReserved of [false,true])assert.throws(()=>jobs.request(budget,url,'listing',3000,0,false,{preReserved}),/Cached assessment cannot access listing sources/);
  assert.equal(jobs.poll().job,null);assert.equal(getPlan(db,p.id).usage.pages,0);assert.equal(getPlan(db,p.id).usage.requests,0);assert.equal(db.db.prepare('SELECT count(*) AS n FROM requests').get()!.n,0);
 }finally{jobs.fail('test cleanup');db.close();}
});
