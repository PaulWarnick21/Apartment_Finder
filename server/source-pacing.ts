import timers from 'node:timers/promises';
import type {Budget} from './plans.ts';

type Pace={successes:number;lastAt:number;slowUntil:number};
const keyFor=(source:string,kind:string)=>`sourcePace:${source}:${kind}`;
export function sourceGapMs(budget:Budget,source:string,kind:'page'|'image'){
 const base=kind==='page'?10000:1000;
 if(budget.caps.pacingPolicy!=='adaptive')return base;
 const state=budget.store.get<Pace>(keyFor(source,kind));
 if(!state||Date.now()-state.lastAt>1800000)return base;
 if(state.slowUntil>Date.now())return base*2;
 const warm=kind==='page'?5:20;
 return state.successes>=warm*2?base/2:state.successes>=warm?base*.75:base;
}
export function recordAccessSuccess(budget:Budget,source:string,kind:'page'|'image',elapsedMs:number){
 if(budget.caps.pacingPolicy!=='adaptive')return;
 const now=Date.now(),key=keyFor(source,kind),prior=budget.store.get<Pace>(key);
 const slow=elapsedMs>(kind==='page'?15000:10000);
 budget.store.set(key,{successes:slow?0:(prior&&now-prior.lastAt<1800000?prior.successes:0)+1,lastAt:now,slowUntil:slow?now+300000:prior?.slowUntil??0});
}
export function recordAccessFailure(budget:Budget,source:string,kind:'page'|'image'){
 budget.store.set(keyFor(source,kind),{successes:0,lastAt:Date.now(),slowUntil:Date.now()+300000});
}

/** Persist the actual access time so retries/restarts cannot reset source pacing. */
export async function waitForSourceAccess(budget:Budget,source:string,kind:'page'|'image',guard=()=>budget.store.checkSource(source)){
 const key=`sourceAccessAt:${source}:${kind}`;
 while(true){
  const delay=budget.store.transaction(()=>{
   budget.check();guard();
   const now=Date.now(),last=budget.store.get<number>(key),remaining=last===undefined?0:Math.max(0,sourceGapMs(budget,source,kind)-(now-last));
   if(!remaining)budget.store.set(key,now);
   return remaining;
  });
  if(!delay)return;
  await timers.setTimeout(delay);
 }
}
