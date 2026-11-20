import type {Store} from './db.ts';
import type {Usage} from './plans.ts';
import {assertParallelCaps,isCachedReview} from './scan-concurrency.ts';
import type {Caps} from '../src/domain.ts';

export const admissionDeferredDetail='Local admission busy; unstarted batch retained';
const unstartedDetails=new Set([admissionDeferredDetail,'Local approval failed; unstarted batch retained','Local snapshot lock deferred this unstarted batch; no source request was approved']);
const usageKeys:(keyof Usage)[]=['pages','listings','photos','aiCalls','reservedUsd','requests'];
type PlanEvidence={id:string;state:string;detail:string;usage:Usage;sources:unknown[]};

/** An approval race is local lane contention, never a website failure. */
export function isScanAdmissionConflict(error:unknown){
 const message=error instanceof Error?error.message:String(error);
 return ['Another scan is running','Another scan is running or needs interrupted-run recovery'].includes(message);
}

export function zeroPlanUsage(usage:Usage){return usageKeys.every(key=>usage[key]===0);}

/** Only a proven system-cancelled, never-started draft can skip source recovery.
 * Real worker failures, nonzero usage and user cancellations retain their guards. */
export function unstartedSystemCancellation(plan:PlanEvidence,selfCancelled:readonly string[]){
 return selfCancelled.includes(plan.id)&&plan.state==='cancelled'&&unstartedDetails.has(plan.detail)&&zeroPlanUsage(plan.usage)&&plan.sources.length===0;
}

/** Include selected-home workers, approved-but-unclaimed work and closing groups. */
export function scannerOccupied(store:Store){
 return !!(store.db.prepare("SELECT 1 FROM plans WHERE state IN ('approved','running') LIMIT 1").get()
  ||store.db.prepare('SELECT 1 FROM scan_lock LIMIT 1').get()
  ||store.db.prepare('SELECT 1 FROM parallel_scan_members LIMIT 1').get());
}

/** A coordinator handoff may wait beside proven cached user reviews only. It
 * never claims/reclaims their lock or changes their plan state. */
export function assertCoordinatorHandoff(store:Store,owned:readonly string[]){
 const plans=store.db.prepare('SELECT id,state,caps FROM plans').all() as {id:string;state:string;caps:string}[];
 if(plans.some(plan=>owned.includes(plan.id)&&['draft','approved','running'].includes(plan.state)))throw Error('Owned work is not at an idle coordinator handoff boundary');
 const byId=new Map(plans.map(plan=>[plan.id,plan]));
 const reviews=new Map<string,Caps>();
 const checkReview=(id:string)=>{
  const plan=byId.get(id);if(!plan||owned.includes(id))throw Error('Unknown or owned worker prevents coordinator handoff');
  const caps=JSON.parse(plan.caps) as Caps;
  if(!isCachedReview(caps)||!caps.parallelGroup)throw Error('Only existing cached selected-home reviews may overlap a coordinator handoff');
  assertParallelCaps(caps);reviews.set(id,caps);
 };
 for(const plan of plans)if(['approved','running'].includes(plan.state))checkReview(plan.id);
 const members=store.db.prepare('SELECT plan_id,group_id FROM parallel_scan_members').all() as {plan_id:string;group_id:string}[];
 for(const member of members){checkReview(member.plan_id);if(reviews.get(member.plan_id)!.parallelGroup!==member.group_id)throw Error('Cached review membership mismatch');}
 const lock=store.db.prepare('SELECT owner FROM scan_lock WHERE id=1').get() as {owner:string}|undefined;
 if(lock&&![...reviews.values()].some(caps=>lock.owner==='parallel:'+caps.parallelGroup))throw Error('Unproven scan lock prevents coordinator handoff');
}
