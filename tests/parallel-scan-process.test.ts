import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {createPlan,approvePlan,claimPlan,Budget,getPlan} from '../server/plans.ts';
import {ChromeJobs} from '../server/chrome-jobs.ts';
import {ScanProcesses} from '../server/scan-process.ts';
import {releaseScan} from '../server/scan-concurrency.ts';

test('independent paused workers overlap an owned Chrome job without cancelling it or contacting sources',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'af-parallel-process-')),store=new Store(join(dir,'apartments.sqlite')),jobs=new ChromeJobs(store),workers=new ScanProcesses(store,dir,jobs);
 const group=randomUUID(),caps={parallelGroup:group,assessmentMode:'quick',purpose:'listings',billingMode:'chatgpt',maxPages:2,maxListings:1,maxPhotos:0,maxAiCalls:0,maxAddressLookups:0,maxReservedUsd:0};
 let chromeId:string|undefined;
 try{
  store.set('browserExtension',{id:'a'.repeat(32),tokenHash:'test'});
  const chrome=createPlan(store,{...caps,sources:['zillow']});chromeId=chrome.id;approvePlan(store,chrome.id,'APPROVE ONE SCAN');claimPlan(store,chrome.id);
  const url='https://www.zillow.com/downtown-vancouver-bc/apartments/';
  const chromeDone=jobs.request(new Budget(store,chrome.id,chrome.caps),url,'discovery',3500,0);let chromeFailure:unknown;
  const observed=chromeDone.catch(error=>{chromeFailure=error;return undefined;});
  const job=jobs.poll().job!;
  const first=createPlan(store,{...caps,sources:['vada']}),second=createPlan(store,{...caps,sources:['craigslist']});
  for(const p of [first,second]){store.pause(p.caps.sources[0],'Offline parallel fixture pause',true);approvePlan(store,p.id,'APPROVE ONE SCAN');}
  workers.start(first.id);workers.start(second.id);
  assert.equal(workers.hasActive,true);
  const fourth=createPlan(store,{...caps,sources:['easyrent']});assert.throws(()=>workers.assertCanStart(fourth.id),/3|three|parallel|limit/i);
  const deadline=Date.now()+15000;while(workers.hasActive&&Date.now()<deadline)await new Promise(done=>setTimeout(done,30));
  assert.equal(workers.hasActive,false);assert.equal(chromeFailure,undefined);
  assert.equal(jobs.check({id:job.id}).active,true,'source cleanup retains the other plan bridge command');
  for(const p of [first,second]){const result=getPlan(store,p.id);assert.equal(result.state,'partial');assert.equal(result.usage.pages,0);assert.equal(result.usage.requests,0);assert.match(result.detail,/paused/);}
  jobs.result({id:job.id,snapshot:{url,title:'Fixture',text:'Fixture',html:'<main>Fixture</main>',images:[],advertisedPhotos:0,galleryComplete:false,warning:null,truncated:false,links:[]}});
  assert.equal((await observed)?.url,url);
 }finally{jobs.fail('test cleanup');await workers.close();if(chromeId)releaseScan(store,chromeId);store.close();}
});
