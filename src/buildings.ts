import type {Home,Listing} from './domain';
import {deskCategory} from './desk-category';
import {fullReviewComplete} from './review-presentation';

export type BuildingMemory={revision:number;assigned?:Record<string,string>;earlyGrouping?:Record<string,{key:string;confirmedAt:string}>;notes:Record<string,string>;links:Record<string,string>;separate:Record<string,boolean>;dismissed:string[]};
export type BuildingGroup={key:string;label:string;homeIds:number[];notes:string;earlyHomeIds?:number[]};
export type BuildingIndex={revision:number;groups:BuildingGroup[];suggestions:{a:string;b:string}[];ratings:Record<string,{score:number;reason:string}>};
export const emptyBuildingMemory=():BuildingMemory=>({revision:0,notes:{},links:{},separate:{},dismissed:[]});
export const buildingPair=(a:string,b:string)=>JSON.stringify([a,b].sort());
const aliases:Record<string,string>={street:'st',avenue:'ave',road:'rd',boulevard:'blvd',drive:'dr',place:'pl',crescent:'cres',lane:'ln',court:'ct',west:'w',east:'e',north:'n',south:'s'};
const normalize=(s:string)=>s.toLowerCase().replace(/\./g,'').replace(/\b(street|avenue|road|boulevard|drive|place|crescent|lane|court|west|east|north|south)\b/g,w=>aliases[w]).replace(/\s+/g,' ').trim();

/** Saved address evidence only. A street without a municipality is a suggestion, never a confirmed group. */
export function buildingAddress(listing:Pick<Listing,'address'|'description'|'evidence'|'unit'>){
 const verifiedResearch=listing.evidence.addressLookupStatus==='verified'&&listing.evidence.addressLookupCheckedAt&&/^https?:\/\//.test(listing.evidence.researchedAddressSource??'')?listing.evidence.researchedAddress?.trim():'';
 const structured=verifiedResearch||listing.address.trim();
 const raw=structured||listing.description.match(/\bat\s+(\d+\s+[^\n.;]{3,100})/i)?.[1]||'';
 const cleaned=raw.replace(/^(?:(?:suite|unit|apt\.?|apartment)\s*#?\s*[a-z0-9]+\s*[,\-]\s*|#?\d+[a-z]?\s*[-–]\s*)/i,'');
 const match=cleaned.match(/^(\d+[a-z]?\s+(?:(?:west|east|north|south|[wens])\.?\s+)?[a-z0-9]+(?:\s+[a-z0-9]+){0,4}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|place|pl|crescent|cres|lane|ln|court|ct)\b(?:\s+(?:west|east|north|south|[wens])\b(?!\s+vancouver\b))?)/i);
 if(!match)return null;
 const street=normalize(match[1]);
 const tail=cleaned.slice(match[0].length).replace(/^\s*\.?\s*(?:(?:suite|unit|apt\.?)\s*#?\s*[a-z0-9]+|#\s*[a-z0-9]+)/i,'');
 // Never treat North/West Vancouver as Vancouver, or infer a city from source marketing.
 const city=tail.match(/(?:^|[,\s])((?:north|west)\s+vancouver|vancouver|burnaby|richmond|new westminster|surrey|coquitlam|port coquitlam|port moody|delta|langley)\b/i)?.[1].toLowerCase().replace(/\s+/g,' ')
  ||(listing.evidence.addressLookupStatus==='verified'&&/City of Vancouver boundary/i.test(listing.evidence.addressLookupDetail??'')?'vancouver':'');
 const numericPrefix=raw.match(/^#?(\d+[a-z]?)\s*[-–]\s*\d+/i)?.[1];
 const ambiguous=!!numericPrefix&&numericPrefix.toLowerCase()!==listing.unit.toLowerCase().replace(/^(?:unit|suite|apt\.?)\s*#?\s*|^#/i,'')||/\b(?:tower|building)\s+[a-z0-9]+|\d+\s*[-/]\s*\d+|\b(?:or|and)\s+\d+/i.test(tail);
 return {street,city,label:match[1].trim()+(city?', '+city.replace(/\b\w/g,c=>c.toUpperCase()):''),certain:!!structured&&!!city&&!ambiguous};
}

export function buildingRoot(key:string,memory:BuildingMemory){const seen=new Set<string>();while(memory.links[key]&&!seen.has(key)){seen.add(key);key=memory.links[key];}return key;}
export function buildBuildingIndex(homes:Pick<Home,'id'|'listing'>[],memory=emptyBuildingMemory(),ratings:BuildingIndex['ratings']={}):BuildingIndex{
 const groups=new Map<string,BuildingGroup>(),candidates=new Map<string,{key:string;city:string}[]>();
 for(const home of homes){
  const address=buildingAddress(home.listing),base=address?.certain?`address:${address.city}|${address.street}`:`home:${home.id}`;
  const key=memory.separate[String(home.id)]?`separate:${home.id}`:buildingRoot(memory.assigned?.[String(home.id)]??base,memory);
  let group=groups.get(key);if(!group){group={key,label:address?.label||`Building for apartment #${home.id}`,homeIds:[],notes:memory.notes[key]??''};groups.set(key,group);}
  group.homeIds.push(home.id);
  const early=memory.earlyGrouping?.[home.id];
  if(early&&!memory.separate[home.id]&&buildingRoot(early.key,memory)===key)(group.earlyHomeIds??=[]).push(home.id);
  if(address?.certain&&key===base)group.label=address.label;
  if(address){const bucket=candidates.get(address.street)??[];bucket.push({key,city:address.city});candidates.set(address.street,bucket);}
 }
 const cities=new Map<string,Set<string>>();for(const bucket of candidates.values())for(const entry of bucket){if(entry.city){const values=cities.get(entry.key)??new Set<string>();values.add(entry.city);cities.set(entry.key,values);}}
 const pairs=new Map<string,{a:string;b:string}>(),dismissed=new Set(memory.dismissed.map(pair=>{const [a,b]=JSON.parse(pair) as string[];return buildingPair(buildingRoot(a,memory),buildingRoot(b,memory));}));
 for(const bucket of candidates.values())for(let i=0;i<bucket.length;i++)for(let j=i+1;j<bucket.length;j++){
  const a=bucket[i],b=bucket[j],pair=buildingPair(a.key,b.key);
  const conflictingCities=[...(cities.get(a.key)??[]),...(cities.get(b.key)??[])];
  if(new Set(conflictingCities).size>1||a.key===b.key||a.key.startsWith('separate:')||b.key.startsWith('separate:')||a.city&&b.city&&a.city!==b.city||dismissed.has(pair))continue;
  pairs.set(pair,{a:a.key,b:b.key});
 }
 return {revision:memory.revision,groups:[...groups.values()].map(group=>({...group,homeIds:group.homeIds.sort((a,b)=>a-b)})),suggestions:[...pairs.values()],ratings};
}

/** Building membership never accelerates an unfinished assessment or changes a unit's own decision. */
export function buildingReady(home:Home){
 const complete=fullReviewComplete(home)&&(home.fullReview?.status==='complete'||home.reviewMode==='full'||(!home.reviewMode&&home.listing.galleryComplete&&home.listing.photos.length>0&&home.listing.photos.every(p=>p.status==='reviewed')));
 return complete&&home.stage!=='Unreviewed'&&deskCategory(home)!=='Scoring in Progress';
}
export type BuildingPlacement={section:string;revisitLater:boolean};
const activeSections=['Interested','Serious Candidates','Ready to Apply','In Progress'];
// An explicit user exception can display selected Interested units before scoring.
// It never changes assessment status, and later rejection/separation still wins.
export const earlyBuildingMember=(home:Home,group:BuildingGroup)=>home.stage==='Interested'&&!!group.earlyHomeIds?.includes(home.id);
const groupSection=(home:Home,group:BuildingGroup)=>earlyBuildingMember(home,group)?'Interested':deskCategory(home);
/** Display a completed building group at its furthest active section; closed/excluded homes stay put. */
export function buildingPlacements(homes:Home[],index:BuildingIndex,enabled=true){
 const placements=new Map<number,BuildingPlacement>(homes.map(h=>[h.id,{section:deskCategory(h),revisitLater:!!h.revisitLater}]));
 if(!enabled)return placements;
 const byId=new Map(homes.map(h=>[h.id,h]));
 for(const group of index.groups){
  const members=group.homeIds.map(id=>byId.get(id)).filter((h):h is Home=>!!h&&(buildingReady(h)||earlyBuildingMember(h,group))&&activeSections.includes(groupSection(h,group)));
  if(!members.length)continue;
  const rank=Math.max(...members.map(h=>activeSections.indexOf(groupSection(h,group)))),section=activeSections[rank];
  const leaders=members.filter(h=>groupSection(h,group)===section);
  const revisitLater=['Interested','Serious Candidates'].includes(section)&&leaders.some(h=>h.revisitLater);
  for(const home of members)placements.set(home.id,{section,revisitLater});
 }
 return placements;
}

/** Input is already sorted/filtered for its display section; unfinished homes remain individual cards. */
export function groupVisibleHomes(homes:Home[],index:BuildingIndex){
 const byId=new Map(index.groups.flatMap(group=>group.homeIds.map(id=>[id,group] as const)));
 const buckets=new Map<string,{key:string;group?:BuildingGroup;homes:Home[]}>();
 for(const home of homes){const candidate=byId.get(home.id),group=candidate&&(buildingReady(home)||earlyBuildingMember(home,candidate))?candidate:undefined,key=group?.key??`home:${home.id}`;let bucket=buckets.get(key);if(!bucket){bucket={key,group,homes:[]};buckets.set(key,bucket);}bucket.homes.push(home);}
 return [...buckets.values()];
}
