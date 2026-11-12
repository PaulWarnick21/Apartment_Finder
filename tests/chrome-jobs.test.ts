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
  jobs.result({id:job.id,snapshot:{...page,warning:'Access denied'}});await failed;
  assert.throws(()=>db.checkSource('apartments'),/Access denied/);assert.equal(jobs.poll().job,null);
  assert.equal(allowedChromeJobUrl('https://www.apartments.com.evil.example/a'),false);
  assert.equal(allowedChromeJobUrl('https://user@www.apartments.com/a'),false);
 }finally{jobs.fail('test cleanup');db.close();}
});
