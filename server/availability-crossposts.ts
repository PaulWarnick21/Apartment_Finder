import type {Store} from './db.ts';
import {listingSchema,type Listing} from '../src/domain.ts';
import {duplicateAddress,duplicateEvidence,sharedGallery,forgetQueuedPosting} from './automatic-duplicates.ts';
import {compatibleUnit,reconcileListing} from './listing-integrity.ts';
import {observationKey} from './availability-store.ts';
import type {AvailabilityObservation} from '../src/availability.ts';
import {sources} from './sources.ts';
import {intakeSearchUrls} from './search-area.ts';
import type {DiscoveryCard} from './source-discovery.ts';

export type CrossPostCheck={checkedAt:string;state:'live-found'|'checked'|'incomplete';urls:string[];detail:string};
export const crossPostKey=(id:number)=>`availabilityCrossCheck:${id}`;
export const crossPostLimits={pagesPerHome:8,searchSources:3,detailsPerSearch:2};
const identityListing=(l:Listing)=>({...l,address:duplicateAddress(l).street?l.address:l.evidence.researchedAddress??l.address});
/** Specific rental text can find cross-posts even when one source omits the unit.
 * A building name, price, shared gallery or boilerplate alone is never sufficient. */
export function sameRentalEvidence(left:Listing,right:Listing){
 const a=identityListing(left),b=identityListing(right),x=duplicateAddress(a),y=duplicateAddress(b);
 if(!compatibleUnit(a,b)||x.conflict||y.conflict||x.street&&y.street&&x.street!==y.street||x.type&&y.type&&x.type!==y.type||x.unit&&y.unit&&x.unit!==y.unit||x.city&&y.city&&x.city!==y.city)return;
 const exact=duplicateEvidence(a,b);if(exact)return exact;
 if(sharedGallery(a)||sharedGallery(b)||!x.street||x.street!==y.street||a.rent===null||a.rent!==b.rent||a.sqft===null||a.sqft!==b.sqft||a.beds===null||a.beds!==b.beds)return;
 const grams=(text:string)=>{const w=text.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/);return new Set(w.slice(0,-4).map((_,i)=>w.slice(i,i+5).join(' ')));};
 const ap=grams(a.description),bp=grams(b.description),n=[...ap].filter(g=>bp.has(g)).length;
 if(n>=80&&n/Math.max(1,Math.min(ap.size,bp.size))>=.9)return 'Same street, rent, size and bedroom count with matching specific rental description';
}
export function differentHomes(store:Store,a:number,b:number){return [a,...store.aliases(a)].some(x=>[b,...store.aliases(b)].some(y=>store.db.prepare("SELECT 1 FROM duplicate_decisions WHERE a=? AND b=? AND decision='different'").get(Math.min(x,y),Math.max(x,y))));}
export function savedCrossPosts(store:Store,id:number){
 const home=store.home(id)!;
 return (store.db.prepare('SELECT id,listing FROM homes WHERE id!=? AND id NOT IN (SELECT alias FROM home_aliases)').all(id) as {id:number;listing:string}[])
  .flatMap(row=>{if(differentHomes(store,id,row.id))return [];const listing=listingSchema.parse(JSON.parse(row.listing)),evidence=sameRentalEvidence(home.listing,listing);return evidence?[{homeId:row.id,listing,evidence}]:[];});
}
/** Existing supported public routes only; these are targeted recovery checks,
 * not new intake. An incomplete search never establishes that the home is gone. */
export function crossPostSearchRoutes(store:Store,listing:Listing){
 const preferred=['craigslist','zumper','vada','rew','kijiji'];
 return sources.filter(s=>s.id!==listing.source&&preferred.includes(s.id)).sort((a,b)=>preferred.indexOf(a.id)-preferred.indexOf(b.id)).flatMap(source=>{
  try{store.checkSource(source.id);}catch{return [];}
  const url=intakeSearchUrls(store,source)[0];if(!url)return [];
  const search=new URL(url),address=duplicateAddress(identityListing(listing));
  if(source.id==='craigslist'&&address.street)search.searchParams.set('query',address.street);
  return [{source:source.id,url:search.href}];
 }).slice(0,crossPostLimits.searchSources);
}
export function crossPostCardMatches(listing:Listing,card:DiscoveryCard){
 const address=duplicateAddress(identityListing(listing)),text=(card.title??'').toLowerCase().replace(/[^a-z0-9]+/g,' ');
 const street=address.street.split(' ').filter(w=>w.length>2||/^\d+$/.test(w));
 if(street.length>=2&&street.every(w=>text.includes(w)))return true;
 const title=listing.title.toLowerCase().replace(/[^a-z0-9]+/g,' ').split(' ').filter(w=>w.length>=4&&!['apartment','bedroom','vancouver','downtown','rental','suite','available','rent'].includes(w));
 return title.length>=1&&title.every(w=>text.includes(w))&&card.rent===listing.rent&&card.beds===listing.beds;
}
/** Change advertised facts, not saved photo assessments, research or personal decisions. */
export function refreshFromLivePosting(store:Store,id:number,live:Listing,checkedAt:string){
 return store.transaction(()=>{
  id=store.resolveHomeId(id);const row=store.db.prepare('SELECT listing FROM homes WHERE id=?').get(id) as {listing:string};
  const previous=listingSchema.parse(JSON.parse(row.listing)),next=structuredClone(previous);
  for(const key of ['source','sourceId','url','title','address','unit','description','postedAt','rent','beds','baths','sqft','lease','available','laundry','parking','parkingCost','parkingCount'] as const){
   const value=live[key];if(value!==null&&value!==undefined&&value!==''&&!/^(?:unknown|not provided)$/i.test(String(value)))(next as any)[key]=value;
  }
  const identity=duplicateAddress(live);if(identity.unit&&!identity.conflict)next.unit=identity.unit;
  next.evidence.activePosting=`Still advertised at ${live.url}; checked ${checkedAt}. Landlord confirmation is not implied.`;
  next.evidence.activePostingSource=live.url;next.evidence.activePostingCheckedAt=checkedAt;
  if(live.postedAt&&live.evidence.postedAt)next.evidence.postedAt=live.evidence.postedAt;
  if(next.available===previous.available&&/unknown/i.test(live.available))next.available='Still advertised; confirm move-in date';
  if(JSON.stringify(next)===row.listing)return next;
  store.db.prepare('UPDATE homes SET listing=?,updated_at=?,revision=revision+1 WHERE id=?').run(JSON.stringify(next),checkedAt,id);
  store.db.prepare('INSERT INTO history(home_id,at,event,before_json,after_json) VALUES (?,?,?,?,?)').run(id,checkedAt,'Updated from verified live cross-post',row.listing,JSON.stringify(next));
  const manifest=store.db.prepare('SELECT listing FROM posting_details WHERE source=? AND source_id=? AND home_id=?').get(live.source,live.sourceId,id) as {listing:string}|undefined;
  const updated=manifest?reconcileListing(listingSchema.parse(JSON.parse(manifest.listing)),live,{preservePhotos:true}):live;
  store.db.prepare('UPDATE posting_details SET listing=?,captured_at=? WHERE source=? AND source_id=? AND home_id=?').run(JSON.stringify(updated),checkedAt,live.source,live.sourceId,id);
  return next;
 });
}
export function mergeLiveCrossPost(store:Store,id:number,peerId:number,live:Listing,observation:AvailabilityObservation,explicit=false){
 return store.transaction(()=>{
  id=store.resolveHomeId(id);peerId=store.resolveHomeId(peerId);
  const home=store.home(id)!,peer=store.home(peerId)!;
  let mergeId:number|undefined;
  if(id!==peerId){
   if(differentHomes(store,id,peerId)&&!explicit)throw Error('Saved different-home decision prevents automatic merge');
   if(!explicit&&!sameRentalEvidence(home.listing,live))throw Error('Cross-post identity is unverified');
   const rank=['Unreviewed','Interested','Serious Candidates','Ready to Apply','In Progress','Inquiry Sent','Viewing Booked','Applied','Leased'];
   if(!explicit&&rank.indexOf(peer.stage)>rank.indexOf(home.stage))throw Error('The other record has a more advanced decision; canonical merge needs reconciliation');
   const merged=store.mergeHomes(id,peerId,{keep:home.revision,duplicate:peer.revision},{preserveCanonical:true});
   mergeId=merged.mergeId;
   store.set(`duplicatePosting:${live.source}:${live.sourceId}`,{homeId:id,mergeId:merged.mergeId,evidence:'Verified live cross-post during availability check'});
   forgetQueuedPosting(store,live.source,live.sourceId);
  }
  store.set(observationKey(live),observation);refreshFromLivePosting(store,id,live,observation.checkedAt);
  // The live-fact refresh is part of this atomic merge, not a later user edit.
  // Keep the original snapshot undoable; subsequent revisions still block a split.
  if(mergeId!==undefined)store.db.prepare('UPDATE home_merges SET merged_revision=(SELECT revision FROM homes WHERE id=?) WHERE id=?').run(id,mergeId);
  store.set(crossPostKey(id),{checkedAt:observation.checkedAt,state:'live-found',urls:[live.url],detail:'Same unit is still advertised on a verified cross-post.'} satisfies CrossPostCheck);
  store.event(`Availability cross-post: retained #${id}, linked #${peerId}, updated advertised facts from ${live.source}.`);
  return id;
 });
}
