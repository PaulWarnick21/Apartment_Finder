import type {Store} from './db.ts';
import type {Home} from '../src/domain.ts';
import {sourceInterestOutcome,sourceYieldStats,type SourceDecision} from './source-yield.ts';

/** Read actual choice dates, never listing refresh dates. Note edits, later
 * workflow steps and repeated scans do not renew an old source success. */
export function savedSourceDecisions(store:Store,homes:readonly Home[]=store.homes()):SourceDecision[]{
 const canonical=new Map<number,Home>();
 for(const home of homes)for(const id of [home.id,...(home.aliases??[])])canonical.set(id,home);
 const decisions=new Map<number,SourceDecision>(),handled=new Set<number>();
 const rows=store.db.prepare("SELECT home_id,at,before_json,after_json FROM history WHERE event='Decision saved' ORDER BY id DESC").all() as {home_id:number;at:string;before_json:string;after_json:string}[];
 for(const row of rows){
  const home=canonical.get(row.home_id);if(!home||handled.has(home.id)||home.stage==='Unreviewed')continue;
  const before=JSON.parse(row.before_json).stage,after=JSON.parse(row.after_json).stage;
  if(before===after)continue;
  const outcome=sourceInterestOutcome(after);
  // Advancing Interested to Ready to Apply (etc.) is the same choice, not a
  // second success. Closing a previously positive home retains that choice.
  if(after!=='Unreviewed'&&(outcome===null||outcome===sourceInterestOutcome(before)))continue;
  handled.add(home.id);
  if(outcome!==null)decisions.set(home.id,{homeId:home.id,interested:outcome,at:row.at});
 }
 for(const home of homes){
  if(handled.has(home.id)||home.stage==='Unreviewed')continue;
  const outcome=sourceInterestOutcome(home.stage);
  if(outcome!==null)decisions.set(home.id,{homeId:home.id,interested:outcome,at:home.firstSeen});
 }
 return [...decisions.values()];
}

export function savedSourceYieldStats(store:Store,now=Date.now(),homes:Home[]=store.homes()){
 return sourceYieldStats(homes,{now,decisions:savedSourceDecisions(store,homes)});
}
