import {setTimeout as sleep} from 'node:timers/promises';
import {Store,hash} from './db.ts';
import type {Listing} from '../src/domain.ts';
export type MapLocation={status:'ready'|'unavailable';label:string;lat?:number;lon?:number;approximate?:boolean};
const known=(s:string)=>s.trim()&&!/^(unknown|not (?:confirmed|provided)|n\/a)$/i.test(s.trim());
const municipalities=/\b(?:North Vancouver|West Vancouver|Port Coquitlam|Coquitlam|Port Moody|New Westminster|White Rock|Vancouver|Burnaby|Richmond|Surrey|Delta|Langley)\b/i;
const municipalityName=(value:string)=>value.replace(/^(?:city|district|municipality|township)\s+of\s+/i,'').trim().toLowerCase();
export function locationQuery(l:Pick<Listing,'address'|'title'|'area'>){
 let address=known(l.address)?l.address.trim():/^(?:(?:Unit|Suite)\s*#?\w+\s+in\s+)?\d+\s+\S/i.test(l.title)?l.title.trim():'';
 address=address.replace(/\s*google\s+maps?\b[\s\S]*$/i,'').replace(/\s+near\s+[^,\n]+/i,'').replace(/^[^\d\n]+[-–]\s*(?=\d+\s)/,'').trim();
 address=address.replace(/^\s*(?:suite|unit|apt\.?)\s*#?\w+\s*(?:[,–-]|in\s)\s*/i,'').replace(/^\d+\s*[-–]\s*(?=\d+\s)/,'').replace(/\s*#\s*[\w-]+/g,'').replace(/,?\s+(?:suite|unit|apt\.?)\s*#?\w+/gi,'').trim();
 const street=/^\d+[A-Za-z]?\s+/.test(address);
 let label=street?address:known(l.area)?l.area.trim():'';
 if(!label)return null;
 // Sources often split the civic address and municipality into separate fields.
 // Keep a city in the advertised address authoritative; otherwise use its saved
 // area/title context before the historical Vancouver default.
 if(!municipalities.test(label)){
  const city=l.area.match(municipalities)?.[0]??l.title.match(municipalities)?.[0];
  if(city)label+=', '+city;
 }
 return {label,street,query:label+(municipalities.test(label)?'':', Vancouver')+(/\b(?:BC|British Columbia)\b/i.test(label)?'':', British Columbia')+', Canada'};
}
const words=(s:string)=>s.toLowerCase().replace(/\b(w|e|n|s|st|av|ave|rd|blvd|dr|ln)\b\.?/g,w=>({w:'west',e:'east',n:'north',s:'south',st:'street',av:'avenue',ave:'avenue',rd:'road',blvd:'boulevard',dr:'drive',ln:'lane'}[w.replace('.','')]!)).replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean);
export function chooseLocation(rows:unknown,input:NonNullable<ReturnType<typeof locationQuery>>):MapLocation{
 if(!Array.isArray(rows))return {status:'unavailable',label:input.label};
 const matches:MapLocation[]=[];
 for(const row of rows){
  if(!row||typeof row!=='object')continue;
  const lat=Number(row.lat),lon=Number(row.lon),a=row.address??{};
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<48.9||lat>49.6||lon< -123.5||lon> -122.3||a.country_code!=='ca')continue;
  const city=input.query.match(municipalities)?.[0];
  const resultCity=String(a.city??a.town??a.municipality??'');
  if(city&&municipalityName(resultCity)!==municipalityName(city))continue;
  if(input.street){
   const street=input.label.split(',')[0].replace(new RegExp('\\s+'+city+'\\b.*$','i'),''),number=street.match(/^\d+[A-Za-z]?/)![0];
   if(String(a.house_number).toLowerCase()!==number.toLowerCase())continue;
   const requested=words(street.replace(/^\d+[A-Za-z]?\s+/,'')),road=words(a.road??a.pedestrian??'');
   const types=new Set(['street','avenue','road','boulevard','drive','lane','way','place','crescent']);
   const roadWords=requested.some(w=>types.has(w))?road:road.filter(w=>!types.has(w));
   if(!requested.length||requested.sort().join(' ')!==roadWords.sort().join(' '))continue;
  }
  matches.push({status:'ready',label:input.label,lat,lon,approximate:!input.street});
 }
 if(matches.length&&(!input.street||matches.every(m=>Math.abs(m.lat!-matches[0].lat!)<=.0005&&Math.abs(m.lon!-matches[0].lon!)<=.0005)))return matches[0];
 return {status:'unavailable',label:input.label};
}
/** User-opened detail views only. Persistent cache and a single paced lookup queue. */
export class LocationMaps{
 private queue:Promise<unknown>=Promise.resolve();private pending=new Map<string,Promise<MapLocation>>();
 constructor(private store:Store,private offline=false,private lookup:typeof fetch=fetch){}
 private input(l:Listing){return locationQuery({...l,address:l.evidence.researchedAddressSource&&l.evidence.researchedAddress||l.address});}
 private cacheKey(query:string){return 'locationMap:v2:'+hash((process.env.MAP_GEOCODER_URL??'https://nominatim.openstreetmap.org/search')+'|'+query);}
 /** Share exact, already-validated research coordinates with the detail map. */
 remember(l:Listing,value:MapLocation){
  const input=this.input(l);
  if(!input?.street||value.status!=='ready'||value.approximate||!Number.isFinite(value.lat)||!Number.isFinite(value.lon)||value.lat!<48.9||value.lat!>49.6||value.lon!< -123.5||value.lon!> -122.3)throw Error('An exact verified regional address is required for map reuse');
  this.store.set(this.cacheKey(input.query),{expires:Date.now()+180*86400000,value:{...value,label:input.label,approximate:false}});
 }
 async get(l:Listing,refresh=false):Promise<MapLocation>{
  const input=this.input(l);if(!input)return {status:'unavailable',label:''};
  if(this.offline)return {status:'unavailable',label:input.label};
  const endpoint=process.env.MAP_GEOCODER_URL??'https://nominatim.openstreetmap.org/search';
  const key=this.cacheKey(input.query);
  const cached=this.store.get<{expires:number;value:MapLocation}>(key);if(!refresh&&cached&&cached.expires>Date.now())return cached.value;
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
