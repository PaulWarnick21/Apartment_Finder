import {setTimeout as sleep} from 'node:timers/promises';
import {z} from 'zod';
import type {Listing} from '../src/domain.ts';
import {hash,type Store} from './db.ts';
import type {Budget} from './plans.ts';
import {locationQuery} from './location-map.ts';
import {geographicContext} from './geography.ts';
import {sourceFilteredIntake} from './search-area.ts';

export const addressGeocoder='https://geocoder.api.gov.bc.ca/addresses.geojson';
const cities=/\b(North Vancouver|West Vancouver|Port Coquitlam|Port Moody|New Westminster|Vancouver|Burnaby|Richmond|Coquitlam|Surrey|Delta|Langley|White Rock)\b/i;
const normalize=(text:string)=>text.toLowerCase().replace(/\b(w|e|n|s|st|ave?|rd|blvd|dr|ln|cres|pl)\b\.?/g,w=>({w:'west',e:'east',n:'north',s:'south',st:'street',av:'avenue',ave:'avenue',rd:'road',blvd:'boulevard',dr:'drive',ln:'lane',cres:'crescent',pl:'place'}[w.replace('.','')]!)).replace(/(\d+)(?:st|nd|rd|th)\b/g,'$1').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
export function quickAddressQuery(l:Listing){
 // Some source address blocks include their adjacent "google map" link label.
 const addressText=l.address.replace(/\s+google\s+maps?\b[\s\S]*$/i,'').replace(/\s+/g,' ').trim();
 const initial=locationQuery({...l,address:addressText});if(!initial?.street)return null;
 const city=initial.label.match(cities)?.[0]??l.area.match(cities)?.[0]??'Vancouver';
 const address=initial.label.match(cities)?initial.label:initial.label+', '+city;
 const query=locationQuery({...l,address});
 return query?.street?{...query,city}:null;
}
type LocationResult={status:'verified'|'unavailable';detail:string;area?:string;distance?:'downtown'|'nearby'|'far';lat?:number;lon?:number;checkedAt:string};
const featureSchema=z.object({geometry:z.object({type:z.literal('Point'),coordinates:z.tuple([z.number(),z.number()])}),properties:z.object({score:z.number(),matchPrecision:z.string(),civicNumber:z.union([z.string(),z.number()]),civicNumberSuffix:z.string().optional(),streetName:z.string(),streetType:z.string().nullable().optional(),streetDirection:z.string().nullable().optional(),localityName:z.string(),provinceCode:z.string(),faults:z.array(z.object({element:z.string(),fault:z.string(),penalty:z.number()})).default([])})});
/** A street/city approximation or ambiguous address never establishes an exact location. */
export function matchQuickAddress(payload:unknown,query:NonNullable<ReturnType<typeof quickAddressQuery>>,now=Date.now()):LocationResult{
 const checkedAt=new Date(now).toISOString(),unavailable={status:'unavailable' as const,checkedAt,detail:'Address lookup could not establish one exact street address; location remains unverified'};
 const parsed=z.object({features:z.array(z.unknown())}).safeParse(payload);if(!parsed.success)return unavailable;
 const street=query.label.split(',')[0].replace(new RegExp('\\s+'+query.city+'\\b.*$','i'),''),number=street.match(/^\d+[A-Za-z]?/)?.[0];
 const requested=normalize(street.replace(/^\d+[A-Za-z]?\s+/,''));
 const matches=parsed.data.features.flatMap(raw=>{
  const valid=featureSchema.safeParse(raw);if(!valid.success)return [];
  const {geometry,properties:p}=valid.data,[lon,lat]=geometry.coordinates;
  if(p.score<95||!['CIVIC_NUMBER','SITE','UNIT'].includes(p.matchPrecision)||p.provinceCode!=='BC'||normalize(p.localityName)!==normalize(query.city))return [];
  if(lat<48.9||lat>49.6||lon< -123.5||lon> -122.3||String(p.civicNumber)+(p.civicNumberSuffix??'')!==number)return [];
  if(p.faults.some(f=>/CIVIC_NUMBER|STREET_NAME|STREET_DIRECTION|LOCALITY/.test(f.element)&&f.penalty>0))return [];
  const road=normalize([p.streetDirection,p.streetName,p.streetType].filter(Boolean).join(' '));
  // Direction may appear after the street type in source addresses.
  if(requested.split(' ').sort().join(' ')!==road.split(' ').sort().join(' '))return [];
  return [{lat,lon}];
 });
 if(!matches.length||matches.some(p=>Math.abs(p.lat-matches[0].lat)>.0005||Math.abs(p.lon-matches[0].lon)>.0005))return unavailable;
 const {lat,lon}=matches[0],geo=geographicContext(lat,lon);
 if(normalize(query.city)==='vancouver'&&!geo.area)return unavailable;
 const area=geo.area??query.city,distance=geo.downtownDistance??'far';
 return {status:'verified',checkedAt,area,distance,lat,lon,detail:`Exact address matched by BC Address Geocoder; ${area}${geo.area?' (City of Vancouver boundary)':''}`};
}
function apply(l:Listing,result:LocationResult){
 l.evidence.addressLookupStatus=result.status;l.evidence.addressLookupDetail=result.detail;
 l.evidence.addressLookupCheckedAt=result.checkedAt;l.evidence.addressLookupSource=addressGeocoder;
 if(result.status==='verified'){
  l.area=result.area!;l.downtownDistance=result.distance!;l.location=result.distance==='downtown'?'downtown':result.area==='Vancouver'?'unknown':result.distance==='nearby'?'unknown':'outside';
  l.evidence.location=result.detail;l.evidence.locationSource=addressGeocoder;
 }
}

/** One public lookup per candidate at most, only inside an explicitly bounded running plan. */
export async function resolveQuickLocation(store:Store,budget:Budget,l:Listing,homeId:number,lookup:typeof fetch=fetch){
 if(sourceFilteredIntake(store))return;
 if(store.get(`preservedQuickRank:${homeId}`))return;
 budget.check();
 const query=quickAddressQuery(l);
 if(!query){apply(l,{status:'unavailable',checkedAt:new Date().toISOString(),detail:'No complete street address was provided for location lookup'});return;}
 const key='quickAddress:v1:'+hash(query.query.toLowerCase()),cached=store.get<{expires:number;result:LocationResult}>(key);
 if(cached&&cached.expires>Date.now()){apply(l,cached.result);return;}
 const note=(detail:string)=>apply(l,{status:'unavailable',detail,checkedAt:new Date().toISOString()});
 const cap=budget.caps.maxAddressLookups??0;
 if(!cap){note('Address lookup was not included in this approved scan');return;}
 const attemptKey=`quickAddressAttempt:${budget.id}:${homeId}`;
 if(store.get(attemptKey)){note('This apartment already used its address lookup in this scan');return;}
 if((store.get<number>('quickAddressPauseUntil')??0)>Date.now()){note('Address service is paused after an access warning');return;}
 await sleep(Math.max(0,1100-(Date.now()-(store.get<number>('quickAddressLastRequest')??0))));
 budget.check();store.checkSource(l.source);
 const reserved=store.transaction(()=>{
  const used=store.get<number>(`addressLookupUsage:${budget.id}`)??0;
  if(used>=cap)return false;
  budget.reserve('requests');store.set(`addressLookupUsage:${budget.id}`,used+1);store.set(attemptKey,true);store.set('quickAddressLastRequest',Date.now());return true;
 });
 if(!reserved){note('Address lookup allowance exhausted; location remains unverified');return;}
 let result:LocationResult={status:'unavailable',checkedAt:new Date().toISOString(),detail:'Address service could not be reached; location remains unverified'};
 try{
  const url=new URL(addressGeocoder);url.search=new URLSearchParams({addressString:query.query,outputSRS:'4326',maxResults:'5',minScore:'95',autoComplete:'false',interpolation:'none'}).toString();
  const response=await lookup(url,{headers:{'User-Agent':'ApartmentFinder/0.1 (personal address lookup)','Accept':'application/geo+json,application/json'},signal:AbortSignal.timeout(8000),redirect:'error'});
  if([401,403,429,503].includes(response.status)){
   const retry=response.headers.get('retry-after'),delay=retry&&/^\d+$/.test(retry)?Number(retry)*1000:retry?Date.parse(retry)-Date.now():0;
   store.set('quickAddressPauseUntil',Date.now()+Math.max(86400000,Number.isFinite(delay)?delay:0));
  }
  if(response.ok){
   const reader=response.body?.getReader(),decoder=new TextDecoder();let raw='';
   if(reader){try{while(true){const {done,value}=await reader.read();if(done)break;raw+=decoder.decode(value,{stream:true});if(raw.length>100000)throw new Error('Address response too large');}raw+=decoder.decode();}finally{await reader.cancel();}}
   if(/^\s*</.test(raw)){store.set('quickAddressPauseUntil',Date.now()+86400000);throw new Error('Unexpected address service page');}
   result=matchQuickAddress(JSON.parse(raw),query);
  }else result.detail=`Address service returned HTTP ${response.status}; location remains unverified`;
 }catch{/* A failed lookup does not reject or remove the apartment. */}
 store.set(key,{expires:Date.now()+(result.status==='verified'?180:1)*86400000,result});
 apply(l,result);budget.check();
}
