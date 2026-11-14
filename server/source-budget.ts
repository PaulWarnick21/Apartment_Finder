import {Budget,getPlan,type Usage} from './plans.ts';
/** Reserve a fair share for every remaining source; never increase the approved total. */
export class SourceBudget extends Budget {
 readonly start:Usage;readonly limits:Usage;
 constructor(parent:Budget,remainingSources:number){super(parent.store,parent.id,parent.caps);this.start={...getPlan(this.store,this.id).usage};this.limits={pages:Math.min(5,Math.floor(parent.remaining('pages')/remainingSources)),listings:Math.min(parent.caps.maxListingsPerSource??Infinity,Math.floor(parent.remaining('listings')/remainingSources)),photos:Math.floor(parent.remaining('photos')/remainingSources),aiCalls:Math.floor(parent.remaining('aiCalls')/remainingSources),requests:500,reservedUsd:parent.caps.maxReservedUsd};}
 override remaining(kind:'pages'|'listings'|'photos'|'aiCalls'){return Math.max(0,Math.min(super.remaining(kind),this.limits[kind]-(getPlan(this.store,this.id).usage[kind]-this.start[kind])));}
 override reserve(kind:keyof Usage,amount=1){const used=getPlan(this.store,this.id).usage[kind]-this.start[kind];if(used+amount>this.limits[kind])throw new Error(`Per-source ${kind} cap reached; remaining work deferred`);super.reserve(kind,amount);}
 override reserveAi(){if(!this.remaining('aiCalls'))throw new Error('Per-source AI cap reached; photo review deferred');super.reserveAi();}
}
