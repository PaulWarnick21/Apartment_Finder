import timers from 'node:timers/promises';
import type {Budget} from './plans.ts';

/** Persist the actual access time so retries/restarts cannot reset source pacing. */
export async function waitForSourceAccess(budget:Budget,source:string,kind:'page'|'image',guard=()=>budget.store.checkSource(source)){
 const key=`sourceAccessAt:${source}:${kind}`,gap=kind==='page'?10000:1000;
 while(true){
  const delay=budget.store.transaction(()=>{
   budget.check();guard();
   const now=Date.now(),last=budget.store.get<number>(key),remaining=last===undefined?0:Math.max(0,gap-(now-last));
   if(!remaining)budget.store.set(key,now);
   return remaining;
  });
  if(!delay)return;
  await timers.setTimeout(delay);
 }
}
