import {randomUUID} from 'node:crypto';
import type {Store} from './db.ts';
import type {Caps,FullReviewState} from '../src/domain.ts';
import {createPlan,approvePlan,getPlan} from './plans.ts';
import {aiMode,chatGpt} from './chatgpt.ts';
import {readAccountUsage,validateAccountUsage} from './account-usage.ts';
import {assertFeedbackReady,feedbackBlocker} from './feedback-learning.ts';
import {assertCanStartScan,isCachedReview} from './scan-concurrency.ts';
import {cachedReviewReady} from './cached-review.ts';
import {deduplicateHome} from './automatic-duplicates.ts';

export type FullReviewPolicy={accountId:string;profileId:string;stopAt:number;maxPages:number;maxPhotos:number;maxAiCalls:number};
type ProcessRunner={readonly hasActive:boolean;assertCanStart?:(id:string)=>void;start:(id:string)=>void};
type Dependencies={usage?:()=>Promise<unknown>;connection?:()=>Promise<{sharing:boolean;model:string;active:string}>;research?:(id:number)=>Promise<{status:string;notes:string[];requestCount:number}>;intervalMs?:number};
const activeStates=new Set(['queued','running']);

/** An Interested decision authorizes one bounded review of that apartment only.
 * Persisted jobs survive restarts but never restart network work on startup. */
export class FullReviewService{
 private timer?:NodeJS.Timeout;private pumping?:Promise<void>;private closed=false;
 constructor(private store:Store,private dataDir:string,private runner:ProcessRunner,private demo=false,private deps:Dependencies={}){
  for(const job of this.jobs())if(activeStates.has(job.state.status)||job.state.waitingForFeedback)this.save(job.id,{...job.state,waitingForFeedback:undefined,status:'paused',detail:'The app restarted. Saved work is retained; retry this full assessment to continue.'});
 }
 private jobs(){return (this.store.db.prepare("SELECT key,value FROM meta WHERE key GLOB 'fullReview:*'").all() as {key:string;value:string}[]).map(r=>({id:Number(r.key.split(':')[1]),state:JSON.parse(r.value) as FullReviewState})).sort((a,b)=>a.state.updatedAt.localeCompare(b.state.updatedAt));}
 private save(id:number,state:Omit<FullReviewState,'updatedAt'>|FullReviewState){this.store.set(`fullReview:${id}`,{...state,updatedAt:new Date().toISOString()});}
 private waitForFeedback(id:number,blocker:NonNullable<ReturnType<typeof feedbackBlocker>>){
  const attention=blocker.status==='needs-attention'||blocker.status==='failed';
  const detail=`${attention?'Feedback needs attention':'Waiting for feedback review'} for apartment #${blocker.home_id}.${attention&&blocker.error?' '+blocker.error:''} Full scoring will resume automatically when the feedback is resolved.`;
  const current=this.store.get<FullReviewState>(`fullReview:${id}`);
  if(current?.status!=='paused'||current.waitingForFeedback!==blocker.id||current.detail!==detail)this.save(id,{status:'paused',waitingForFeedback:blocker.id,detail});
 }
 private admission(cached:boolean):{parallelGroup?:string}|undefined{
  const active=(this.store.db.prepare("SELECT caps FROM plans WHERE state IN ('approved','running') OR id IN (SELECT plan_id FROM parallel_scan_members)").all() as {caps:string}[]).map(row=>JSON.parse(row.caps) as Caps);
  const lock=this.store.db.prepare('SELECT owner FROM scan_lock WHERE id=1').get() as {owner:string}|undefined;
  if(!cached)return active.length||lock||this.runner.hasActive?undefined:{};
  const configured=this.store.get<{reviewConcurrency?:number}>('processingPolicy')?.reviewConcurrency,limit=Math.max(1,Math.min(2,Number.isInteger(configured)?configured!:2));
  if(active.length>=3||active.filter(isCachedReview).length>=limit||lock&&!lock.owner.startsWith('parallel:')||this.runner.hasActive&&!active.length)return;
  const group=lock?.owner.slice('parallel:'.length)??active[0]?.parallelGroup??randomUUID();
  if(active.some(caps=>caps.parallelGroup!==group))return;
  return {parallelGroup:group};
 }
 retry(id:number,revision:number){
  const h=this.store.home(id);if(!h||h.revision!==revision)throw new Error('Apartment changed; refresh before retrying.');
  if(h.stage!=='Interested')throw new Error('Only Interested apartments can receive a full assessment.');
  if(h.fullReview?.status==='running'||h.fullReview?.status==='queued')throw new Error('Full assessment is already queued or running.');
  if(h.fullReview?.status==='complete')return h;
  this.save(h.id,{status:'queued',detail:'Full assessment queued by your retry.'});this.kick();return this.store.home(h.id);
 }
 kick(){if(this.closed)return;if(!this.timer){this.timer=setInterval(()=>{void this.tick();},this.deps.intervalMs??1000);this.timer.unref();}void this.tick();}
 async tick(){if(this.closed)return;if(this.pumping)return this.pumping;this.pumping=this.pump().catch(()=>{this.store.event('Full-assessment queue paused after a local error; saved evidence retained.');}).finally(()=>{this.pumping=undefined;});return this.pumping;}
 private async pump(){
  // Recheck local feedback state while this explicitly authorized queue is alive.
  // Only preflight waits qualify: completed/partly spent plans need a new retry,
  // so this cannot silently renew a work allowance or bypass a cancellation.
  for(const job of this.jobs())if(job.state.status==='paused'&&job.state.waitingForFeedback&&!job.state.planId){
   const home=this.store.home(job.id);
   if(!home||home.id!==job.id||home.stage!=='Interested'){this.save(job.id,{status:'cancelled',detail:'The apartment is no longer awaiting an Interested assessment.'});continue;}
   const blocker=feedbackBlocker(this.store);if(blocker)this.waitForFeedback(job.id,blocker);else this.save(job.id,{status:'queued',detail:'Feedback review resolved; full assessment resuming automatically.'});
  }
  for(const job of this.jobs()){
   if(job.state.status!=='running'||!job.state.planId)continue;
   const plan=getPlan(this.store,job.state.planId),locked=this.store.db.prepare('SELECT 1 FROM scan_lock WHERE owner=? UNION SELECT 1 FROM parallel_scan_members WHERE plan_id=?').get(plan.id,plan.id);
   if(['approved','running'].includes(plan.state)||locked){
    // Refresh the account reading during long downloads/model calls without granting
    // another AI permit. The child independently reads usage before EVERY new call.
    const checkpoint=this.store.get<{checkedAt:number;allowAiThrough:number}>(`usageGuard:${plan.id}`),policy=this.store.get<FullReviewPolicy>('fullReviewPolicy');
    if(policy&&checkpoint&&Date.now()-checkpoint.checkedAt>30000){
     try{const measured=validateAccountUsage(await(this.deps.usage??readAccountUsage)(),policy.accountId,policy.stopAt);this.store.set(`usageGuard:${plan.id}`,{...measured,stopAt:policy.stopAt,allowAiThrough:this.store.get<{allowAiThrough:number}>(`usageGuard:${plan.id}`)?.allowAiThrough??plan.usage.aiCalls});}
     catch{this.store.db.prepare("UPDATE plans SET state='cancelled' WHERE id=? AND state IN ('approved','running')").run(plan.id);const current=this.store.get<FullReviewState>(`fullReview:${job.id}`);if(current?.status==='running'&&current.planId===plan.id&&this.store.home(job.id)?.stage==='Interested')this.save(job.id,{...current,status:'paused',detail:'Fresh account usage could not be verified or the reserve was reached. Saved work retained; retry when usage is available.'});}
    }
    continue;
   }
   const result=this.store.get<{complete:boolean;hardFiltered:boolean;detail:string}>(`fullReviewResult:${plan.id}:${job.id}`);
   const latest=this.store.get<FullReviewState>(`fullReview:${job.id}`);if(latest?.status!=='running')continue;
   deduplicateHome(this.store,job.id);if(this.store.resolveHomeId(job.id)!==job.id)continue;
   let researchDetail='';
   if(result?.complete&&!result.hardFiltered&&this.deps.research){
    const key=`fullReviewResearch:${plan.id}:${job.id}`;
    let research=this.store.get<{status:string;notes:string[];requestCount:number}>(key);
    if(!research){try{research=await this.deps.research(job.id);}catch{research={status:'unavailable',notes:['An exact advertised address or public records could not be verified; location uncertainty is retained.'],requestCount:0};}this.store.set(key,research);}
    researchDetail=research.status==='complete'?' Address and public building-record checks completed.':' Address/public-record research remains partial or unavailable; no missing facts were assumed.';
   }
   if(this.store.get<FullReviewState>(`fullReview:${job.id}`)?.status!=='running'||this.store.home(job.id)?.stage!=='Interested')continue;
   this.save(job.id,{...job.state,status:result?.complete?'complete':'paused',detail:(result?.detail||plan.detail||'Assessment unfinished; retry to resume saved work.')+researchDetail});
  }
  const queued=this.jobs().filter(job=>job.state.status==='queued');
  if(!queued.length){if(!this.jobs().some(j=>j.state.status==='running'||j.state.status==='paused'&&j.state.waitingForFeedback&&!j.state.planId)){clearInterval(this.timer);this.timer=undefined;}return;}
  for(const next of queued){
   let home=this.store.home(next.id);
   if(!home||home.id!==next.id||home.stage!=='Interested'){this.save(next.id,{status:'cancelled',detail:'The apartment is no longer awaiting an Interested assessment.'});continue;}
   deduplicateHome(this.store,next.id);home=this.store.home(next.id);
   if(!home||home.id!==next.id)continue;
   if(this.demo){this.save(next.id,{status:'paused',detail:'Offline demo: full assessment is queued but no network or AI requests run.'});continue;}
   const blocker=feedbackBlocker(this.store);
   if(blocker){this.waitForFeedback(next.id,blocker);continue;}
   if(!this.admission(cachedReviewReady(home.listing)))continue;
   let planId:string|undefined;
   try{
   const policy=this.store.get<FullReviewPolicy>('fullReviewPolicy');
   if(!policy)throw new Error('Full-assessment account and limits need configuration.');
   if(aiMode()!=='chatgpt')throw new Error('Full assessments require the connected ChatGPT plan; paid fallback is disabled.');
   assertFeedbackReady(this.store);
   const connection=await(this.deps.connection??(()=>chatGpt(this.dataDir).state()))();
   if(!connection.sharing||!connection.model||connection.active!==policy.profileId)throw new Error('Connect the authorized ChatGPT account and model before full assessment.');
   const measured=validateAccountUsage(await(this.deps.usage??readAccountUsage)(),policy.accountId,policy.stopAt);
   home=this.store.home(next.id);
   if(this.closed)return;
   if(!home||home.id!==next.id||home.stage!=='Interested'||this.store.get<FullReviewState>(`fullReview:${next.id}`)?.status!=='queued')continue;
   const cached=cachedReviewReady(home.listing),slot=this.admission(cached);if(!slot)continue;
   const primarySource=home.listing.source,homeId=home.id;
   const reviewPostings=home.postings.filter(p=>!this.store.db.prepare("SELECT 1 FROM postings p JOIN meta m ON m.key='duplicatePosting:'||p.source||':'||p.source_id WHERE p.home_id=? AND p.source=? AND p.url=?").get(homeId,p.source,p.url));
   const sources=cached?[reviewPostings.find(posting=>posting.source===primarySource)?.source??reviewPostings[0]?.source].filter((source):source is string=>!!source):[...new Set(reviewPostings.map(p=>p.source))];
   if(!sources.length)throw new Error('This saved apartment has no source posting to assess.');
   const plan=createPlan(this.store,{assessmentMode:'full',phase:'assessment',fullReviewHomeIds:[home.id],billingMode:'chatgpt',trafficPolicy:'session',sources,maxPages:cached?1:Math.max(policy.maxPages,sources.length*2),maxListings:cached?1:Math.max(12,sources.length),maxPhotos:cached?0:policy.maxPhotos,maxAddressLookups:0,maxAiCalls:policy.maxAiCalls,maxReservedUsd:0,...(cached?{cachedReviewOnly:true,...slot}:{})});planId=plan.id;
   // Recheck admission after asynchronous account checks and before authorization.
   // Occupied lanes leave the existing job queued, with no allowance consumed.
   try{assertCanStartScan(this.store,plan.id);this.runner.assertCanStart?.(plan.id);}catch{this.store.db.prepare("UPDATE plans SET state='cancelled' WHERE id=? AND state='draft'").run(plan.id);continue;}
   this.store.set(`fullReviewGuard:${plan.id}`,{accountId:policy.accountId,profileId:policy.profileId,stopAt:policy.stopAt});
   this.store.set(`usageGuard:${plan.id}`,{...measured,stopAt:policy.stopAt,allowAiThrough:0});
   this.store.set(`fullReviewAuthorization:${plan.id}`,{homeId:home.id,decisionAt:next.state.updatedAt,maxPublicResearchRequests:2,reason:'Explicit Interested decision or retry under the quick-first workflow.'});
   approvePlan(this.store,plan.id,'APPROVE ONE SCAN');
   this.save(home.id,{status:'running',planId:plan.id,detail:'Reviewing this apartment’s full gallery and saved facts. Your Interested decision is preserved.'});
   this.runner.start(plan.id);
   }catch(e){
   const unclaimed=planId&&['draft','approved'].includes(getPlan(this.store,planId).state);
   if(unclaimed)this.store.db.prepare("UPDATE plans SET state='cancelled' WHERE id=? AND state IN ('draft','approved')").run(planId!);
   if(this.store.get<FullReviewState>(`fullReview:${next.id}`)?.status==='cancelled')continue;
   // Another process can take the last slot between admission and spawn. This
   // consumes no work allowance and does not require a new Interested decision.
   if(unclaimed){try{assertCanStartScan(this.store,planId!);this.runner.assertCanStart?.(planId!);}catch{this.save(next.id,{status:'queued',detail:'Waiting for an available assessment slot.'});continue;}}
   const detail=e instanceof Error?e.message:'Full assessment could not start.';this.save(next.id,{status:'paused',...(planId?{planId}:{}),detail});
   }
  }
 }
 async close(){this.closed=true;clearInterval(this.timer);await this.pumping;}
}
