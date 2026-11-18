import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {criteriaSchema,listingSchema,type FullReviewState} from '../src/domain.ts';
import {FullReviewService} from '../server/full-review.ts';
import {claimPlan,getPlan} from '../server/plans.ts';
import {validateAccountUsage} from '../server/account-usage.ts';
import {deskCategory} from '../src/desk-category.ts';
import {releaseScan} from '../server/scan-concurrency.ts';

const usage=(usedPercent=4)=>({ordinaryUsageAllowed:true,accountId:'fixture-account',rateLimits:{primary:{usedPercent,windowDurationMins:10080,resetsAt:2000000000},secondary:null,spendControlReached:false},rateLimitsByLimitId:null});
function feedbackBlock(store:Store,homeId:number){const h=store.home(homeId)!;return Number(store.db.prepare("INSERT INTO rating_feedback(request_id,home_id,at,user_score,reason,listing_json,score_json,criteria_json,status,error) VALUES (?,?,?,?,?,?,?,?,?,?)").run('feedback-fixture',homeId,new Date().toISOString(),3.5,'Prefer furnished short leases',JSON.stringify(h.listing),JSON.stringify(h.score),JSON.stringify(store.criteria),'reviewing','').lastInsertRowid);}
function setup(){
 const store=new Store(':memory:');store.set('reviewWorkflow',{mode:'quick-first'});store.set('criteria',criteriaSchema.parse({requireNiceViewForDesk:true,quickIntake:{minRent:1000,maxRent:3500,minPhotos:2,allowedBeds:[1,2]}}));
 store.set('fullReviewPolicy',{accountId:'fixture-account',profileId:'fixture-profile',stopAt:95,maxPages:24,maxPhotos:240,maxAiCalls:120});
 const id=store.ingest(listingSchema.parse({source:'craigslist',sourceId:'a',url:'https://vancouver.craigslist.org/van/apa/d/fixture/1234567890.html',title:'Saved apartment',address:'123 Example Street',rent:3400,beds:1,galleryComplete:true,expectedPhotos:2,photos:[1,2].map(n=>({id:String(n),url:`https://images.craigslist.org/fixture${n}.jpg`,local:`fixture${n}.jpg`,status:'downloaded'}))})).id;
 let active=false,starts=0,research=0;const runner={get hasActive(){return active;},start(planId:string){claimPlan(store,planId);active=true;starts++;}};
 const service=new FullReviewService(store,'.',runner,false,{usage:async()=>usage(),connection:async()=>({sharing:true,model:'fixture',active:'fixture-profile'}),research:async()=>{research++;return {status:'complete',notes:[],requestCount:2};}});
 const change=(stage:string,notes='Keep my note')=>{const h=store.home(id)!;return store.update(id,h.revision,{stage,notes,followUp:'',viewing:'',rescued:false})!;};
 const finish=(complete:boolean)=>{const job=store.get<FullReviewState>(`fullReview:${id}`)!;store.set(`fullReviewResult:${job.planId}:${id}`,{complete,hardFiltered:false,detail:complete?'All accessible photos reviewed.':'Photos remain pending.'});store.db.prepare("UPDATE plans SET state='complete' WHERE id=?").run(job.planId!);releaseScan(store,job.planId!);active=false;};
 return {store,id,service,change,finish,starts:()=>starts,research:()=>research};
}

test('Interested queues one bounded job in Scoring in Progress, then completed low scores move to Interested',async()=>{
 const f=setup();try{
  assert.equal(deskCategory(f.store.home(f.id)!),'Unreviewed');assert.ok(f.store.home(f.id)!.score.value<3);
  f.change('Interested');const original=f.store.get(`fullReview:${f.id}`);f.change('Interested','Updated note');assert.deepEqual(f.store.get(`fullReview:${f.id}`),original);
  const queued=f.store.home(f.id)!;assert.equal(deskCategory(queued),'Scoring in Progress');assert.equal(queued.stage,'Interested');
  assert.equal(f.store.db.prepare('SELECT category FROM desk_membership WHERE home_id=?').get(f.id)!.category,'Scoring in Progress');
  await f.service.tick();assert.equal(f.starts(),1);const h=f.store.home(f.id)!;assert.equal(h.fullReview!.status,'running');
  assert.equal(deskCategory(h),'Scoring in Progress');assert.equal(h.categoryEnteredAt,queued.categoryEnteredAt);
  const plan=getPlan(f.store,h.fullReview!.planId!);assert.deepEqual(plan.caps.fullReviewHomeIds,[f.id]);assert.equal(plan.caps.maxAiCalls,120);assert.equal(plan.caps.billingMode,'chatgpt');assert.equal(plan.caps.maxReservedUsd,0);
  assert.throws(()=>f.change('Serious Candidates'),/Wait for the full assessment/);
  assert.throws(()=>f.change('In Progress'),/without skipping/);
  f.finish(true);await f.service.tick();assert.equal(f.store.home(f.id)!.fullReview!.status,'complete');assert.equal(f.store.home(f.id)!.reviewMode,'full');assert.equal(deskCategory(f.store.home(f.id)!),'Interested');assert.equal(f.research(),1);
  assert.equal(f.store.db.prepare('SELECT category FROM desk_membership WHERE home_id=?').get(f.id)!.category,'Interested');
  await f.service.tick();assert.equal(f.starts(),1);assert.equal(f.research(),1);assert.equal(f.store.home(f.id)!.notes,'Updated note');f.change('Serious Candidates');assert.equal(deskCategory(f.store.home(f.id)!),'Serious Candidates');f.change('Ready to Apply');assert.equal(deskCategory(f.store.home(f.id)!),'Ready to Apply');
 }finally{await f.service.close();f.store.close();}
});

test('Not Interested cancels a running job and an in-flight result cannot resurrect it',async()=>{
 const f=setup();try{f.change('Interested');await f.service.tick();const planId=f.store.home(f.id)!.fullReview!.planId!;f.change('Not Interested');assert.equal(getPlan(f.store,planId).state,'cancelled');f.finish(true);await f.service.tick();assert.equal(f.store.home(f.id)!.fullReview!.status,'cancelled');assert.equal(deskCategory(f.store.home(f.id)!),'Closed');assert.equal(f.research(),0);}finally{await f.service.close();f.store.close();}
});

test('partial evidence pauses, explicit retry resumes, and stale decisions cannot spend twice',async()=>{
 const f=setup();try{f.change('Interested');await f.service.tick();f.finish(false);await f.service.tick();assert.equal(f.store.home(f.id)!.fullReview!.status,'paused');const revision=f.store.home(f.id)!.revision;f.change('Interested');assert.throws(()=>f.service.retry(f.id,revision),/changed/);f.service.retry(f.id,f.store.home(f.id)!.revision);await f.service.tick();assert.equal(f.starts(),2);assert.equal(f.store.home(f.id)!.notes,'Keep my note');}finally{await f.service.close();f.store.close();}
});

test('startup never resumes queued network work; demo decisions remain offline',async()=>{
 const f=setup();try{f.change('Interested');const restarted=new FullReviewService(f.store,'.',{hasActive:false,start(){throw Error('Must not start');}},true);await restarted.tick();assert.equal(f.store.home(f.id)!.fullReview!.status,'paused');restarted.retry(f.id,f.store.home(f.id)!.revision);await restarted.tick();assert.match(f.store.home(f.id)!.fullReview!.detail??'',/Offline demo/);assert.equal(f.starts(),0);await restarted.close();}finally{await f.service.close();f.store.close();}
});

test('usage must be ordinary included usage on the bound account and below every exhausted window',()=>{
 assert.equal(validateAccountUsage(usage(), 'fixture-account',95,123).checkedAt,123);
 assert.throws(()=>validateAccountUsage(usage(95),'fixture-account',95),/reserve/);
 assert.throws(()=>validateAccountUsage(usage(),'another-account',95),/does not match/);
 assert.throws(()=>validateAccountUsage({...usage(),ordinaryUsageAllowed:null},'fixture-account',95),/unavailable/);
 assert.throws(()=>validateAccountUsage({...usage(),rateLimits:{primary:null,secondary:null}},'fixture-account',95),/Weekly/);
 assert.throws(()=>validateAccountUsage({...usage(),rateLimits:{...usage().rateLimits,secondary:{usedPercent:100,windowDurationMins:300,resetsAt:null}}},'fixture-account',95),/exhausted/);
});

test('feedback waits remain monitored and automatically resume once resolved, without repeated plans',async()=>{
 const f=setup();try{
  const feedbackId=feedbackBlock(f.store,f.id);f.change('Interested');await f.service.tick();
  assert.equal(f.starts(),0);assert.equal(f.store.home(f.id)!.fullReview!.waitingForFeedback,feedbackId);
  assert.equal(deskCategory(f.store.home(f.id)!),'Scoring in Progress');
  f.store.db.prepare("UPDATE rating_feedback SET status='needs-attention',error='Choose the preference priority' WHERE id=?").run(feedbackId);await f.service.tick();
  assert.match(f.store.home(f.id)!.fullReview!.detail,/Choose the preference priority/);assert.equal(f.starts(),0);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM plans').get()!.n,0);
  f.store.db.prepare("UPDATE rating_feedback SET status='applied',error='' WHERE id=?").run(feedbackId);await f.service.tick();
  assert.equal(f.starts(),1);assert.equal(f.store.home(f.id)!.fullReview!.status,'running');assert.equal(f.store.home(f.id)!.fullReview!.waitingForFeedback,undefined);
  await f.service.tick();assert.equal(f.starts(),1);
 }finally{await f.service.close();f.store.close();}
});

test('closing an apartment cancels its feedback wait; resolving feedback never revives it',async()=>{
 const f=setup();try{const feedbackId=feedbackBlock(f.store,f.id);f.change('Interested');await f.service.tick();f.change('Not Interested');f.store.db.prepare("UPDATE rating_feedback SET status='applied' WHERE id=?").run(feedbackId);await f.service.tick();assert.equal(f.starts(),0);assert.equal(f.store.home(f.id)!.stage,'Not Interested');}finally{await f.service.close();f.store.close();}
});

test('startup and an already spent partial assessment do not gain a fresh scan allowance from feedback resolution',async()=>{
 const f=setup();try{
  const feedbackId=feedbackBlock(f.store,f.id);f.change('Interested');await f.service.tick();
  const restarted=new FullReviewService(f.store,'.',{hasActive:false,start(){assert.fail('Startup must remain offline');}});
  try{f.store.db.prepare("UPDATE rating_feedback SET status='applied' WHERE id=?").run(feedbackId);await restarted.tick();assert.equal(f.store.home(f.id)!.fullReview!.waitingForFeedback,undefined);assert.equal(f.store.home(f.id)!.fullReview!.status,'paused');}finally{await restarted.close();}
  f.service.retry(f.id,f.store.home(f.id)!.revision);await f.service.tick();assert.equal(f.starts(),1);f.finish(false);await f.service.tick();await f.service.tick();assert.equal(f.starts(),1);assert.equal(f.store.home(f.id)!.fullReview!.status,'paused');
 }finally{await f.service.close();f.store.close();}
});
