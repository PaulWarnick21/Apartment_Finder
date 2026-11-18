import {Budget,getPlan,type Usage} from './plans.ts';
import {sessionTraffic,requestLimit} from './traffic-policy.ts';
/** Reserve a fair share for every remaining source; never increase the approved total. */
export class SourceBudget extends Budget {
 readonly start:Usage;readonly limits:Usage;
 constructor(parent:Budget,remainingSources:number,source?:string,share=1/remainingSources){super(parent.store,parent.id,parent.caps);this.start={...getPlan(this.store,this.id).usage};if(!(share>0&&share<=1))throw new Error('Invalid bounded source share');const allowance=(kind:'pages'|'listings'|'photos'|'aiCalls')=>Math.floor(parent.remaining(kind)*share);this.limits={pages:Math.min(sessionTraffic(parent.caps)?Infinity:5,allowance('pages')),listings:Math.min((source?parent.caps.maxListingsBySource?.[source]:undefined)??parent.caps.maxListingsPerSource??Infinity,allowance('listings')),photos:allowance('photos'),aiCalls:allowance('aiCalls'),requests:sessionTraffic(parent.caps)?Math.floor((requestLimit(parent.caps)-this.start.requests)*share):500,reservedUsd:parent.caps.maxReservedUsd};}
 override remaining(kind:'pages'|'listings'|'photos'|'aiCalls'){return Math.max(0,Math.min(super.remaining(kind),this.limits[kind]-(getPlan(this.store,this.id).usage[kind]-this.start[kind])));}
 override reserve(kind:keyof Usage,amount=1){const used=getPlan(this.store,this.id).usage[kind]-this.start[kind];if(used+amount>this.limits[kind])throw new Error(`Per-source ${kind} cap reached; remaining work deferred`);super.reserve(kind,amount);}
 override reserveAi(){if(!this.remaining('aiCalls'))throw new Error('Per-source AI cap reached; photo review deferred');super.reserveAi();}
}

/** Static shares and independent usage for sources that overlap inside ONE plan.
 * The parent plan remains the aggregate authorization and every reservation is atomic. */
export class ConcurrentSourceBudget extends Budget {
 private readonly usageKey:string;
 constructor(parent:Budget,readonly source:string,readonly limits:Usage){super(parent.store,parent.id,parent.caps);this.usageKey=`concurrentSourceUsage:${parent.id}:${source}`;}
 private usage(){return this.store.get<Usage>(this.usageKey)??{pages:0,listings:0,photos:0,aiCalls:0,requests:0,reservedUsd:0};}
 override remaining(kind:'pages'|'listings'|'photos'|'aiCalls'){return Math.max(0,Math.min(super.remaining(kind),this.limits[kind]-this.usage()[kind]));}
 override reserve(kind:keyof Usage,amount=1){this.store.transaction(()=>{
  const used=this.usage();if(used[kind]+amount>this.limits[kind])throw new Error(`Per-source ${kind} cap reached; remaining work deferred`);
  super.reserve(kind,amount);used[kind]+=amount;this.store.set(this.usageKey,used);
 });}
 override reserveAi(){throw new Error('Concurrent source intake does not authorize AI calls');}
}

export function concurrentSourceBudgets(parent:Budget,sources:readonly string[],preferred=false){
 const usage=getPlan(parent.store,parent.id).usage;
 const remaining:Usage={pages:parent.remaining('pages'),listings:parent.remaining('listings'),photos:parent.remaining('photos'),aiCalls:0,requests:requestLimit(parent.caps)-usage.requests,reservedUsd:0};
 return sources.map((source,index)=>{
  const count=sources.length-index;
  const priority=preferred&&index===0?Math.max(0,Math.min(.75,(remaining.pages-2*(count-1))/remaining.pages,(remaining.listings-(count-1))/remaining.listings)):0;
  const share=priority>0?priority:1/count;
  const limits:Usage={pages:Math.min(sessionTraffic(parent.caps)?Infinity:5,Math.floor(remaining.pages*share)),listings:Math.min(parent.caps.maxListingsBySource?.[source]??parent.caps.maxListingsPerSource??Infinity,Math.floor(remaining.listings*share)),photos:Math.floor(remaining.photos*share),aiCalls:0,requests:Math.floor(remaining.requests*share),reservedUsd:0};
  for(const key of ['pages','listings','photos','requests'] as const)remaining[key]-=limits[key];
  return new ConcurrentSourceBudget(parent,source,limits);
 });
}
