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
 return summarizeAvailability(postings,possibleDuplicates);
}
