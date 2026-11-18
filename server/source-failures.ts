import timers from 'node:timers/promises';
import type {Budget} from './plans.ts';
import type {Source} from './sources.ts';
import {recordSourceAccess} from './traffic-policy.ts';
import {waitForSourceAccess,recordAccessSuccess,recordAccessFailure} from './source-pacing.ts';

export function retryAfterUntil(value:string|undefined|null,now=Date.now()){
 if(!value)return now;
 if(/^\d+$/.test(value.trim()))return Math.min(now+Number(value)*1000,8640000000000000);
 const date=Date.parse(value);return Number.isFinite(date)?Math.max(now,date):now;
}
/** Real access warnings never retry or clear an existing manual-attention pause. */
export function pauseAccess(budget:Budget,source:string,reason:string,attention=false,retryAfter?:string|null){
 recordAccessFailure(budget,source,'page');recordAccessFailure(budget,source,'image');
 const old=budget.store.health().find(row=>row.source===source);
 budget.store.pause(source,reason,attention||!!old?.needs_attention,Math.max(Date.now()+86400000,Date.parse(old?.paused_until??'')||0,retryAfterUntil(retryAfter)));
}
export function pauseTransport(budget:Budget,source:string,reason:string){
 // A failed connection does not establish a rate limit. Preserve any real pause.
 recordAccessFailure(budget,source,'page');recordAccessFailure(budget,source,'image');
 const old=budget.store.health().find(row=>row.source===source);
 if(old&&(old.needs_attention||Date.parse(old.paused_until??'')>Date.now()))return;
 budget.store.pause(source,reason,false,Date.now()+300000);
}
function transient(error:unknown){
 if(!(error instanceof Error))return false;
 const cause=(error as Error&{cause?:{code?:string}}).cause;
 return /TimeoutError|AbortError/.test(error.name)||error instanceof TypeError&&/fetch failed/i.test(error.message)||/ETIMEDOUT|ECONNRESET|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET/.test(cause?.code??'')||/Timeout \d+ms exceeded|ECONNRESET|ETIMEDOUT/.test(error.message);
}
/** One bounded retry for transport failures, accounting for every attempt. */
export async function fetchSourcePhoto<T>(budget:Budget,source:Source,request:()=>Promise<T>):Promise<T>{
 for(let attempt=0;;attempt++){
  budget.check();budget.store.checkSource(source.id);
  await waitForSourceAccess(budget,source.id,'image');
  budget.reserve('photos');budget.reserve('requests');recordSourceAccess(budget,source,'image');
  const start=Date.now();
  try{const result=await request();recordAccessSuccess(budget,source.id,'image',Date.now()-start);return result;}
  catch(error){
   if(!transient(error))throw error;
   const failure=error as Error&{cause?:{code?:string}};
   const safe=(text:unknown)=>typeof text==='string'&&/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(text)?text:undefined;
   budget.store.set(`photoTransportFailure:${budget.id}:${source.id}`,{at:new Date().toISOString(),attempt:attempt+1,name:safe(failure.name),causeCode:safe(failure.cause?.code)});
   recordAccessFailure(budget,source.id,'image');
   budget.check();budget.store.checkSource(source.id);
   if(attempt||budget.caps.pacingPolicy!=='adaptive'){
    pauseTransport(budget,source.id,'Photo transport failed; five-minute backoff, saved gallery retained');throw error;
   }
   budget.store.event(`${source.name}: transient photo transport failure; one paced retry within the existing allowance.`);
   await timers.setTimeout(2000);
  }
 }
}
