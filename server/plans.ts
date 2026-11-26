import {usageCheckpoint} from './usage-guard.ts';
import {discoveryAuthorized,type DiscoverySchedule} from './discovery-schedule-policy.ts';
import {setTimeout as sleep} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {sourceFilteredIntake} from './search-area.ts';
import {assertParallelCaps,claimScan,heartbeatScan,recoverScan} from './scan-concurrency.ts';
import {assertFeedbackReady} from './feedback-learning.ts';
import {capsSchema,type Caps} from '../src/domain.ts';
import {Store} from './db.ts';
import {sourceById} from './sources.ts';
import {requestLimit} from './traffic-policy.ts';
import {readAccountUsage,validateAccountUsage} from './account-usage.ts';
export type Usage={pages:number;listings:number;photos:number;aiCalls:number;reservedUsd:number;requests:number};
export const emptyUsage=():Usage=>({pages:0,listings:0,photos:0,aiCalls:0,reservedUsd:0,requests:0});
export function assertAccessRecoveryCaps(caps:Caps){if(caps.purpose!=='access-check'||caps.sources.length!==1||caps.maxPages!==1||caps.maxListings!==1||caps.maxPhotos!==0||caps.maxAiCalls!==0||caps.maxReservedUsd!==0||(caps.maxAddressLookups??0)!==0)throw new Error('Access recovery permits one page for one source and no extraction or AI budget');}
export function assertRecoveryCooldown(store:Store,source:string,now=Date.now()){
 const health=store.health().find(h=>h.source===source);
 if(Date.parse(health?.paused_until??'')>now)throw new Error(`Source cooldown remains in effect until ${health.paused_until}; no recovery request made`);
}
export function createPlan(store:Store,input:unknown,options:{accessRecovery?:boolean}={}){const caps=capsSchema.parse(input);
 if(caps.purpose==='availability'&&(caps.assessmentMode!=='quick'||caps.maxPhotos!==0||caps.maxAiCalls!==0||caps.maxReservedUsd!==0||(caps.maxAddressLookups??0)!==0||caps.maxPages>240||!caps.stopAt||Date.parse(caps.stopAt)>Date.now()+3601000))throw Error('Availability plans require saved pages only, at most 240 pages and one hour, with zero photos, AI and address lookups');
 if(!caps.assessmentMode&&caps.purpose==='listings'&&!caps.fullReviewHomeIds?.length&&store.get<{mode:string}>('reviewWorkflow')?.mode==='quick-first')caps.assessmentMode='quick';
 if(!caps.pacingPolicy&&caps.assessmentMode==='quick'&&caps.trafficPolicy==='session')caps.pacingPolicy='adaptive';
 if(caps.assessmentMode==='quick'&&(caps.maxAiCalls!==0||caps.maxReservedUsd!==0))throw new Error('Quick intake uses zero AI calls and no paid allowance.');
 if(sourceFilteredIntake(store)&&caps.assessmentMode==='quick')caps.maxAddressLookups=0;
 if(caps.maxAddressLookups===undefined&&caps.assessmentMode==='quick'&&caps.purpose==='listings'&&caps.phase!=='inventory')caps.maxAddressLookups=caps.maxListings;
 assertParallelCaps(caps);
 if((caps.maxAddressLookups??0)>0&&(caps.assessmentMode!=='quick'||caps.purpose!=='listings'||caps.phase==='inventory'||caps.maxAddressLookups!>caps.maxListings))throw new Error('Address lookups require quick intake and cannot exceed the candidate allowance.');
 if(caps.fullReviewHomeIds?.length&&(caps.assessmentMode!=='full'||caps.newListingsOnly||caps.phase==='inventory'))throw new Error('Targeted full assessments require full mode without inventory discovery.');
 if(caps.phase==='inventory'&&(caps.maxPhotos!==0||caps.maxAiCalls!==0||caps.maxReservedUsd!==0))throw new Error('Inventory-only plans require zero photo and AI allowances');caps.sources=[...new Set(caps.sources)];if(caps.purpose==='listings'&&caps.sources.length>1&&(caps.maxPages<caps.sources.length*2||caps.maxListings<caps.sources.length))throw new Error('Allow at least two page visits and one apartment per selected source, or select fewer sources.');if(options.accessRecovery)assertAccessRecoveryCaps(caps);if(!caps.cachedReviewOnly&&caps.sources.includes('apartments')&&caps.purpose==='listings'){if(!store.get('browserExtension'))throw new Error('Connect the Chrome extension first');}for(const id of caps.sources){const s=sourceById(id);if(s.adapter==='pending'&&caps.purpose!=='access-check')throw new Error(`${s.name} is not ready for automated validation`);if(caps.purpose!=='availability'&&!caps.cachedReviewOnly&&!options.accessRecovery&&caps.sources.length===1)store.checkSource(id);}
 if(caps.newListingsOnly&&caps.unitListingsOnly&&caps.targetNewListingsPerSource){const targets=caps.sources.map(source=>caps.targetNewListingsBySource?.[source]??caps.targetNewListingsPerSource!);if(caps.maxListings<targets.reduce((sum,n)=>sum+n,0)||caps.sources.some((source,i)=>(caps.maxListingsBySource?.[source]??caps.maxListingsPerSource??Infinity)<targets[i]))throw new Error('Candidate allowance is smaller than the requested new-apartment target.');}
 if(options.accessRecovery)assertRecoveryCooldown(store,caps.sources[0]);
 const id=randomUUID(),now=new Date(),expires=new Date(now.getTime()+3600000);store.db.prepare('INSERT INTO plans (id,caps,state,created_at,expires_at,usage,detail) VALUES (?,?,?,?,?,?,?)').run(id,JSON.stringify(caps),'draft',now.toISOString(),expires.toISOString(),JSON.stringify(emptyUsage()),'No network requests have been made.');return getPlan(store,id);}
export function getPlan(store:Store,id:string){const r=store.db.prepare('SELECT * FROM plans WHERE id=?').get(id) as any;if(!r)throw new Error('Plan not found');return {...r,caps:JSON.parse(r.caps) as Caps,usage:JSON.parse(r.usage) as Usage,addressLookups:store.get<number>(`addressLookupUsage:${id}`)??0,sources:store.get(`sourceResults:${id}`)??[]};}
export function approvePlan(store:Store,id:string,confirmation:string){if(confirmation!=='APPROVE ONE SCAN')throw new Error('Explicit approval is required');const plan=getPlan(store,id);if(plan.caps.purpose==='listings'&&plan.caps.phase!=='inventory'&&plan.caps.assessmentMode!=='quick')assertFeedbackReady(store);if(plan.state!=='draft'||Date.parse(plan.expires_at)<Date.now()||plan.caps.stopAt&&Date.parse(plan.caps.stopAt)<=Date.now())throw new Error('Plan expired or already used');const result=store.db.prepare("UPDATE plans SET state='approved' WHERE id=? AND state='draft'").run(id);if(!result.changes)throw new Error('Plan already approved');store.event(`Approved one bounded scan: ${id}`);}
export function claimPlan(store:Store,id:string){return store.transaction(()=>{const p=getPlan(store,id);if(p.caps.purpose==='listings'&&p.caps.phase!=='inventory'&&p.caps.assessmentMode!=='quick')assertFeedbackReady(store);if(p.state!=='approved'||Date.parse(p.expires_at)<Date.now())throw new Error('An unexpired, approved scan plan is required');claimScan(store,id,p.caps);store.db.prepare("UPDATE plans SET state='running' WHERE id=?").run(id);return p;});}
export function recoverInterrupted(store:Store){return recoverScan(store);}
export class Budget {
 constructor(public store:Store,public id:string,public caps:Caps){}
 remaining(kind:'pages'|'listings'|'photos'|'aiCalls'){const cap={pages:this.caps.maxPages,listings:this.caps.maxListings,photos:this.caps.maxPhotos,aiCalls:this.caps.maxAiCalls}[kind];return Math.max(0,cap-getPlan(this.store,this.id).usage[kind]);}
 check(){if(this.store.get<boolean>(`scheduledPlan:${this.id}`)&&!discoveryAuthorized(this.store.get<DiscoverySchedule>('scanSchedule'),new Date()))throw Error('Scheduled discovery is disabled or outside its authorized window');usageCheckpoint(this.store,this.id);const p=getPlan(this.store,this.id);if(p.caps.stopAt&&Date.now()>=Date.parse(p.caps.stopAt))throw new Error('Scan deadline reached; remaining work retained');if(p.state!=='running')throw new Error('Scan stopped');if(p.caps.purpose==='listings'&&p.caps.phase!=='inventory'&&p.caps.assessmentMode!=='quick')assertFeedbackReady(this.store);}
 reserve(kind:keyof Usage,amount=1){if(this.caps.cachedReviewOnly&&['pages','photos','requests'].includes(kind))throw Error('Cached assessment cannot access listing sources or download photos');this.store.transaction(()=>{this.check();const p=getPlan(this.store,this.id),u=p.usage;const limit={pages:this.caps.maxPages,listings:this.caps.maxListings,photos:this.caps.maxPhotos,aiCalls:this.caps.maxAiCalls,reservedUsd:this.caps.maxReservedUsd,requests:requestLimit(this.caps)}[kind];if(u[kind]+amount>limit+1e-8)throw new Error(`${kind} cap reached; remaining work deferred`);u[kind]+=amount;this.store.db.prepare('UPDATE plans SET usage=? WHERE id=?').run(JSON.stringify(u),this.id);heartbeatScan(this.store,this.id);});}
 async waitForAi(){
  const guard=this.store.get<{accountId:string;stopAt:number}>(`fullReviewGuard:${this.id}`);
  if(guard){
   if(getPlan(this.store,this.id).state!=='running')throw new Error('Scan stopped');
   const measured=validateAccountUsage(await readAccountUsage(),guard.accountId,guard.stopAt);
   this.store.set(`usageGuard:${this.id}`,{...measured,stopAt:guard.stopAt,allowAiThrough:getPlan(this.store,this.id).usage.aiCalls+1});
   this.check();return;
  }
  while(true){this.check();const checkpoint=usageCheckpoint(this.store,this.id);if(!checkpoint||getPlan(this.store,this.id).usage.aiCalls<checkpoint.allowAiThrough)return;await sleep(250);}
 }
 reserveAi(){this.store.transaction(()=>{this.check();const checkpoint=usageCheckpoint(this.store,this.id);if(checkpoint&&getPlan(this.store,this.id).usage.aiCalls>=checkpoint.allowAiThrough)throw new Error("Awaiting account usage checkpoint before next AI call");const p=getPlan(this.store,this.id),u=p.usage;if(u.aiCalls>=this.caps.maxAiCalls||this.caps.billingMode!=='chatgpt'&&u.reservedUsd+this.caps.reservePerCallUsd>this.caps.maxReservedUsd+1e-8)throw new Error('AI cap reached; photo review deferred');heartbeatScan(this.store,this.id);u.aiCalls++;if(this.caps.billingMode!=='chatgpt')u.reservedUsd+=this.caps.reservePerCallUsd;this.store.db.prepare('UPDATE plans SET usage=? WHERE id=?').run(JSON.stringify(u),this.id);});}
}
