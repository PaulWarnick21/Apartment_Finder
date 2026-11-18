import type {Caps} from '../src/domain.ts';
import type {Budget} from './plans.ts';
import type {Source} from './sources.ts';

/** Old saved approvals retain their trial policy; new plans name their policy explicitly. */
export const sessionTraffic=(caps:Caps)=>caps.trafficPolicy==='session';
export const requestLimit=(caps:Caps)=>sessionTraffic(caps)?caps.maxPages*4+caps.maxPhotos:500*caps.sources.length;

/** Record traffic across runs without imposing trial-sized daily quotas on approved sessions. */
export function recordSourceAccess(budget:Budget,source:Source,kind:'page'|'image'|'resource'){
 if(!sessionTraffic(budget.caps)){
  const since=new Date(Date.now()-86400000).toISOString();
  const row=budget.store.db.prepare('SELECT count(*) n FROM requests WHERE source=? AND kind=? AND at>?').get(source.id,kind,since) as {n:number};
  const limit=kind==='page'?15:kind==='image'?(source.dailyImages??100):100;
  if(row.n>=limit)throw new Error(`Daily ${kind} limit reached`);
 }
 budget.store.db.prepare('INSERT INTO requests(source,at,kind) VALUES (?,?,?)').run(source.id,new Date().toISOString(),kind);
}
