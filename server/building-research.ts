import type {Store} from './db.ts';
import {hash} from './db.ts';
import {LocationMaps,locationQuery} from './location-map.ts';
import {geographicContext} from './geography.ts';
import {recurringCosts} from '../src/listing-costs.ts';
import type {Listing} from '../src/domain.ts';
import {verifiedLocationKey,applyVerifiedLocation,type VerifiedLocation} from './listing-context.ts';
import {addressGeocoder,bcAddressString,quickAddressQuery,matchQuickAddress} from './quick-location.ts';
import {setTimeout as sleep} from 'node:timers/promises';

const dataset='https://opendata.vancouver.ca/explore/dataset/issued-building-permits/';
const endpoint='https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/issued-building-permits/records';
const cacheLifetime=(result:BuildingResearch)=>result.status==='unavailable'?86400000:7*86400000;
export type BuildingResearch={checkedAt:string;status:'complete'|'partial'|'unavailable';addressStatus?:'verified'|'unavailable';area:string|null;sourceUrl:string;permits:{number:string;issued:string;address:string;description:string;url:string}[];notes:string[];requestCount:number};
const normalize=(text:string)=>text.split(',')[0].toLowerCase().replace(/\b(st|ave?|rd|blvd|dr|w|e|n|s)\b\.?/g,s=>({st:'street',av:'avenue',ave:'avenue',rd:'road',blvd:'boulevard',dr:'drive',w:'west',e:'east',n:'north',s:'south'}[s.replace('.','')]!)).replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
export function matchingPermits(value:unknown,address:string){
 const payload=value as {results?:Record<string,unknown>[];total_count?:number};
 if(!payload||!Array.isArray(payload.results))throw new Error('Building records response was not recognized');
 return {total:payload.total_count??payload.results.length,rows:payload.results.filter(row=>typeof row.address==='string'&&normalize(row.address)===normalize(address)).map(row=>({
  number:String(row.permitnumber??'').slice(0,100),issued:String(row.issuedate??'').slice(0,40),address:String(row.address).slice(0,500),description:String(row.projectdescription??'').slice(0,1000),url:dataset+'?refine.permitnumber='+encodeURIComponent(String(row.permitnumber??''))
 }))};
}
function researchKey(listing:Listing){const q=quickAddressQuery(listing);return q?.street?'buildingResearch:v2:'+hash(q.query):null;}
export class BuildingResearchService{
 private inFlight=new Map<string,Promise<BuildingResearch>>();private chain:Promise<unknown>=Promise.resolve();
 constructor(private store:Store,private maps:LocationMaps,private offline=false,private request:typeof fetch=fetch){}
 saved(listing:Listing){const key=researchKey(listing),saved=key?this.store.get<BuildingResearch>(key):undefined;return {costs:recurringCosts(listing),research:saved??null,stale:!!saved&&Date.now()-Date.parse(saved.checkedAt)>cacheLifetime(saved),airportDirections:`https://www.google.com/maps/dir/?${new URLSearchParams({api:'1',origin:locationQuery(listing)?.query??listing.area,destination:'Vancouver International Airport, British Columbia, Canada',travelmode:'transit'})}`,transitSource:'https://www.translink.ca/schedules-and-maps/trip-planner'};}
 async run(homeId:number,confirmation:string,refresh=false){
  if(confirmation!=='APPROVE TWO PUBLIC RESEARCH REQUESTS')throw new Error('Approve the bounded address and building-record check first.');
  if(this.offline)throw new Error('Building research is offline in demo mode.');
  const home=this.store.home(homeId);if(!home)throw new Error('Apartment not found');
  const key=researchKey(home.listing),query=quickAddressQuery(home.listing);
  if(!key||!query?.street){this.saveLocation(homeId,home.listing,undefined,'No complete advertised street address; downtown location could not be verified.');throw new Error('A specific advertised street address is needed for building research.');}
  const cached=this.store.get<BuildingResearch>(key);
  if(!refresh&&cached?.addressStatus&&Date.now()-Date.parse(cached.checkedAt)<cacheLifetime(cached)){
   const locationKey=verifiedLocationKey(home.listing),saved=cached.addressStatus==='verified'&&locationKey?this.store.get<VerifiedLocation>(locationKey):undefined;
   this.saveLocation(homeId,home.listing,saved,cached.notes.join(' '));return cached;
  }
  const existing=this.inFlight.get(key);if(existing)return existing;
  const pending=this.chain.then(()=>this.collect(homeId,home.listing,key,refresh));
  this.chain=pending.catch(()=>{});this.inFlight.set(key,pending);
  try{return await pending;}finally{this.inFlight.delete(key);}
 }
 private async collect(homeId:number,listing:Listing,key:string,refresh=false):Promise<BuildingResearch>{
  const result:BuildingResearch={checkedAt:new Date().toISOString(),status:'partial',area:null,sourceUrl:dataset,permits:[],notes:[],requestCount:0};
  const queryAddress=quickAddressQuery(listing);
  let map=await this.maps.get(queryAddress?{...listing,address:queryAddress.label}:listing,refresh);result.requestCount++; // Conservative upper bound: cached geocoding can use zero requests.
  const exact=()=>map.status==='ready'&&!map.approximate&&map.lat!==undefined&&map.lon!==undefined;
  let addressSource='https://nominatim.openstreetmap.org/';
  // Spend the second request on authoritative address resolution when the map cannot
  // identify the building. Never evade an access warning or exceed the two-request bound.
  if(!exact()&&queryAddress&&(this.store.get<number>('mapPauseUntil')??0)<=Date.now()&&(this.store.get<number>('quickAddressPauseUntil')??0)<=Date.now()){
   await sleep(Math.max(0,1100-(Date.now()-(this.store.get<number>('quickAddressLastRequest')??0))));
   this.store.set('quickAddressLastRequest',Date.now());result.requestCount++;
   try{
    const url=new URL(addressGeocoder);url.search=new URLSearchParams({addressString:bcAddressString(queryAddress),outputSRS:'4326',maxResults:'5',minScore:'95',autoComplete:'false',interpolation:'none'}).toString();
    const response=await this.request(url,{headers:{'User-Agent':'ApartmentFinder/0.1 (personal address research)'},signal:AbortSignal.timeout(8000),redirect:'error'});
    if([401,403,429,503].includes(response.status)){
     const retry=response.headers.get('retry-after'),delay=retry&&/^\d+$/.test(retry)?Number(retry)*1000:retry?Date.parse(retry)-Date.now():0;
     this.store.set('quickAddressPauseUntil',Date.now()+Math.max(86400000,Number.isFinite(delay)?delay:0));
    }
    if(response.ok){const raw=await response.text();if(/^\s*</.test(raw))this.store.set('quickAddressPauseUntil',Date.now()+86400000);if(raw.length>100000)throw Error('Address response too large');const match=matchQuickAddress(JSON.parse(raw),queryAddress);if(match.status==='verified'){map={status:'ready',label:queryAddress.label,lat:match.lat,lon:match.lon,approximate:false};addressSource=addressGeocoder;}}
   }catch{/* Unavailable is not evidence of an outside-downtown address. */}
  }
  if(!exact()){result.status='unavailable';result.addressStatus='unavailable';result.notes.push('Exact address could not be confirmed; downtown location remains unverified.');this.saveLocation(homeId,listing,undefined,result.notes[0]);this.store.set(key,result);return result;}
  // The detail map must reuse the same exact result, including a BC fallback,
  // rather than retaining an earlier failed lookup or re-querying a malformed ad.
  this.maps.remember?.(listing,map);
  const geography=geographicContext(map.lat!,map.lon!);result.area=geography.area;
  result.addressStatus='verified';
  const area=geography.area??queryAddress?.city;
  if(area){
   const saved:VerifiedLocation={area,downtownDistance:geography.downtownDistance??'far',checkedAt:result.checkedAt,source:geography.source.url,addressSource};
   this.saveLocation(homeId,listing,saved);
   result.notes.push(`${area}: ${saved.downtownDistance==='downtown'?'inside':'outside'} the downtown Vancouver peninsula; exact street address checked against City of Vancouver boundaries.`);
  }
  if(!geography.area){result.notes.push('This address is outside the City of Vancouver boundary dataset. No Vancouver permit query was made.');this.store.set(key,result);return result;}
  if(result.requestCount>=2){result.notes.push('The two-request allowance was used to verify the address; building permits were not checked.');this.store.set(key,result);return result;}
  const paused=this.store.get<number>('buildingResearchPausedUntil')??0;
  if(paused>Date.now()){result.notes.push('Public building records are paused after an access warning. Try after '+new Date(paused).toLocaleString());this.store.set(key,result);return result;}
  const query=quickAddressQuery(listing)!,url=new URL(endpoint);
  const street=normalize(query.label).replaceAll('"','');
  url.search=new URLSearchParams({select:'permitnumber,issuedate,address,projectdescription,geolocalarea',where:`search(address, "${street}")`,order_by:'issuedate DESC',limit:'50'}).toString();
  try{
   result.requestCount++;
   const response=await this.request(url,{headers:{'User-Agent':'ApartmentFinder/0.1 (personal building research)'},signal:AbortSignal.timeout(20000),redirect:'error'});
   if(!response.ok){this.store.set('buildingResearchPausedUntil',Date.now()+86400000);throw new Error(`Public records returned HTTP ${response.status}; further checks paused for 24 hours.`);}
   const raw=await response.text();if(raw.length>1_000_000)throw new Error('Public records response exceeded its size limit');
   const records=matchingPermits(JSON.parse(raw),query.label);result.permits=records.rows;result.status=records.total>50?'partial':'complete';
   if(records.total>50)result.notes.push('The bounded result contains at most 50 records; older permits may remain.');
   result.notes.push('Issued permits are historical records, not proof of current construction, noise, building defects, or the condition of this unit.');
   if(!records.rows.length)result.notes.push('No exact-address matches were returned. This does not establish that the building has no issues or permits.');
  }catch(error){result.status='unavailable';result.notes.push(error instanceof Error?error.message:'Building research failed');}
  this.store.set(key,result);this.store.event(`Building records checked for Apartment #${homeId}; ${result.status}.`);
  return result;
 }
 private saveLocation(homeId:number,listing:Listing,saved:VerifiedLocation|undefined,detail=''){
  this.store.transaction(()=>{
   const current=this.store.home(homeId);
   if(current&&researchKey(current.listing)===researchKey(listing)&&current.listing.address===listing.address){
    const locationKey=verifiedLocationKey(current.listing);
    if(locationKey){if(saved)this.store.set(locationKey,saved);else this.store.db.prepare('DELETE FROM meta WHERE key=?').run(locationKey);}
    const next=saved?applyVerifiedLocation(current.listing,saved):{...current.listing,evidence:{...current.listing.evidence,addressLookupStatus:'unavailable',addressLookupDetail:detail,addressLookupCheckedAt:new Date().toISOString()}};
    const at=saved?.checkedAt??new Date().toISOString();
    this.store.db.prepare('INSERT INTO history(home_id,at,event,before_json,after_json) VALUES (?,?,?,?,?)').run(current.id,at,'Address research updated',JSON.stringify(current.listing),JSON.stringify(next));
    this.store.db.prepare('UPDATE homes SET listing=?,revision=revision+1,updated_at=? WHERE id=?').run(JSON.stringify(next),at,current.id);
   }
  });
 }
}
