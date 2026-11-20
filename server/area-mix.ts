import {randomUUID} from 'node:crypto';
import type {Store} from './db.ts';
import type {Budget} from './plans.ts';
import type {Listing} from '../src/domain.ts';
import {areaSearchRoute,searchAreaExclusion,searchRegion,sourceFilteredIntake,type SearchAreaPolicy} from './search-area.ts';
import {quickRank} from './quick-rank.ts';

export type AreaMixPolicy={downtownShare:number;configuredAt:string;baselineHomeIds:number[]};
export type AreaMixBucket='downtown'|'north-west';
export type AreaMixFields={area?:string;city?:string;address?:string;evidence?:Record<string,string>;searchUrl?:string;searchRegion?:string;homeId?:number};
type Admission={homeId:number;bucket:AreaMixBucket;at:string};
type Claim={token:string;planId:string;source:string;url:string;bucket:AreaMixBucket;epoch:string};
const claimsKey='areaMixClaims';
const admissionsKey=(policy:AreaMixPolicy)=>`areaMixAdmissions:${policy.configuredAt}`;
const bucket=(region:string|undefined):AreaMixBucket|undefined=>region==='downtown-vancouver'?'downtown':region==='north-vancouver'||region==='west-vancouver'?'north-west':undefined;

function policy(store:Store){
 const value=store.get<AreaMixPolicy>('areaMixPolicy');
 return value&&Number.isFinite(value.downtownShare)&&value.downtownShare>=0&&value.downtownShare<=1&&typeof value.configuredAt==='string'&&Array.isArray(value.baselineHomeIds)?value:undefined;
}
export function mixEnabled(store:Store,budget?:Budget){
 if(!policy(store)||!sourceFilteredIntake(store))return false;
 if(!budget)return true;
 const caps=budget.caps;
 return caps.purpose==='listings'&&caps.phase!=='inventory'&&!caps.fullReviewHomeIds?.length&&!caps.cachedReviewOnly&&
  (caps.assessmentMode==='quick'||!caps.assessmentMode&&store.get<{mode:string}>('reviewWorkflow')?.mode==='quick-first');
}
/** Scoped facts take precedence over route provenance; titles/views do not locate a home. */
export function areaMixBucket(store:Store,source:string,fields:AreaMixFields):AreaMixBucket|undefined{
 const url=fields.searchUrl??fields.evidence?.searchAreaSourceUrl,region=fields.searchRegion??fields.evidence?.searchAreaRegion;
 const route=url?areaSearchRoute(store,source,url):undefined;
 // Approximate Vancouver candidates belong to the Downtown discovery work pool;
 // this is scheduling provenance, not a claim about their exact location.
 if(route?.scope==='vancouver-approximate'&&route.region===region)return 'downtown';
 const explicit=searchRegion(fields);if(explicit!=='unknown')return bucket(explicit);
 return route&&route.region===region?bucket(route.region):undefined;
}
function resolveAliases(store:Store){
 const aliases=new Map((store.db.prepare('SELECT alias,canonical FROM home_aliases').all() as {alias:number;canonical:number}[]).map(row=>[row.alias,row.canonical]));
 return (id:number)=>{const seen=new Set<number>();while(aliases.has(id)){if(seen.has(id))throw Error('Apartment alias cycle');seen.add(id);id=aliases.get(id)!;}return id;};
}
function baseline(store:Store,value:AreaMixPolicy){const resolve=resolveAliases(store);return new Set(value.baselineHomeIds.map(resolve));}
function admissions(store:Store,value:AreaMixPolicy){
 const resolve=resolveAliases(store),old=new Set(value.baselineHomeIds.map(resolve)),seen=new Set<number>();
 const existing=new Set((store.db.prepare('SELECT id FROM homes').all() as {id:number}[]).map(row=>row.id));
 return (store.get<Admission[]>(admissionsKey(value))??[]).flatMap(entry=>{
  const homeId=resolve(entry.homeId);
  if(old.has(homeId)||seen.has(homeId)||!existing.has(homeId))return [];
  seen.add(homeId);return [{...entry,homeId}];
 });
}
function claims(store:Store,value:AreaMixPolicy){
 const active=new Set((store.db.prepare("SELECT id FROM plans WHERE state IN ('approved','running')").all() as {id:string}[]).map(row=>row.id));
 return (store.get<Claim[]>(claimsKey)??[]).filter(claim=>claim.epoch===value.configuredAt&&active.has(claim.planId));
}
/** Exhaustion is explicit checked inventory, never a fetch failure or missing route. */
function drained(store:Store,wanted:AreaMixBucket,value:AreaMixPolicy){
 if(claims(store,value).some(claim=>claim.bucket===wanted))return false;
 const area=store.get<SearchAreaPolicy>('searchAreaPolicy');
 const roots=Object.entries(area?.sourceRoutes??{}).flatMap(([source,routes])=>routes.filter(route=>area!.regions.includes(route.region)&&bucket(route.region)===wanted).map(route=>({source,url:route.url})));
 if(!roots.length)return false;
 for(const root of roots){
  const coverage=store.get<Array<{url:string;status:string;next:string|null;refreshNeeded?:boolean;dynamicPending?:boolean}>>(`inventoryCoverage:${root.source}`)?.find(route=>route.url===root.url);
  if(!coverage||coverage.status!=='exhausted'||coverage.next||coverage.refreshNeeded||coverage.dynamicPending)return false;
 }
 for(const source of new Set(roots.map(root=>root.source))){
  const queue=store.get<{urls?:string[];cards?:Record<string,AreaMixFields>;offerings?:Listing[];next?:string|null}>(`discoveryQueue:${source}`);
  if(queue?.urls?.some(url=>areaMixBucket(store,source,queue.cards?.[url]??{})===wanted&&!store.db.prepare('SELECT 1 FROM postings WHERE source=? AND url=?').get(source,url)))return false;
  if(queue?.offerings?.some(listing=>areaMixBucket(store,source,listing)===wanted&&!store.db.prepare('SELECT 1 FROM postings WHERE source=? AND source_id=?').get(source,listing.sourceId)))return false;
  if(queue?.next&&bucket(areaSearchRoute(store,source,queue.next)?.region)===wanted)return false;
 }
 const resolve=resolveAliases(store),old=new Set(value.baselineHomeIds.map(resolve));
 for(const row of store.db.prepare("SELECT id,listing FROM homes WHERE id NOT IN (SELECT alias FROM home_aliases) AND stage NOT IN ('Not Interested','Closed','Leased')").all() as {id:number;listing:string}[]){
  if(old.has(resolve(row.id)))continue;
  const listing=JSON.parse(row.listing) as Listing;
  if(areaMixBucket(store,listing.source,listing)!==wanted||!quickRank(listing,store.criteria,row.id).eligible)continue;
  if(!listing.galleryComplete||listing.photos.some(photo=>!photo.local&&photo.status!=='unavailable'))return false;
 }
 return true;
}
export function areaMixProgress(store:Store){
 const value=policy(store);
 if(!value||!sourceFilteredIntake(store))return {downtown:0,northWest:0,total:0,claimedDowntown:0,claimedNorthWest:0,downtownDrained:false,northWestDrained:false};
 const saved=admissions(store,value),pending=claims(store,value);
 const downtown=saved.filter(entry=>entry.bucket==='downtown').length,northWest=saved.length-downtown;
 return {downtown,northWest,total:saved.length,claimedDowntown:pending.filter(entry=>entry.bucket==='downtown').length,claimedNorthWest:pending.filter(entry=>entry.bucket==='north-west').length,downtownDrained:drained(store,'downtown',value),northWestDrained:drained(store,'north-west',value)};
}
function northWestAllowed(value:AreaMixPolicy,progress:ReturnType<typeof areaMixProgress>){
 if(progress.downtownDrained)return true;
 const used=progress.northWest+progress.claimedNorthWest;
 return used<Math.round((progress.downtown+used+1)*(1-value.downtownShare));
}
export function preferredAreaBucket(store:Store):AreaMixBucket{
 const value=policy(store);if(!value||!sourceFilteredIntake(store))return 'downtown';
 const progress=areaMixProgress(store);
 return !progress.northWestDrained&&northWestAllowed(value,progress)?'north-west':'downtown';
}
export function tryReserveAreaCandidate(store:Store,budget:Budget,source:string,url:string,fields:AreaMixFields):{allowed:boolean;token?:string;reason?:string}{
 if(!mixEnabled(store,budget))return {allowed:true};
 return store.transaction(()=>{
  const value=policy(store)!,live=claims(store,value),prior=live.find(claim=>claim.planId===budget.id&&claim.source===source&&claim.url===url);
  const remaining=live.filter(claim=>claim!==prior),selected=areaMixBucket(store,source,fields);
  const homeId=fields.homeId===undefined?undefined:store.resolveHomeId(fields.homeId);
  const already=homeId!==undefined&&(baseline(store,value).has(homeId)||admissions(store,value).some(entry=>entry.homeId===homeId));
  // Rechecking parsed facts replaces the earlier search-card claim atomically.
  store.set(claimsKey,remaining);
  if(already||!selected)return {allowed:true};
  if(selected==='north-west'&&!northWestAllowed(value,areaMixProgress(store)))return {allowed:false,reason:'North/West Vancouver is waiting for the configured Downtown share; queued listing retained.'};
  const token=prior?.token??randomUUID();remaining.push({token,planId:budget.id,source,url,bucket:selected,epoch:value.configuredAt});store.set(claimsKey,remaining);
  return {allowed:true,token};
 });
}
/** An admission is sticky: closing a home later never increases the other area's quota. */
export function settleAreaCandidate(store:Store,budget:Budget,token:string|undefined,homeId?:number){
 if(!mixEnabled(store,budget))return;
 store.transaction(()=>{
  const value=policy(store)!,live=claims(store,value);
  store.set(claimsKey,live.filter(claim=>!(claim.token===token&&claim.planId===budget.id)));
  if(homeId===undefined)return;
  const resolved=store.resolveHomeId(homeId),saved=admissions(store,value);
  if(baseline(store,value).has(resolved)||saved.some(entry=>entry.homeId===resolved))return;
  const home=store.home(resolved);if(!home)return;
  const selected=areaMixBucket(store,home.listing.source,home.listing);
  if(!selected||!quickRank(home.listing,store.criteria,resolved).eligible||!home.listing.photos.some(photo=>!!photo.local)||searchAreaExclusion(store,home.listing,true))return;
  saved.push({homeId:resolved,bucket:selected,at:new Date().toISOString()});store.set(admissionsKey(value),saved);
 });
}
export function releaseAreaClaims(store:Store,planId:string){store.transaction(()=>{store.set(claimsKey,(store.get<Claim[]>(claimsKey)??[]).filter(claim=>claim.planId!==planId));});}
export function areaMixRevision(store:Store){
 const value=policy(store);if(!value)return 'off';
 return JSON.stringify([value.configuredAt,admissions(store,value).map(entry=>[entry.homeId,entry.bucket]),claims(store,value).map(claim=>claim.token).sort(),drained(store,'downtown',value),drained(store,'north-west',value)]);
}
