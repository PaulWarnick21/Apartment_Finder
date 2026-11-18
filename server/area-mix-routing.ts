import type {Store} from './db.ts';
import {areaMixBucket,mixEnabled,preferredAreaBucket} from './area-mix.ts';
import {areaSearchRoute} from './search-area.ts';

type Bucket='downtown'|'north-west';
type ScopedFields=Parameters<typeof areaMixBucket>[2];
type Route={url:string;next:string|null;status:string;checkedAt?:string};
export type AreaSourceWork={source:string;routes:readonly Route[];candidates:readonly ScopedFields[]};

const routeBucket=(store:Store,source:string,url:string):Bucket|undefined=>{
 const region=areaSearchRoute(store,source,url)?.region;
 return region==='downtown-vancouver'?'downtown':region==='north-vancouver'||region==='west-vancouver'?'north-west':undefined;
};

/** Keep the existing freshness order inside a region, but use the desired region
 * first so one North/West route cannot dilute every downtown discovery phase. */
export function prioritizeInventoryAreas<T extends Route>(store:Store,source:string,routes:readonly T[]):T[]{
 const preferred=mixEnabled(store)?preferredAreaBucket(store):undefined;
 return [...routes].sort((a,b)=>(preferred?Number(routeBucket(store,source,b.url)===preferred)-Number(routeBucket(store,source,a.url)===preferred):0)||(a.checkedAt??'').localeCompare(b.checkedAt??''));
}

/** Choose the regional work pool before applying source interest/yield ordering.
 * A ready secondary queue cannot outrank still-unchecked primary searches. */
export function catchupAreaWork(store:Store,inventory:readonly string[],candidates:readonly string[],work:readonly AreaSourceWork[]){
 if(!mixEnabled(store))return {inventory:[...inventory],candidates:[...candidates]};
 const preferred=preferredAreaBucket(store),bySource=new Map(work.map(row=>[row.source,row]));
 const pool=(bucket:Bucket)=>({
  inventory:inventory.filter(source=>bySource.get(source)?.routes.some(route=>route.next&&['pending','partial'].includes(route.status)&&routeBucket(store,source,route.url)===bucket)),
  candidates:candidates.filter(source=>bySource.get(source)?.candidates.some(candidate=>areaMixBucket(store,source,candidate)===bucket)),
 });
 const desired=pool(preferred);
 if(desired.inventory.length||desired.candidates.length)return {...desired,focus:preferred};
 // Downtown can always keep making progress if the smaller North/West share has
 // no schedulable work. The reverse requires the policy's checked-drain proof.
 if(preferred==='north-west'){
  const downtown=pool('downtown');
  if(downtown.inventory.length||downtown.candidates.length)return {...downtown,focus:'downtown' as const};
 }
 return {inventory:[],candidates:[],focus:preferred,reason:preferred==='downtown'?'Downtown-first intake is waiting on unresolved geographic coverage; failed or unverified searches are not exhausted inventory.':'No new work is schedulable within the checked geographic searches.'};
}
