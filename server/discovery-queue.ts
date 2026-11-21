import {intakeRejected,buildingRecentlyChecked,clearIntakeRejection} from './intake-memory.ts';
import {discoveryAreaFailure,searchAreaExclusion,searchRouteAllowed,sourceFilteredIntake,areaSearchRoute} from './search-area.ts';
import {studioTitleEvidence} from '../src/bedrooms.ts';
import {discoveryBedrooms} from './discovery-bedrooms.ts';
import type {Listing} from '../src/domain.ts';
import {hash,type Store} from './db.ts';
import {discoveryFailure,prioritizeCards,type DiscoveryCard} from './source-discovery.ts';
import {listingUrl} from './source-discovery.ts';
import {sourceById,expandedSource,sources} from './sources.ts';
import {postingAgeRank} from './listing-age.ts';
import {quickIntakeLimits} from './quick-rank.ts';
export type DiscoveryQueue={urls:string[];next:string|null;cards?:Record<string,DiscoveryCard>;offerings?:Listing[];freshCheckedAt?:string};
export type DiscoverySummary={at:string;recognized:number;alreadySaved:number;unavailable:number;filtered:number;quarantined:number;rejectedRoutes:number;queued:number};
export function readQueue(store:Store,source:string):DiscoveryQueue{const queue:DiscoveryQueue={urls:[],next:null,...store.get<DiscoveryQueue>(`discoveryQueue:${source}`)};queue.urls=queue.urls.filter(url=>!intakeRejected(store,source,url)&&!buildingRecentlyChecked(store,source,url)&&!discoveryIntakeFailure(store,queue.cards?.[url]??{url})&&(!sourceFilteredIntake(store)||!!areaSearchRoute(store,source,queue.cards?.[url]?.searchUrl??'')));if(queue.offerings)queue.offerings=queue.offerings.filter(listing=>!intakeRejected(store,source,listing.url,listing.sourceId)&&!searchAreaExclusion(store,listing,sourceFilteredIntake(store)));if(queue.next&&!searchRouteAllowed(store,queue.next))queue.next=null;return queue;}
export function saveQueue(store:Store,source:string,queue:DiscoveryQueue){store.set(`discoveryQueue:${source}`,queue);}
/** Balance waiting time and promising cards within each posting-age tier. */
export function balanceQueue(queue:DiscoveryQueue,months:number|null=null,now=Date.now()){
 const cards=queue.urls.map(url=>queue.cards?.[url]??{url});
 queue.urls=[0,1].flatMap(rank=>balancedCards(cards.filter(c=>postingAgeRank(c.postedAt,months,now)===rank)));
 queue.offerings?.sort((a,b)=>postingAgeRank(a.postedAt,months,now)-postingAgeRank(b.postedAt,months,now));return queue;
}
function balancedCards(cards:DiscoveryCard[]){
 const oldest=[...cards].sort((a,b)=>(a.discoveredAt??'').localeCompare(b.discoveredAt??''));
 const priority=prioritizeCards(cards).sort((a,b)=>Number(/mountain|ocean|water view|panorama/i.test(b.title??''))-Number(/mountain|ocean|water view|panorama/i.test(a.title??'')));
 const ordered:string[]=[],seen=new Set<string>();let a=0,b=0;
 while(ordered.length<cards.length){for(const list of [oldest,priority]){let i=list===oldest?a:b;while(i<list.length&&seen.has(list[i].url))i++;if(i<list.length){seen.add(list[i].url);ordered.push(list[i].url);i++;}if(list===oldest)a=i;else b=i;}}
 return ordered;
}
export function prioritizeQueue(queue:DiscoveryQueue,months:number|null,balanced=false){
 if(balanced)return balanceQueue(queue,months);
 queue.urls=prioritizeCards(queue.urls.map(url=>queue.cards?.[url]??{url}),months).map(c=>c.url);
 queue.offerings?.sort((a,b)=>postingAgeRank(a.postedAt,months)-postingAgeRank(b.postedAt,months));return queue;
}
/** Prefer unaged work on other accessible sources before spending on an old gallery. */
export function hasCurrentQueuedWork(store:Store){
 const months=store.criteria.listingAgePriorityMonths;if(!months)return false;
 return sources.some(source=>{try{store.checkSource(source.id);}catch{return false;}const q=readQueue(store,source.id);return q.urls.some(url=>!postingAgeRank(q.cards?.[url]?.postedAt,months))||q.offerings?.some(l=>!postingAgeRank(l.postedAt,months));});
}
export function hasPosting(store:Store,source:string,url:string){return !!store.db.prepare('SELECT 1 FROM postings WHERE source=? AND url=?').get(source,url);}
export function hasOffering(store:Store,listing:Listing){return !!store.db.prepare('SELECT 1 FROM postings WHERE source=? AND source_id=?').get(listing.source,listing.sourceId);}
export function inventoryCheckKey(source:string,url:string){return `inventoryChecked:${source}:${hash(url)}`;}
/** A building URL can advertise new floorplans without changing its own URL. Recheck facts only. */
function inventoryDue(store:Store,source:string,url:string){if(source!=='zumper'&&source!=='hollyburn')return false;const post=store.db.prepare('SELECT home_id FROM postings WHERE source=? AND url=? LIMIT 1').get(source,url) as {home_id:number}|undefined;if(!post)return false;const listing=store.home(post.home_id)?.listing;if(!listing||!(source==='hollyburn'&&/^\/building\/[^/]+\/$/.test(new URL(url).pathname))&&listing.offeringKind!=='floorplan'&&!/Building \/ floor-plan advertisement|Representative photos of the building/i.test(listing.description+' '+listing.conflicts.join(' ')))return false;const at=store.get<string>(inventoryCheckKey(source,url));return !at||Date.now()-Date.parse(at)>=86400000;}
export function recordCandidateFailure(store:Store,source:string,url:string,reason:string,kind:'parse'|'prefilter'|'not-found'|'refresh'='parse',options:{preserveExistingGallery?:boolean}={}){
 const key=`candidateFailures:${source}`,old=store.get<Array<{url:string;reason:string;kind:string;at:string;attempts:number}>>(key)??[],previous=old.find(item=>item.url===url&&item.kind===kind);
 store.set(key,[...old.filter(item=>item!==previous),{url,reason:reason.slice(0,1000),kind,at:new Date().toISOString(),attempts:(previous?.attempts??0)+1}].slice(-500));
 if(kind==='parse'&&!options.preserveExistingGallery){const post=store.db.prepare('SELECT home_id FROM postings WHERE source=? AND url=?').get(source,url) as {home_id:number}|undefined;if(post){const markerKey=`pendingGallery:${post.home_id}`,marker=store.get<{source:string;sources?:string[]}>(markerKey);if(marker){const sources=(marker.sources??[marker.source]).filter(item=>item!==source);if(sources.length)store.set(markerKey,{...marker,sources});else store.db.prepare('DELETE FROM meta WHERE key=?').run(markerKey);}}}
}
export function isQuarantined(store:Store,source:string,url:string){return (store.get<Array<{url:string;kind:string}>>(`candidateFailures:${source}`)??[]).some(item=>item.url===url&&item.kind==='parse');}
/** Apply only explicit search-card facts. Unknown/ranged fields must reach details. */
export function discoveryIntakeFailure(store:Store,card:DiscoveryCard){
 const areaFailure=discoveryAreaFailure(store,card);if(areaFailure)return areaFailure;
 if(store.get<{mode:string}>('reviewWorkflow')?.mode!=='quick-first')return discoveryFailure(card,store.criteria.maxRent);
 const failure=discoveryFailure(card,null);if(failure)return failure;
 const limits=quickIntakeLimits(store.criteria);
 if(card.rent!=null&&(card.rent<limits.minRent||limits.maxRent!==null&&card.rent>limits.maxRent))return 'Advertised monthly rent is outside the quick-intake range';
 const titleBeds=discoveryBedrooms(card.title??'');
 const beds=card.bedsConflict?null:studioTitleEvidence(card.title??'')?0:card.beds!=null&&titleBeds!=null&&card.beds!==titleBeds?null:card.beds??titleBeds;
 if(beds!=null&&limits.allowedBeds.length&&!limits.allowedBeds.includes(beds))return 'Advertised bedroom count is outside the quick-intake range';
 return null;
}
export function mergeDiscovery(store:Store,source:string,queue:DiscoveryQueue,cards:DiscoveryCard[],searchUrl?:string){
 if(sourceFilteredIntake(store)){
  const route=searchUrl?areaSearchRoute(store,source,searchUrl):undefined;
  if(!route)throw Error('Geographically filtered source search required; broad discovery was not admitted');
  cards=cards.map(card=>({...card,searchUrl,searchRegion:route.region}));
 }
 const distinct=new Map<string,DiscoveryCard>();for(const card of cards)distinct.set(card.url,{...distinct.get(card.url),...card,postedAt:card.postedAt??distinct.get(card.url)?.postedAt});cards=[...distinct.values()];
 const now=new Date().toISOString(),metadata={...queue.cards},route=expandedSource(sourceById(source));
 const summary:DiscoverySummary={at:now,recognized:cards.length,alreadySaved:0,unavailable:0,filtered:0,quarantined:0,rejectedRoutes:0,queued:0};
 for(const card of cards){if(!listingUrl(card.url,route))summary.rejectedRoutes++;else if(card.availability==='unavailable')summary.unavailable++;else if(discoveryIntakeFailure(store,card))summary.filtered++;else if(isQuarantined(store,source,card.url))summary.quarantined++;else if(hasPosting(store,source,card.url)&&!inventoryDue(store,source,card.url))summary.alreadySaved++;}
 for(const card of cards){metadata[card.url]={...metadata[card.url],...card,postedAt:card.postedAt??metadata[card.url]?.postedAt,discoveredAt:metadata[card.url]?.discoveredAt??now};const failure=discoveryIntakeFailure(store,card);if(failure)recordCandidateFailure(store,source,card.url,failure,'prefilter');}
 const urls=[...new Set([...cards.map(card=>card.url),...queue.urls])].filter(url=>!!listingUrl(url,route)&&(!hasPosting(store,source,url)||inventoryDue(store,source,url))&&!intakeRejected(store,source,url)&&!buildingRecentlyChecked(store,source,url)&&!isQuarantined(store,source,url)&&!discoveryIntakeFailure(store,metadata[url]??{url}));
 const months=store.criteria.listingAgePriorityMonths;
 queue.urls=prioritizeCards(urls.map(url=>metadata[url]??{url}),months).sort((a,b)=>postingAgeRank(a.postedAt,months)-postingAgeRank(b.postedAt,months)||Number(hasPosting(store,source,a.url))-Number(hasPosting(store,source,b.url))).map(card=>card.url);queue.cards=Object.fromEntries(queue.urls.map(url=>[url,metadata[url]??{url}]));queue.offerings=(queue.offerings??[]).filter(listing=>!hasOffering(store,listing)&&!intakeRejected(store,source,listing.url,listing.sourceId));saveQueue(store,source,queue);
 summary.queued=queue.urls.length+(queue.offerings?.length??0);store.set(`discoverySummary:${source}`,summary);
}
export function removeCandidate(store:Store,source:string,queue:DiscoveryQueue,url:string){queue.urls=queue.urls.filter(item=>item!==url);if(queue.cards)delete queue.cards[url];saveQueue(store,source,queue);}
/** An explicit local retry only requeues extraction; it never grants scan authorization. */
export function retryCandidate(store:Store,source:string,input:string){const normalized=listingUrl(input,expandedSource(sourceById(source)));if(!normalized)throw new Error('Candidate URL is outside this source’s listing routes');const key=`candidateFailures:${source}`,failures=store.get<Array<{url:string;kind:string}>>(key)??[];if(!failures.some(item=>item.url===normalized&&item.kind==='parse')&&!intakeRejected(store,source,normalized))throw new Error('No quarantined extraction found');clearIntakeRejection(store,source,normalized);store.set(key,failures.filter(item=>!(item.url===normalized&&item.kind==='parse')));const queue=readQueue(store,source);queue.urls=[...new Set([normalized,...queue.urls])];saveQueue(store,source,queue);const post=store.db.prepare('SELECT home_id FROM postings WHERE source=? AND url=?').get(source,normalized) as {home_id:number}|undefined;if(post){const markerKey=`pendingGallery:${post.home_id}`,marker=store.get<{source:string;sources?:string[]}>(markerKey);store.set(markerKey,{source,sources:[...new Set([source,...(marker?.sources??(marker?[marker.source]:[]))])],homeId:post.home_id,explicitRetry:true});}store.event(`${sourceById(source).name}: extraction requeued for a future approved scan.`);}
