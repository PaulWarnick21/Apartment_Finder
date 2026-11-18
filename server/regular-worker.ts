import {collectGalleryPhotos} from './gallery-collection.ts';
import {searchAreaExclusion,scanAreaExclusion,intakeSearchUrls,applySearchArea,sourceFilteredIntake,areaSearchRoutes} from './search-area.ts';
import {mixEnabled,areaMixBucket,preferredAreaBucket,tryReserveAreaCandidate,settleAreaCandidate,releaseAreaClaims,areaMixRevision} from './area-mix.ts';
import {releaseScan} from './scan-concurrency.ts';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {assertFeedbackReady} from './feedback-learning.ts';
import {listingUnavailable} from './listing-availability.ts';
import {sharedRoomEvidence} from './listing-rental-scope.ts';
import {scoringFacts} from './scoring-facts.ts';
import {Store,hash} from './db.ts';
import {Budget,claimPlan,getPlan} from './plans.ts';
import {SourceBudget,concurrentSourceBudgets} from './source-budget.ts';
import {SourceSession} from './transport.ts';
import {sourceById,expandedSource,allowedUrl,type Source} from './sources.ts';
import {discoveryCards,inventoryEndpoint,inventoryUrls,nextDiscovery,discoveryEmpty} from './source-discovery.ts';
import {readQueue,saveQueue,mergeDiscovery,removeCandidate,recordCandidateFailure,hasOffering,hasPosting,inventoryCheckKey,type DiscoveryQueue} from './discovery-queue.ts';
import {parseListing} from './parsers.ts';
import {extractTrial} from './trial-extraction.ts';
import {extractRemaining,NonRentalPropertyError} from './remaining-extraction.ts';
import {extractZumperOfferings} from './zumper-extraction.ts';
import {reviewGallery} from './gallery-review.ts';
import {initializeNewValidation,validationAttempt,validationOutcome,validationTargetReached,ingestNewCandidate,validationSummary} from './new-listing-validation.ts';
import type {Listing,Criteria,Home} from '../src/domain.ts';
import type {ChromeJobClient} from './chrome-jobs.ts';
import {runApartmentsSource} from './apartments-worker.ts';
import {ChromeSourceSession} from './chrome-source-session.ts';
import {runInventorySource} from './inventory-discovery.ts';
import {prioritizeQueue,hasCurrentQueuedWork} from './discovery-queue.ts';
import {applyPostingDate,detailPostingDate,postingAgeRank} from './listing-age.ts';
import {quickRank} from './quick-rank.ts';
import {resolveQuickLocation} from './quick-location.ts';
import {runSelectedReviews} from './selected-review-worker.ts';
import type {Caps} from '../src/domain.ts';
import {chooseSource,type SourceSelectionState} from './source-yield.ts';
import {savedSourceYieldStats} from './source-feedback.ts';
export type SourceResult={source:string;state:'complete'|'partial'|'paused'|'pending';detail:string;areaDeferred?:boolean;newListings?:number;targetNewListings?:number;newHomeIds?:number[];attemptedListings?:number;skippedExisting?:number;candidateFailures?:number};
export function hardFailure(l:Listing,c:Criteria){return l.offeringKind==='building'||!!sharedRoomEvidence(l)||listingUnavailable(l)||c.maxRent!==null&&l.rent!==null&&l.rent>=c.maxRent||c.requireLaundry&&['none','shared-only'].includes(l.laundry)||c.streetLevelCeiling!==null&&c.streetLevelCeiling<3&&l.floorLevel!==null&&l.floorLevel<=1&&!l.conflicts.some(text=>/\b(?:floor|storey|story)\b/i.test(text));}
export function quickIntake(store:Store,caps:Caps){return caps.assessmentMode==='quick'||!caps.assessmentMode&&!caps.fullReviewHomeIds?.length&&store.get<{mode:string}>('reviewWorkflow')?.mode==='quick-first';}
export function intakeFailure(store:Store,budget:Budget,listing:Listing){if(searchAreaExclusion(store,listing))return true;return quickIntake(store,budget.caps)||budget.caps.fullReviewHomeIds?.length?!quickRank(listing,store.criteria,listing.homeId).eligible:hardFailure(listing,store.criteria);}
export const knownUrl=hasPosting;
export function pendingHomes(store:Store,source:string){return store.homes().filter(h=>{const marker=store.get<{source:string;sources?:string[]}>(`pendingGallery:${h.id}`);return !scanAreaExclusion(store,h.listing)&&h.postings.some(p=>p.source===source)&&!!marker&&(marker.sources??[marker.source]).includes(source)&&!['Closed','Leased','Not Interested'].includes(h.stage);});}
/** Quick intake resumes collection only; downloaded photographs wait for an Interested decision. */
export function pendingCollectionHomes(store:Store,source:string){return pendingHomes(store,source).filter(h=>!searchAreaExclusion(store,h.listing)&&quickRank(h.listing,store.criteria,h.id).eligible&&(!postingForSource(store,h,source).galleryComplete||h.listing.photos.some(p=>!p.local&&p.status!=='unavailable'&&allowedUrl(p.url,sourceById(source).mediaHosts))));}
export function postingForSource(store:Store,home:Home,source:string){return store.postingDetails(home.id).find(p=>p.source===source)?.listing??home.listing;}
function locate(l:Listing){if(l.location!=='unknown')return;const area=l.area!=='Unknown'?l.area:l.address;const text=area+' '+l.title;if(/\b(Coal Harbour|West End|Yaletown|Downtown Vancouver)\b/i.test(text)){l.location='downtown';l.evidence.location=text;}else if(/\b(North Vancouver|West Vancouver|Burnaby|Richmond|Coquitlam|Port Moody|Surrey|New Westminster)\b/i.test(text)){l.location='outside';l.evidence.location=text;}}
export function extractSourceOfferings(source:Source,html:string,url:string,xml?:string):Listing[]{
 let listings:Listing[];if(source.id==='craigslist')listings=[parseListing(html,url,source)];else if(['zillow','rew','facebook'].includes(source.id))listings=[extractRemaining(source.id as 'zillow'|'rew'|'facebook',html,url)];else if(source.id==='zumper')listings=extractZumperOfferings(html,url);else listings=[extractTrial(html,url,source,xml)];
 const postedAt=detailPostingDate(html,source.id,url);
 return listings.map(l=>{if(!l.title)throw new Error('Listing title missing; extraction needs review');locate(l);return scoringFacts(applyPostingDate(l,l.postedAt??postedAt));});
}
export function extractSource(source:Source,html:string,url:string,xml?:string){return extractSourceOfferings(source,html,url,xml)[0];}
type Session=Pick<SourceSession,'start'|'html'|'resource'|'image'|'close'|'stopped'>;
export type ScanDependencies={resumeSourcePhase?:boolean;addressLookup?:typeof fetch;session?:(source:Source,budget:Budget,dataDir:string)=>Session;review?:typeof reviewGallery;apartments?:typeof runApartmentsSource};
/** Keep the preferred regional queue at the front without dropping deferred work. */
export function prioritizeAreaCandidates(store:Store,source:string,budget:Budget,queue:DiscoveryQueue,pending:Home[]=[]){
 if(!mixEnabled(store,budget))return undefined;
 const preferred=preferredAreaBucket(store),rank=(fields:Parameters<typeof areaMixBucket>[2])=>areaMixBucket(store,source,fields)===preferred?0:1;
 queue.urls.sort((a,b)=>rank(queue.cards?.[a]??{})-rank(queue.cards?.[b]??{}));
 queue.offerings?.sort((a,b)=>rank(a)-rank(b));pending.sort((a,b)=>rank(a.listing)-rank(b.listing));return preferred;
}
const activeRefreshStages=new Set(['Interested','Serious Candidates','Ready to Apply','In Progress','Inquiry Sent','Viewing Booked','Applied']);
export function refreshCandidates(store:Store,source:string,budget:Budget){if(budget.caps.newListingsOnly||!budget.caps.refreshActiveListings||!budget.caps.maxRefreshListings)return [];const used=store.get<number>(`refreshCount:${budget.id}`)??0;if(used>=budget.caps.maxRefreshListings)return [];return store.homes().filter(h=>!scanAreaExclusion(store,h.listing)&&activeRefreshStages.has(h.stage)&&h.postings.some(p=>p.source===source)).sort((a,b)=>String(store.get(`factsChecked:${a.id}:${source}`)??'').localeCompare(String(store.get(`factsChecked:${b.id}:${source}`)??''))).slice(0,budget.caps.maxRefreshListings-used);}
export function reserveRefresh(store:Store,budget:Budget){budget.reserve('listings');store.set(`refreshCount:${budget.id}`,(store.get<number>(`refreshCount:${budget.id}`)??0)+1);}
export function saveGalleryProgress(store:Store,home:Home,listing:Listing,budget:Budget,source=listing.source){
 if(budget.caps.resumeHomeIds?.includes(home.id))store.set(`galleryResumeAttempt:${budget.id}:${home.id}`,{source,at:new Date().toISOString()});
 store.db.prepare('UPDATE homes SET listing=?,revision=revision+1,updated_at=? WHERE id=?').run(JSON.stringify(listing),new Date().toISOString(),home.id);
 if(intakeFailure(store,budget,listing)){store.db.prepare('DELETE FROM meta WHERE key=?').run(`pendingGallery:${home.id}`);return false;}
 const key=`pendingGallery:${home.id}`,old=store.get<{source:string;sources?:string[]}>(key),pendingSources=new Set(old?(old.sources??[old.source]):[]);
 const own=sourceById(source),ownedPhotos=listing.photos.filter(p=>allowedUrl(p.url,own.mediaHosts)||source==='apartments'&&/^https:\/\/images\d+\.apartments\.com\//.test(p.url));
 const ownPosting=postingForSource(store,home,source),unfinished=!ownPosting.galleryComplete||!ownedPhotos.length||ownedPhotos.some(p=>p.status==='pending'||p.status==='downloaded'||p.attributionPending);
 if(unfinished)pendingSources.add(source);else pendingSources.delete(source);
 if(pendingSources.size)store.set(key,{source,sources:[...pendingSources],homeId:home.id,planId:budget.id});else store.db.prepare('DELETE FROM meta WHERE key=?').run(key);
 return quickIntake(store,budget.caps)?!listing.galleryComplete||!listing.photos.length||listing.photos.some(p=>!p.local&&p.status!=='unavailable'):!listing.galleryComplete||!listing.photos.length||listing.photos.some(p=>p.status!=='reviewed'||p.attributionPending);
}
export async function runWebSource(store:Store,source:Source,budget:Budget,dataDir:string,deps:ScanDependencies={}):Promise<SourceResult>{
 const session=deps.session?.(source,budget,dataDir)??new SourceSession(source,budget,dataDir,{visibleChrome:source.visibleChrome});const queue=readQueue(store,source.id);let partial=false,failed=0,processed=0,areaDeferred=false,areaReason='';
 const trimUnitDiscovery=()=>{if(!budget.caps.unitListingsOnly||source.id!=='zumper')return;const key=`unitDiscoveryExclusions:${budget.id}:${source.id}`,prior=store.get<{urls:string[];offerings:number}>(key)??{urls:[],offerings:0},excluded=queue.urls.filter(url=>new URL(url).pathname.startsWith('/apartment-buildings/'));queue.urls=queue.urls.filter(url=>!excluded.includes(url));const offers=queue.offerings??[];queue.offerings=offers.filter(l=>l.offeringKind==='unit');store.set(key,{urls:[...new Set([...prior.urls,...excluded])],offerings:prior.offerings+offers.length-queue.offerings.length});saveQueue(store,source.id,queue);
  const summary=store.get<Record<string,unknown>>(`discoverySummary:${source.id}`);if(summary)store.set(`discoverySummary:${source.id}`,{...summary,queued:queue.urls.length+queue.offerings.length,unitOnlyExcluded:excluded.length});
 };
 trimUnitDiscovery();
 const snapshot=async(url:string,html:string)=>{const dir=join(dataDir,'snapshots',budget.id);await mkdir(dir,{recursive:true});await writeFile(join(dir,hash(url)+'.html'),html.slice(0,5_000_000));};
 const discover=async(url:string,fresh:boolean)=>{const html=await session.html(url);if(!html)throw new Error('Discovery page unavailable');await snapshot(url,html);let cards=discoveryCards(html,source,url);const endpoint=inventoryEndpoint(html,source);if(endpoint&&!sourceFilteredIntake(store))cards=[...cards,...inventoryUrls(await session.resource(endpoint),source).map(url=>({url}))];if(!cards.length&&!discoveryEmpty(html,source,url))throw new Error('No rental links recognized; discovery requires attention');const next=nextDiscovery(html,source,url);if(!fresh||!queue.next)queue.next=next;if(fresh)queue.freshCheckedAt=new Date().toISOString();mergeDiscovery(store,source.id,queue,cards,url);trimUnitDiscovery();};
 try{
  await session.start();if(budget.caps.phase!=='assessment'&&!deps.resumeSourcePhase){const searches=intakeSearchUrls(store,source);if(!searches.length)throw Error('No supported geographic search filters configured for this source');let discovered=0,lastDiscoveryGap:Error|undefined;for(const url of searches){if(budget.remaining('pages')<2)break;try{await discover(url,true);discovered++;}catch(error){if(!(error instanceof Error)||error.message!=="No rental links recognized; discovery requires attention")throw error;lastDiscoveryGap=error;store.event(source.name+': no listing links recognized at '+url+'; trying the next configured geographic route. Empty inventory is not established.');}}if(!discovered&&lastDiscoveryGap)throw lastDiscoveryGap;}
  const months=store.criteria.listingAgePriorityMonths;
  prioritizeQueue(queue,months,budget.caps.queuePolicy==='balanced');saveQueue(store,source.id,queue);
  for(const home of refreshCandidates(store,source.id,budget)){
   if(!budget.remaining('pages')||!budget.remaining('listings'))break;reserveRefresh(store,budget);const url=home.postings.find(p=>p.source===source.id)!.url;
   const html=await session.html(url);if(!html){recordCandidateFailure(store,source.id,url,'Listing page returned no facts; availability is unchanged','refresh');continue;}await snapshot(url,html);
   try{const listings=extractSourceOfferings(source,html,url),listing=listings.find(l=>l.sourceId===home.listing.sourceId)??(listings.length===1?listings[0]:null);if(!listing)throw new Error('Saved offering not found in current page; no facts overwritten');store.ingest(listing,{preservePhotos:true});store.set(`factsChecked:${home.id}:${source.id}`,new Date().toISOString());}catch(e){recordCandidateFailure(store,source.id,url,String(e),'refresh');failed++;}
  }
  const pending=(quickIntake(store,budget.caps)?pendingCollectionHomes(store,source.id):pendingHomes(store,source.id)).filter(h=>!budget.caps.newListingsOnly||budget.caps.resumeHomeIds?.includes(h.id)).sort((a,b)=>postingAgeRank(postingForSource(store,a,source.id).postedAt,months)-postingAgeRank(postingForSource(store,b,source.id).postedAt,months));let pendingAllowance=galleryResumeAllowance(store,source.id,budget,pending.length,queue.urls.length+(queue.offerings?.length??0));
  while(budget.remaining('listings')&&(pending.length>0||!validationTargetReached(budget,source.id))){
   budget.check();const areaPreference=prioritizeAreaCandidates(store,source.id,budget,queue,pending);
   const candidateRank=(fields:Parameters<typeof areaMixBucket>[2],postedAt:string|undefined)=>postingAgeRank(postedAt,months)+(areaPreference&&areaMixBucket(store,source.id,fields)!==areaPreference?2:0);
   const urlRank=queue.urls.length?candidateRank(queue.cards?.[queue.urls[0]]??{},queue.cards?.[queue.urls[0]]?.postedAt):Infinity,offerRank=queue.offerings?.length?candidateRank(queue.offerings[0],queue.offerings[0].postedAt):Infinity;
   const resumeWanted=validationTargetReached(budget,source.id)||pendingAllowance>0||!queue.urls.length&&!queue.offerings?.length;
   let home=resumeWanted&&pending.length&&(validationTargetReached(budget,source.id)||candidateRank(pending[0].listing,postingForSource(store,pending[0],source.id).postedAt)<=Math.min(urlRank,offerRank))?pending.shift():undefined;
   if(home)pendingAllowance--;let offering=home||offerRank>urlRank?undefined:queue.offerings?.shift();
   if(!home&&!offering&&!queue.urls.length){while(budget.caps.phase!=='assessment'&&!queue.urls.length&&!queue.offerings?.length&&queue.next&&budget.remaining('pages')>1)await discover(queue.next,false);if(!queue.urls.length&&!queue.offerings?.length)break;}
   const posting=home?postingForSource(store,home,source.id):undefined,url=posting?.url??offering?.url??queue.urls[0];if(!url)break;const card=queue.cards?.[url];if(!offering&&!posting?.galleryComplete&&!budget.remaining('pages')){if(home)pending.unshift(home);break;}
   const claim=tryReserveAreaCandidate(store,budget,source.id,url,home?{...home.listing,homeId:home.id}:offering??card??{});
   if(!claim.allowed){if(home)pending.unshift(home);if(offering)(queue.offerings??=[]).unshift(offering);areaDeferred=true;areaReason=claim.reason??'Waiting for the preferred area allocation.';break;}
   let areaToken=claim.token;
   try{
   budget.reserve('listings');validationAttempt(budget,source.id);
   if(!offering&&!posting?.galleryComplete){
    const html=await session.html(url);if(!html){removeCandidate(store,source.id,queue,url);recordCandidateFailure(store,source.id,url,'Listing page unavailable; no removal inferred','not-found');validationOutcome(budget,source.id,{url,result:'unavailable'});failed++;continue;}await snapshot(url,html);
    const xml=source.id==='sunstar'&&/juicebox/i.test(html)?await session.resource(new URL('config.xml',url).href):undefined;
    try{const listings=extractSourceOfferings(source,html,url,xml).map(l=>applySearchArea(store,applyPostingDate(l,l.postedAt??card?.postedAt),card)),newListings=home?listings.filter(l=>l.sourceId===posting!.sourceId):listings.filter(l=>!hasOffering(store,l));store.set(inventoryCheckKey(source.id,url),new Date().toISOString());removeCandidate(store,source.id,queue,url);if(!newListings.length){validationOutcome(budget,source.id,{url,result:'existing',reason:'No new source offering found'});continue;}offering=newListings[0];queue.offerings=[...(queue.offerings??[]),...newListings.slice(1)].sort((a,b)=>postingAgeRank(a.postedAt,months)-postingAgeRank(b.postedAt,months));saveQueue(store,source.id,queue);}catch(e){removeCandidate(store,source.id,queue,url);const nonRental=e instanceof NonRentalPropertyError;recordCandidateFailure(store,source.id,url,String(e),nonRental?'prefilter':'parse',{preserveExistingGallery:budget.caps.newListingsOnly});validationOutcome(budget,source.id,{url,result:nonRental?'unavailable':'parse-failure',reason:String(e)});failed++;continue;}
   }
   if(offering){
    const detailed=tryReserveAreaCandidate(store,budget,source.id,url,{...offering,...(home?{homeId:home.id}:{})});areaToken=detailed.token;
    if(!detailed.allowed){(queue.offerings??=[]).unshift(offering);if(home)pending.unshift(home);areaDeferred=true;areaReason=detailed.reason??'Parsed location is waiting for its area allocation.';break;}
   }
   if(offering){const saved=home&&budget.caps.resumeHomeIds?.includes(home.id)?store.ingest(offering,{preservePhotos:!quickIntake(store,budget.caps)}):ingestNewCandidate(store,budget,source.id,offering);saveQueue(store,source.id,queue);if(!saved)continue;home=store.home(saved.id)!;}if(!home)continue;const listing=home.listing;processed++;
   try{if(!intakeFailure(store,budget,listing)&&!['Not Interested','Closed','Leased'].includes(home.stage)){
    if(quickIntake(store,budget.caps))await resolveQuickLocation(store,budget,listing,home.id,deps.addressLookup);
    const areaFailure=searchAreaExclusion(store,listing,true);if(areaFailure){validationOutcome(budget,source.id,{url:listing.url,result:areaFailure.startsWith('Location')?'area-unconfirmed':'outside-area',homeId:home.id,reason:areaFailure});if(areaFailure.startsWith('Location'))partial=true;continue;}
    if(postingAgeRank(listing.postedAt,months)&&hasCurrentQueuedWork(store)){partial=true;continue;}
    partial=await collectGalleryPhotos(listing,budget,source,dataDir,url=>session.image(url))||partial;
    if(!quickIntake(store,budget.caps)&&listing.photos.some(p=>p.local&&(p.status!=='reviewed'||p.attributionPending))&&budget.remaining('aiCalls'))await(deps.review??reviewGallery)(listing,budget,dataDir);
   }}finally{partial=saveGalleryProgress(store,home,listing,budget,source.id)||partial;}
   }finally{settleAreaCandidate(store,budget,areaToken,home?.id);}
  }
  saveQueue(store,source.id,queue);const more=queue.urls.length>0||!!queue.next||!!queue.offerings?.length||pending.length>0;
  return {source:source.id,state:partial||more||failed||areaDeferred?'partial':'complete',...(areaDeferred?{areaDeferred:true}:{}),detail:`${areaDeferred?areaReason+' ':''}Fresh discovery checked; ${processed} candidates processed.${more?' More inventory remains queued.':''}${partial?' Gallery gaps or pending review are recorded.':''}${failed?` ${failed} listing issues retained for review; other candidates continued.`:''}`};
 }finally{await session.close();}
}
/** Old incomplete evidence cannot consume every candidate slot forever. */
export function galleryResumeAllowance(store:Store,source:string,budget:Budget,pending:number,newCandidates:number){if(!pending||!newCandidates)return pending;const available=budget.remaining('listings');if(available>1)return Math.floor(available/2);const key=`galleryResumePriority:${source}`,resume=store.get<boolean>(key)??false;store.set(key,!resume);return resume?1:0;}
export async function runRegularPlan(store:Store,id:string,dataDir:string,jobs?:ChromeJobClient,deps:ScanDependencies={}){
 if(getPlan(store,id).caps.phase!=='inventory'&&!quickIntake(store,getPlan(store,id).caps))assertFeedbackReady(store);const plan=claimPlan(store,id),budget=new Budget(store,id,plan.caps),results:SourceResult[]=plan.caps.sources.map((source:string)=>({source,state:'pending',detail:'Awaiting its turn.'}));initializeNewValidation(budget);store.set(`sourceResults:${id}`,results);
 const allocation=store.get<SourceSelectionState>('sourceAllocation')??{selectionCount:0,lastSelected:{}},stats=savedSourceYieldStats(store);let allocationAdvanced=false;
 const available=results.map(r=>r.source).filter(source=>{try{store.checkSource(source);return true;}catch{return false;}});
 const preferredBucket=preferredAreaBucket(store),regional= mixEnabled(store,budget)?available.filter(source=>areaSearchRoutes(store,source).some(route=>(route.region==='downtown-vancouver'?'downtown':'north-west')===preferredBucket)):[];
 const preferred=quickIntake(store,plan.caps)&&results.length>1?chooseSource(regional.length?regional:available,stats,allocation):null;
 if(preferred){results.sort((a,b)=>Number(b.source===preferred.source)-Number(a.source===preferred.source));store.set(`sourceAllocation:${id}`,{...preferred,stats});}
 try{if(plan.caps.purpose!=='listings')throw new Error('Access checks use their dedicated runner');if(plan.caps.maxAiCalls&&plan.caps.billingMode!=='chatgpt')throw new Error('Regular scans require ChatGPT plan access; paid API fallback is disabled');
  const lastAttemptRevision=new Map<number,string>(),attempted=new Set<number>();
  const cachedAreaWork=(source:string)=>mixEnabled(store,budget)&&(!!readQueue(store,source).offerings?.length||pendingCollectionHomes(store,source).some(home=>postingForSource(store,home,source).galleryComplete));
  const execute=async(i:number,share:Budget)=>{const resumed=attempted.has(i);attempted.add(i);lastAttemptRevision.set(i,areaMixRevision(store));const runDeps={...deps,resumeSourcePhase:resumed||deps.resumeSourcePhase};const base=sourceById(results[i].source),index=store.get<number>(`expandedRouteIndex:${base.id}`)??0,source=plan.caps.expandedCoverage?expandedSource(base,index):base;
   try{budget.check();if(!(plan.caps as Caps&{cachedReviewOnly?:boolean}).cachedReviewOnly)store.checkSource(source.id);if((!share.remaining('pages')&&!plan.caps.fullReviewHomeIds?.length&&!cachedAreaWork(source.id))||!share.remaining('listings'))throw new Error('Approved allowance exhausted before this source; no requests made');if(source.coverageTrial)store.set(`expandedRouteIndex:${source.id}`,index+1);results[i]=plan.caps.fullReviewHomeIds?.length?await runSelectedReviews(store,source,share,dataDir,jobs,runDeps):plan.caps.phase==='inventory'?await runInventorySource(store,base,share,dataDir,jobs,runDeps):source.id==='apartments'?await(deps.apartments??runApartmentsSource)(store,share,dataDir,jobs,{source,addressLookup:deps.addressLookup,resumeSourcePhase:runDeps.resumeSourcePhase}):await runWebSource(store,source,share,dataDir,source.id==='zillow'&&!deps.session?{...runDeps,session:(s,b)=>new ChromeSourceSession(s,b,jobs)}:runDeps);if(source.coverageTrial)results[i].detail=`Expanded coverage trial (${source.search}); broader coverage remains unvalidated. ${results[i].detail}`;if(results[i].state==='complete'&&!(plan.caps as Caps&{cachedReviewOnly?:boolean}).cachedReviewOnly)store.db.prepare('INSERT INTO source_health(source,last_success) VALUES (?,?) ON CONFLICT(source) DO UPDATE SET last_success=excluded.last_success').run(source.id,new Date().toISOString());}
   catch(e){const detail=e instanceof Error?e.message:String(e);results[i]={source:source.id,state:/paused|challenge|warning/i.test(detail)?'paused':'partial',detail};}
   const validation=validationSummary(budget,source.id);if(plan.caps.newListingsOnly){results[i]={...results[i],...validation};if((validation.newListings??0)<(validation.targetNewListings??2)&&results[i].state==='complete')results[i].state='partial';results[i].detail+=` New-apartment target: ${validation.newListings}/${validation.targetNewListings}; ${validation.attemptedListings} attempts, ${validation.skippedExisting} existing homes skipped, ${validation.candidateFailures} unsuccessful candidates.`;}
   store.set(`sourceResults:${id}`,results);store.event(`${source.name}: ${results[i].detail}`);
   if(preferred&&getPlan(store,id).usage.listings+getPlan(store,id).usage.pages>0){
    const current=store.get<SourceSelectionState>('sourceAllocation')??allocation;
    store.set('sourceAllocation',{selectionCount:current.selectionCount+(allocationAdvanced?0:1),lastSelected:{...current.lastSelected,[source.id]:new Date().toISOString()}});allocationAdvanced=true;
   }
  };
  const configured=store.get<{scanConcurrency?:number}>('processingPolicy')?.scanConcurrency;
  const concurrency=quickIntake(store,plan.caps)&&results.length>1&&plan.caps.maxAiCalls===0&&(plan.caps.maxAddressLookups??0)===0?Math.max(1,Math.min(3,Number.isInteger(configured)?configured!:3)):1;
  store.set(`sourceExecution:${id}`,{concurrency,chromeConcurrency:1,mode:concurrency>1?'parallel':'sequential'});
  if(concurrency===1&&!(mixEnabled(store,budget)&&results.length>1)){
   for(let i=0;i<results.length;i++){
    budget.check();const count=results.length-i;
    const priority=preferred&&i===0?Math.max(0,Math.min(.75,(budget.remaining('pages')-2*(count-1))/budget.remaining('pages'),(budget.remaining('listings')-(count-1))/budget.remaining('listings'))):undefined;
    await execute(i,new SourceBudget(budget,count,results[i].source,priority&&priority>0?priority:undefined));
   }
  }else{
   const shares=concurrentSourceBudgets(budget,results.map(r=>r.source),!!preferred);
   const pending=results.map((_,i)=>i),running=new Map<number,Promise<void>>(),chrome=(i:number)=>['apartments','zillow'].includes(results[i].source);
   let retries=0;
   try{while(pending.length||running.size){
    while(running.size<concurrency){
     const position=pending.findIndex(i=>!chrome(i)||![...running.keys()].some(chrome));if(position<0)break;
     const i=pending.splice(position,1)[0],work=execute(i,shares[i]).finally(()=>{running.delete(i);});running.set(i,work);
    }
    if(running.size)await Promise.race(running.values());
    // A quota-limited source yields its slot. Retry only after another candidate
    // changed the shared ledger; keep the original source allowances and discovery.
    if(mixEnabled(store,budget)&&getPlan(store,id).state==='running'){
     const revision=areaMixRevision(store);
     for(let i=0;i<results.length&&retries<plan.caps.maxListings*2+results.length;i++)if(results[i].areaDeferred&&!running.has(i)&&!pending.includes(i)&&lastAttemptRevision.get(i)!==revision&&shares[i].remaining('listings')&&(shares[i].remaining('pages')||cachedAreaWork(results[i].source))){pending.push(i);retries++;}
    }
   }}finally{await Promise.allSettled(running.values());}
  }
 }catch(e){store.event(`Scan stopped: ${String(e)}`);}finally{jobs?.fail('Scan stopped');const state=getPlan(store,id).state==='cancelled'?'cancelled':results.every(r=>r.state==='complete')?'complete':'partial';store.db.prepare('UPDATE plans SET state=?,detail=? WHERE id=?').run(state,results.map(r=>`${sourceById(r.source).name}: ${r.state} — ${r.detail}`).join('\n'),id);releaseAreaClaims(store,id);releaseScan(store,id);store.event(`Scan ${state}; ${results.filter(r=>r.state!=='pending').length}/${results.length} sources handled.`);}
}
