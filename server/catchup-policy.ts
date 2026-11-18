import {chooseSource,type SourceSelectionState,type SourceYieldStat} from './source-yield.ts';

type CoverageRow={queued:number;pendingEvidence:number;extractionIssues:number;routes:readonly {status:string}[]};
/** Exhausted checked routes are a bounded coverage result, never a claim about the entire market. */
export function checkedInventoryCaughtUp(rows:readonly CoverageRow[]){
 return rows.length>0&&rows.every(row=>row.queued===0&&row.pendingEvidence===0&&row.extractionIssues===0&&row.routes.length>0&&row.routes.every(route=>route.status==='exhausted'));
}

/** Priority changes the order of unfinished work, not which sources remain in scope.
 * After catching up, give every source a fresh pass before favoring new backlog. */
export function chooseQuickCatchupPhase(inventory:readonly string[],candidates:readonly string[],stats:readonly SourceYieldStat[],state:SourceSelectionState,maintenance=false,surveyed:readonly string[]=[]){
 const fresh=maintenance?inventory.find(source=>!surveyed.includes(source)):undefined;
 if(fresh)return {phase:'inventory' as const,source:fresh,mode:'exploration' as const,basis:'Caught-up maintenance: check each available source for fresh inventory before prioritizing backlog'};
 const preferred=chooseSource([...new Set([...candidates,...inventory])],stats,state);
 return preferred?{...preferred,phase:candidates.includes(preferred.source)?'assessment' as const:'inventory' as const}:null;
}

/** Survey each accessible source, then alternate inventory expansion and assessment. */
export function chooseCatchupPhase(inventory:string[],candidates:string[],available:string[],surveyed:string[],lastPhase?:string){
 const assessedTurn=lastPhase==='inventory'&&available.every(id=>surveyed.includes(id))&&candidates.length>0;
 if(inventory.length&&!assessedTurn)return {phase:'inventory' as const,source:inventory[0]};
 if(candidates.length)return {phase:'assessment' as const,source:candidates[0]};
 return null;
}

/** Discovery activity must not postpone a source's independent assessment turn. */
export function phaseSourceVisits(plans:readonly {created_at:string;caps:{phase?:string;sources:readonly string[]}}[]){
 const visits:{inventory:Record<string,string>;assessment:Record<string,string>}={inventory:{},assessment:{}};
 for(const plan of plans){
  const phase=plan.caps.phase;if(phase!=='inventory'&&phase!=='assessment')continue;
  for(const source of plan.caps.sources)if(plan.created_at>(visits[phase][source]??''))visits[phase][source]=plan.created_at;
 }
 return visits;
}

export type DailyScanCaps={pages:number;listings:number;photos:number;aiCalls:number};
export type RunPolicy={dailyCaps:DailyScanCaps;runOverride?:{authorizedAt:string;expiresAt:string;dailyCaps:DailyScanCaps;reason:string}};
/** A dated execution exception cannot carry larger daily limits into the next run. */
export function effectiveRunPolicy(policy:RunPolicy,now=Date.now()){
 const override=policy.runOverride;
 const active=override&&Date.parse(override.authorizedAt)<=now&&now<Date.parse(override.expiresAt);
 const dailyCaps=active?override.dailyCaps:policy.dailyCaps;
 if(!['pages','listings','photos','aiCalls'].every(k=>Number.isSafeInteger(dailyCaps[k as keyof DailyScanCaps])&&dailyCaps[k as keyof DailyScanCaps]>0))throw Error('Invalid daily scan allowance');
 return {dailyCaps,...(active?{until:Date.parse(override.expiresAt)}:{})};
}
