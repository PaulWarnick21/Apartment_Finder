import type {Store} from './db.ts';
import {hash} from './db.ts';
import {LocationMaps,locationQuery} from './location-map.ts';
import {geographicContext} from './geography.ts';
import {recurringCosts} from '../src/listing-costs.ts';
import type {Listing} from '../src/domain.ts';
import {verifiedLocationKey,applyVerifiedLocation,type VerifiedLocation} from './listing-context.ts';

const dataset='https://opendata.vancouver.ca/explore/dataset/issued-building-permits/';
const endpoint='https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/issued-building-permits/records';
const cacheLifetime=(result:BuildingResearch)=>result.status==='unavailable'?86400000:7*86400000;
export type BuildingResearch={checkedAt:string;status:'complete'|'partial'|'unavailable';area:string|null;sourceUrl:string;permits:{number:string;issued:string;address:string;description:string;url:string}[];notes:string[];requestCount:number};
const normalize=(text:string)=>text.split(',')[0].toLowerCase().replace(/\b(st|ave?|rd|blvd|dr|w|e|n|s)\b\.?/g,s=>({st:'street',av:'avenue',ave:'avenue',rd:'road',blvd:'boulevard',dr:'drive',w:'west',e:'east',n:'north',s:'south'}[s.replace('.','')]!)).replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
export function matchingPermits(value:unknown,address:string){
 const payload=value as {results?:Record<string,unknown>[];total_count?:number};
 if(!payload||!Array.isArray(payload.results))throw new Error('Building records response was not recognized');
 return {total:payload.total_count??payload.results.length,rows:payload.results.filter(row=>typeof row.address==='string'&&normalize(row.address)===normalize(address)).map(row=>({
  number:String(row.permitnumber??'').slice(0,100),issued:String(row.issuedate??'').slice(0,40),address:String(row.address).slice(0,500),description:String(row.projectdescription??'').slice(0,1000),url:dataset+'?refine.permitnumber='+encodeURIComponent(String(row.permitnumber??''))
 }))};
}
function researchKey(listing:Listing){const q=locationQuery(listing);return q?.street?'buildingResearch:v1:'+hash(q.query):null;}
export class BuildingResearchService{
 private inFlight=new Map<string,Promise<BuildingResearch>>();private chain:Promise<unknown>=Promise.resolve();
 constructor(private store:Store,private maps:LocationMaps,private offline=false,private request:typeof fetch=fetch){}
 saved(listing:Listing){const key=researchKey(listing),saved=key?this.store.get<BuildingResearch>(key):undefined;return {costs:recurringCosts(listing),research:saved??null,stale:!!saved&&Date.now()-Date.parse(saved.checkedAt)>cacheLifetime(saved),airportDirections:`https://www.google.com/maps/dir/?${new URLSearchParams({api:'1',origin:locationQuery(listing)?.query??listing.area,destination:'Vancouver International Airport, British Columbia, Canada',travelmode:'transit'})}`,transitSource:'https://www.translink.ca/schedules-and-maps/trip-planner'};}
 async run(homeId:number,confirmation:string){
  if(confirmation!=='APPROVE TWO PUBLIC RESEARCH REQUESTS')throw new Error('Approve the bounded address and building-record check first.');
  if(this.offline)throw new Error('Building research is offline in demo mode.');
  const home=this.store.home(homeId);if(!home)throw new Error('Apartment not found');
  const key=researchKey(home.listing),query=locationQuery(home.listing);
  if(!key||!query?.street)throw new Error('A specific advertised street address is needed for building research.');
  const cached=this.store.get<BuildingResearch>(key);
  if(cached&&Date.now()-Date.parse(cached.checkedAt)<cacheLifetime(cached))return cached;
  const existing=this.inFlight.get(key);if(existing)return existing;
  const pending=this.chain.then(()=>this.collect(homeId,home.listing,key));
  this.chain=pending.catch(()=>{});this.inFlight.set(key,pending);
  try{return await pending;}finally{this.inFlight.delete(key);}
 }
 private async collect(homeId:number,listing:Listing,key:string):Promise<BuildingResearch>{
  const result:BuildingResearch={checkedAt:new Date().toISOString(),status:'partial',area:null,sourceUrl:dataset,permits:[],notes:[],requestCount:0};
  const map=await this.maps.get(listing);result.requestCount++; // Conservative upper bound: cached geocoding can use zero requests.
  if(map.status!=='ready'||map.approximate||map.lat===undefined||map.lon===undefined){result.status='unavailable';result.notes.push('Exact address could not be confirmed; no building-record query was made.');this.store.set(key,result);return result;}
  const geography=geographicContext(map.lat,map.lon);result.area=geography.area;
  if(!geography.area){result.notes.push('This address is outside the City of Vancouver boundary dataset. No Vancouver permit query was made.');this.store.set(key,result);return result;}
  const paused=this.store.get<number>('buildingResearchPausedUntil')??0;
  if(paused>Date.now()){result.notes.push('Public building records are paused after an access warning. Try after '+new Date(paused).toLocaleString());return result;}
  const query=locationQuery(listing)!,url=new URL(endpoint);
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
  // Only a verified exact street match may refine area; notes/stages/photos are untouched.
  this.store.transaction(()=>{
   const current=this.store.home(homeId);
   if(current&&researchKey(current.listing)===key){
    const saved:VerifiedLocation={area:geography.area!,downtownDistance:geography.downtownDistance!,checkedAt:result.checkedAt,source:geography.source.url};
    const locationKey=verifiedLocationKey(current.listing);if(locationKey)this.store.set(locationKey,saved);
    const next=applyVerifiedLocation(current.listing,saved);
    this.store.db.prepare('INSERT INTO history(home_id,at,event,before_json,after_json) VALUES (?,?,?,?,?)').run(current.id,result.checkedAt,'Address research updated',JSON.stringify(current.listing),JSON.stringify(next));
    this.store.db.prepare('UPDATE homes SET listing=?,revision=revision+1,updated_at=? WHERE id=?').run(JSON.stringify(next),result.checkedAt,current.id);
   }
   this.store.set(key,result);this.store.event(`Building records checked for Apartment #${homeId}; ${result.status}.`);
  });
  return result;
 }
}
