import type {Store} from './db.ts';
import type {AvailabilityObservation} from '../src/availability.ts';
import {summarizeAvailability} from '../src/availability.ts';

export type SavedPosting={source:string;sourceId:string;url:string};
export const observationKey=(p:SavedPosting)=>`availabilityPosting:${p.source}:${p.sourceId}`;
export function availabilityPostings(store:Store,id:number):SavedPosting[]{
 return store.db.prepare('SELECT source,source_id AS sourceId,url FROM postings WHERE home_id=? ORDER BY source,source_id').all(id) as SavedPosting[];
}
export function homeAvailability(store:Store,id:number,possibleDuplicates:boolean){
 const postings=availabilityPostings(store,id).map(p=>{
  const saved=store.get<AvailabilityObservation>(observationKey(p));
  return saved?.url===p.url?saved:{...p,status:'unknown' as const,checkedAt:'',runId:'',evidence:'Not checked yet'};
 });
 const summary=summarizeAvailability(postings,possibleDuplicates);
 if(summary?.status==='unavailable'){
  const check=store.get<{state:string;checkedAt:string;detail:string}>(`availabilityCrossCheck:${id}`);
  if(check?.state!=='checked'||Date.now()-Date.parse(check.checkedAt)>36*3600000)return {...summary,status:'unknown' as const,detail:check?.detail??'Saved posting expired; other sources still need checking before the apartment can be marked unavailable.'};
 }
 return summary;
}
