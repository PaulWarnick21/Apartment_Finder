import type {Store} from './db.ts';
import {sources} from './sources.ts';
import {deskCategory} from '../src/desk-category.ts';
import type {Home} from '../src/domain.ts';
import type {DiscoverySummary} from './discovery-queue.ts';
import {inventoryRoutes,type InventoryRoute} from './inventory-discovery.ts';
import {sourceFilteredIntake,areaSearchRoutes} from './search-area.ts';
import {readQueue} from './discovery-queue.ts';
import {savedSourceYieldStats} from './source-feedback.ts';

/** Historical evidence and runnable app support are independent of access cooldowns. */
export function sourceStatuses(store:Store,now=Date.now(),homes:Home[]=store.homes()){
 const health=store.health(),reports=store.get<Record<string,string>>('trialSourceReports')??{};
 const allocation=new Map(savedSourceYieldStats(store,now,homes).map(stat=>[stat.source,{basis:stat.basis,userInterested:stat.userInterested,userReviewed:stat.userReviewed}]));
 const recent=store.db.prepare("SELECT p.created_at,m.value FROM plans p JOIN meta m ON m.key='sourceResults:'||p.id WHERE COALESCE(json_array_length(json_extract(p.caps,'$.fullReviewHomeIds')),0)=0 AND COALESCE(json_extract(p.caps,'$.purpose'),'listings')='listings' ORDER BY p.created_at DESC").all() as {created_at:string;value:string}[];
 const lastScans=new Map<string,{at:string;state:string;detail:string;newListings?:number}>();
 for(const row of recent)for(const result of JSON.parse(row.value) as {source:string;state:string;detail:string;newListings?:number}[]){if(result.state!=='pending'&&!lastScans.has(result.source))lastScans.set(result.source,{at:row.created_at,state:result.state,detail:result.detail,newListings:result.newListings});}
 return sources.map(source=>{
  const rows=homes.filter(h=>h.postings.some(p=>p.source===source.id));
  const state=health.find(h=>h.source===source.id);
  const paused=!!state&&(!!state.needs_attention||Date.parse(state.paused_until??'')>now);
  const needsFilter=sourceFilteredIntake(store)&&!areaSearchRoutes(store,source.id).length;
  const ready=source.adapter!=='pending'&&!needsFilter;
  const candidates=rows.length,reviewedPhotos=rows.reduce((n,h)=>n+h.listing.photos.filter(p=>p.status==='reviewed').length,0);
  const active=rows.filter(h=>!['Excluded','Closed'].includes(deskCategory(h))).length;
  const failures=store.get<{url:string;reason:string;kind:string;at:string;attempts:number}[]>(`candidateFailures:${source.id}`)??[];
  const queue=readQueue(store,source.id);
  const recoverySupported=['apartments','zillow','kijiji'].includes(source.id);
  const recoveryReady=recoverySupported&&paused&&!(Date.parse(state?.paused_until??'')>now);
  return {id:source.id,name:source.name,ready,paused,health:state,recoverySupported,recoveryReady,allocation:allocation.get(source.id),
   lastScan:lastScans.get(source.id),discovery:store.get<DiscoverySummary>(`discoverySummary:${source.id}`)??undefined,
   inventory:sourceFilteredIntake(store)?inventoryRoutes(store,source):store.get<InventoryRoute[]>(`inventoryCoverage:${source.id}`)??[],
   fullAssessments:rows.filter(h=>h.listing.galleryComplete&&h.listing.photos.length>0&&(h.listing.expectedPhotos===null||h.listing.photos.length>=h.listing.expectedPhotos)&&h.listing.photos.every(p=>p.status==='reviewed'&&!p.attributionPending)).length,
   failures:failures.filter(f=>f.kind!=='prefilter').slice(-10).reverse(),failureCount:failures.filter(f=>f.kind==='parse').length,queued:(queue?.urls.length??0)+(queue?.offerings?.length??0),freshCheckedAt:queue?.freshCheckedAt,
   coverageScope:source.coverageScope,unvalidatedExpansion:source.unvalidatedExpansion,
   trialRecorded:!!reports[source.id],candidates,reviewedPhotos,active,
   status:candidates?`${candidates} saved listings · ${reviewedPhotos} photos reviewed · ${active} in the active desk`:'No saved listings yet',
   scanMethod:needsFilter?'Geographic filter needed':ready?(['apartments','zillow'].includes(source.id)?'App scan through Chrome':'App scan'):(reports[source.id]?'Assisted scan only':'Not yet tested'),
   scanDetail:needsFilter?'No supported search is configured for your selected areas. Old broad-search queues are held out until a scoped route is validated.':ready?'Configured for approved scans. Check discovery outcomes and access pauses below; adapter support does not establish current yield.':reports[source.id]?'The assisted test worked. Automated discovery still needs validation.':'Access and extraction still need a bounded test.'};
 });
}
