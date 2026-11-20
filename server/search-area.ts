import type {Listing} from '../src/domain.ts';
import type {Store} from './db.ts';
import {vancouverNeighbourhoodNames} from './geography.ts';
import {mainlandExclusion,type MainlandLocationFields} from './mainland-location.ts';

export type SearchRegion='downtown-vancouver'|'west-vancouver'|'north-vancouver';
export type AreaSearchRoute={url:string;region:SearchRegion;scope?:'vancouver-approximate'};
export type SearchAreaPolicy={regions:SearchRegion[];existingHomeIds:number[];configuredAt:string;mode?:'address'|'source-filters';sourceRoutes?:Record<string,AreaSearchRoute[]>};
const labels:Record<SearchRegion,string>={'downtown-vancouver':'Downtown Vancouver','west-vancouver':'West Vancouver','north-vancouver':'North Vancouver'};
const normalize=(text:string)=>text.toLowerCase().replace(/[-_]/g,' ').replace(/\s+/g,' ').trim();
const municipalities=/\b(?:north vancouver|west vancouver|port coquitlam|port moody|new westminster|vancouver|burnaby|richmond|coquitlam|surrey|delta|langley|white rock|ubc|victoria|kelowna|toronto|calgary|ottawa|edmonton)\b/gi;
const downtown=new Set(['downtown','downtown vancouver','west end','coal harbour','coal harbor','yaletown','gastown','english bay','davie village']);
// These neighbourhoods border the core. A name alone is approximate evidence, not
// proof of a measured four-kilometre radius or an exact address.
const nearby=new Set(['fairview','kitsilano','mount pleasant','strathcona','false creek','olympic village','chinatown','downtown eastside']);
const neighbourhoods=new Set(vancouverNeighbourhoodNames.map(normalize));
type LocationFields=MainlandLocationFields&{source?:string;searchUrl?:string;searchRegion?:string};
const areaName=(fields:LocationFields)=>normalize(fields.area??'').replace(/,?\s+(?:vancouver)(?:,?\s+bc)?$/,'').replace(/,?\s+bc$/,'');

export function sourceFilteredIntake(store:Store){return store.get<SearchAreaPolicy>('searchAreaPolicy')?.mode==='source-filters';}
export function areaSearchRoutes(store:Store,source:string){const p=store.get<SearchAreaPolicy>('searchAreaPolicy');return (p?.sourceRoutes?.[source]??[]).filter(r=>p!.regions.includes(r.region));}
/** Only configured geographic searches and their pagination carry area provenance. */
export function areaSearchRoute(store:Store,source:string,url:string){
 try{const candidate=new URL(url);return areaSearchRoutes(store,source).find(route=>{
  const root=new URL(route.url),path=root.pathname.replace(/\/$/,'');
  // Zillow advertises /2_p/, /3_p/, ... below the same geographic search path.
  // Do not accept another neighbourhood or an arbitrary descendant as pagination.
  const page=source==='zillow'?'[1-9]\\d*_p':source==='rew'?'page/[1-9]\\d*':'[1-9]\\d*';
  const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  // Kijiji inserts the advertised page segment before the fixed category/location ID.
  const kijijiPage=source==='kijiji'&&/^\/b-apartments-condos\/[^/]+\/[^/]+\/c\d+l\d+(?:a\d+)?$/.test(path)
   &&new RegExp('^'+escape(path.slice(0,path.lastIndexOf('/')))+'/page-[1-9]\\d*'+escape(path.slice(path.lastIndexOf('/')))+'/?$').test(candidate.pathname);
  const samePath=candidate.pathname.replace(/\/$/,'')===path||new RegExp('^'+escape(path)+'/'+page+'/?$').test(candidate.pathname)||kijijiPage;
  // Zillow's searchQueryState can replace map bounds/region IDs despite an unchanged
  // pathname. Only plain source-advertised page URLs establish scope here.
  const sameZillowQuery=!['zillow','rew'].includes(source)||[...candidate.searchParams].every(([key,value])=>root.searchParams.get(key)===value);
  const sameFallbackLocation=route.scope!=='vancouver-approximate'||[...candidate.searchParams].every(([key,value])=>!/^_?(?:city|region|location|latitude|longitude|lat|lon|radius|search_distance)$/i.test(key)||root.searchParams.get(key)===value);
  return root.origin===candidate.origin&&samePath&&sameZillowQuery&&sameFallbackLocation&&[...root.searchParams].every(([key,value])=>candidate.searchParams.get(key)===value);
 });}catch{return undefined;}
}
export function intakeSearchUrls(store:Store,source:{id:string;search:string}){
 const retired=new Set((store.get<{url:string;status:string}[]>(`inventoryCoverage:${source.id}`)??[]).filter(r=>r.status==='superseded').map(r=>r.url));
 return (sourceFilteredIntake(store)?areaSearchRoutes(store,source.id).map(r=>r.url):[source.search]).filter(url=>!retired.has(url));
}
export function applySearchArea(store:Store,listing:Listing,card?:{searchUrl?:string;searchRegion?:string}){
 if(!sourceFilteredIntake(store)||!card?.searchUrl)return listing;
 const route=areaSearchRoute(store,listing.source,card.searchUrl);if(!route||route.region!==card.searchRegion)return listing;
 listing.evidence.searchAreaRegion=route.region;listing.evidence.searchAreaSourceUrl=card.searchUrl;
 if(route.scope==='vancouver-approximate'){
  listing.evidence.searchAreaScope=route.scope;
  listing.evidence.searchAreaBasis='Vancouver-wide discovery with approximate Downtown preference; exact address and 4 km radius not independently verified';
  if(nearby.has(areaName(listing))&&listing.downtownDistance==='unknown')listing.downtownDistance='nearby';
  return listing;
 }
 listing.evidence.searchAreaBasis='Website geographic search filter; exact address not independently verified';
 if(searchRegion(listing)==='unknown'){
  listing.area=labels[route.region];listing.location=route.region==='downtown-vancouver'?'downtown':'outside';
  listing.downtownDistance=route.region==='downtown-vancouver'?'downtown':'far';
 }
 return listing;
}

/** Municipality/address and scoped neighbourhood fields only; nearby attractions and views
 * in a title or description cannot establish the apartment's location. */
export function searchRegion(fields:LocationFields):SearchRegion|'outside'|'unknown'{
 const area=areaName(fields);
 const place=fields.evidence?.addressLookupStatus==='verified'?fields.area??'':fields.city||fields.address||fields.area||'';
 const cities=[...new Set(normalize(place).match(municipalities)??normalize(fields.area??'').match(municipalities)??[])];
 if(cities.length>1)return 'unknown';
 const city=cities[0];
 if(city==='north vancouver'||city==='west vancouver')return city==='north vancouver'?'north-vancouver':'west-vancouver';
 if(city&&city!=='vancouver')return 'outside';
 if(downtown.has(area))return 'downtown-vancouver';
 if(neighbourhoods.has(area))return 'outside';
 return 'unknown';
}

export function searchAreaSummary(store:Store){const policy=store.get<SearchAreaPolicy>('searchAreaPolicy');return policy?.regions.length?policy.regions.map(region=>labels[region]).join(', '):undefined;}
/** Saved desk decisions can be retained without granting future source visits outside
 * the current scan scope. This applies to pending galleries and facts refreshes too. */
export function scanAreaExclusion(store:Store,listing:Listing){return searchAreaExclusion(store,{...listing,homeId:undefined},sourceFilteredIntake(store));}
export function searchAreaExclusion(store:Store,listing:Listing,requireKnown=false){
 const mainlandFailure=mainlandExclusion(listing,store.criteria.mainlandOnly);if(mainlandFailure)return mainlandFailure;
 const policy=store.get<SearchAreaPolicy>('searchAreaPolicy');
 if(!policy?.regions.length||listing.homeId!==undefined&&policy.existingHomeIds.includes(listing.homeId))return undefined;
 const failure=areaFailure(policy,listing,false,approximateSearchRoute(store,listing));if(failure)return failure;
 if(policy.mode==='source-filters'){
  const route=areaSearchRoute(store,listing.source,listing.evidence.searchAreaSourceUrl??'');
  return requireKnown&&(!route||route.region!==listing.evidence.searchAreaRegion)?'Location search filter is not recorded for this listing; awaiting area-filtered discovery.':undefined;
 }
 return areaFailure(policy,listing,requireKnown);
}
/** A broad route is an explicitly configured discovery fallback, never downtown proof. */
export function approximateSearchRoute(store:Store,fields:LocationFields,source=fields.source){
 const url=fields.searchUrl??fields.evidence?.searchAreaSourceUrl;if(!url)return undefined;
 const candidates=source?[source]:Object.keys(store.get<SearchAreaPolicy>('searchAreaPolicy')?.sourceRoutes??{});
 return candidates.map(id=>areaSearchRoute(store,id,url)).find(route=>route?.scope==='vancouver-approximate');
}
function areaFailure(policy:SearchAreaPolicy,fields:LocationFields,requireKnown:boolean,approximate?:AreaSearchRoute){
 const region=searchRegion(fields);
 if(approximate&&policy.regions.includes('downtown-vancouver')){
  // Unknown Vancouver-search locations remain reviewable. Explicit municipalities,
  // disabled North/West regions and distant Vancouver neighbourhoods still win.
  if(region==='unknown'||region==='downtown-vancouver')return undefined;
  const cities=[...new Set(normalize(fields.city||fields.address||fields.area||'').match(municipalities)??[])];
  if(region==='outside'&&nearby.has(areaName(fields))&&cities.every(city=>city==='vancouver'))return undefined;
 }
 if(region==='unknown')return requireKnown?'Location is not confirmed within your selected search areas; held out of the active list.':undefined;
 return region==='outside'||!policy.regions.includes(region)?'Outside your selected search areas.':undefined;
}
export function discoveryAreaFailure(store:Store,fields:LocationFields){const mainlandFailure=mainlandExclusion(fields,store.criteria.mainlandOnly);if(mainlandFailure)return mainlandFailure;const policy=store.get<SearchAreaPolicy>('searchAreaPolicy');return policy?.regions.length?areaFailure(policy,fields,false,approximateSearchRoute(store,fields)):undefined;}

/** Broad Vancouver catalogues can still contain permitted homes; reject only clearly
 * out-of-area catalogue routes, retaining their saved progress for a later expansion. */
export function searchRouteAllowed(store:Store,url:string){
 const policy=store.get<SearchAreaPolicy>('searchAreaPolicy');if(!policy?.regions.length)return true;
 if(policy.mode==='source-filters')return Object.keys(policy.sourceRoutes??{}).some(source=>!!areaSearchRoute(store,source,url));
 const parsed=new URL(url),text=normalize(decodeURIComponent(parsed.pathname)+' '+(parsed.searchParams.get('city')??''));
 const city=text.match(municipalities)?.[0];
 if(city==='north vancouver')return policy.regions.includes('north-vancouver');
 if(city==='west vancouver')return policy.regions.includes('west-vancouver');
 if(city&&city!=='vancouver')return false;
 for(const name of neighbourhoods)if(name!=='downtown'&&name!=='west end'&&text.includes(name))return false;
 return true;
}
