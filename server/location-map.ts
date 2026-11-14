import {setTimeout as sleep} from 'node:timers/promises';
import {Store,hash} from './db.ts';
import type {Listing} from '../src/domain.ts';
export type MapLocation={status:'ready'|'unavailable';label:string;lat?:number;lon?:number;approximate?:boolean};
const known=(s:string)=>s.trim()&&!/^(unknown|not (?:confirmed|provided)|n\/a)$/i.test(s.trim());
export function locationQuery(l:Pick<Listing,'address'|'title'|'area'>){
 let address=known(l.address)?l.address.trim():/^(?:(?:Unit|Suite)\s*#?\w+\s+in\s+)?\d+\s+\S/i.test(l.title)?l.title.trim():'';
 address=address.replace(/^\s*(?:suite|unit|apt\.?)\s*#?\w+\s*(?:[,–-]|in\s)\s*/i,'').replace(/^\d+\s*[-–]\s*(?=\d+\s)/,'').replace(/\s*#\s*[\w-]+/g,'').replace(/,?\s+(?:suite|unit|apt\.?)\s*#?\w+/gi,'').trim();
 const street=/^\d+[A-Za-z]?\s+/.test(address);
 const label=street?address:known(l.area)?l.area.trim():'';
 if(!label)return null;
 const city=/\b(?:Vancouver|Burnaby|Richmond|Coquitlam|Port Moody|Surrey|New Westminster|Delta|Langley)\b/i.test(label);
 return {label,street,query:label+(city?'':', Vancouver')+(/\b(?:BC|British Columbia)\b/i.test(label)?'':', British Columbia')+', Canada'};
}
const words=(s:string)=>s.toLowerCase().replace(/\b(w|e|n|s|st|av|ave|rd|blvd|dr|ln)\b\.?/g,w=>({w:'west',e:'east',n:'north',s:'south',st:'street',av:'avenue',ave:'avenue',rd:'road',blvd:'boulevard',dr:'drive',ln:'lane'}[w.replace('.','')]!)).replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean);
export function chooseLocation(rows:unknown,input:NonNullable<ReturnType<typeof locationQuery>>):MapLocation{
 if(!Array.isArray(rows))return {status:'unavailable',label:input.label};
 for(const row of rows){
  const lat=Number(row.lat),lon=Number(row.lon),a=row.address??{};
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<48.9||lat>49.6||lon< -123.5||lon> -122.3||a.country_code!=='ca')continue;
  const city=input.label.match(/\b(?:North Vancouver|West Vancouver|Vancouver|Burnaby|Richmond|Port Coquitlam|Coquitlam|Port Moody|Surrey|New Westminster|Delta|Langley)\b/i)?.[0];
  const resultCity=String(a.city??a.town??a.municipality??'');
  if(city&&resultCity&&!resultCity.toLowerCase().includes(city.toLowerCase()))continue;
  if(input.street){
   const street=input.label.split(',')[0],number=street.match(/^\d+[A-Za-z]?/)![0];
   if(String(a.house_number).toLowerCase()!==number.toLowerCase())continue;
   const requested=words(street.replace(/^\d+[A-Za-z]?\s+/,'')),road=words(a.road??a.pedestrian??'');
   if(!requested.length||!requested.every(w=>road.includes(w)))continue;
  }
  return {status:'ready',label:input.label,lat,lon,approximate:!input.street};
 }
 return {status:'unavailable',label:input.label};
}
/** User-opened detail views only. Persistent cache and a single paced lookup queue. */
export class LocationMaps{
 private queue:Promise<unknown>=Promise.resolve();private pending=new Map<string,Promise<MapLocation>>();
 constructor(private store:Store,private offline=false,private lookup:typeof fetch=fetch){}
 async get(l:Listing):Promise<MapLocation>{
  const input=locationQuery(l);if(!input)return {status:'unavailable',label:''};
  if(this.offline)return {status:'unavailable',label:input.label};
  const endpoint=process.env.MAP_GEOCODER_URL??'https://nominatim.openstreetmap.org/search';
  const key='locationMap:v1:'+hash(endpoint+'|'+input.query);
  const cached=this.store.get<{expires:number;value:MapLocation}>(key);if(cached&&cached.expires>Date.now())return cached.value;
  const existing=this.pending.get(key);if(existing)return existing;
  const task=this.queue.then(async()=>{
   let value:MapLocation={status:'unavailable',label:input.label};
   const last=this.store.get<number>('mapLastRequest')??0;await sleep(Math.max(0,1100-(Date.now()-last)));
   const pause=this.store.get<number>('mapPauseUntil')??0;if(pause>Date.now())return value;
   try{
    const url=new URL(endpoint);if(url.protocol!=='https:')throw new Error('Map lookup requires HTTPS');
    for(const [key,val] of Object.entries({q:input.query,format:'jsonv2',addressdetails:'1',limit:'5',countrycodes:'ca',viewbox:'-123.5,49.6,-122.3,48.9',bounded:'1'}))url.searchParams.set(key,val);
    this.store.set('mapLastRequest',Date.now());
    const response=await this.lookup(url,{headers:{'User-Agent':'ApartmentFinder/0.1 (https://github.com/PaulWarnick21/Apartment_Finder)','Accept-Language':'en'},signal:AbortSignal.timeout(12000),redirect:'error'});
    if([403,429,503].includes(response.status))this.store.set('mapPauseUntil',Date.now()+86400000);
    if(response.ok)value=chooseLocation(await response.json(),input);
   }catch{/* A map failure must never prevent reviewing the apartment. */}
   this.store.set(key,{expires:Date.now()+(value.status==='ready'?180*86400000:86400000),value});return value;
  });
  this.pending.set(key,task);this.queue=task.catch(()=>{});
  try{return await task;}finally{this.pending.delete(key);}
 }
}
