import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {assertFeedbackReady} from './feedback-learning.ts';
import {listingUnavailable} from './listing-availability.ts';
import {scoringFacts} from './scoring-facts.ts';
import {Store,hash} from './db.ts';
import {Budget,claimPlan,getPlan} from './plans.ts';
import {SourceBudget} from './source-budget.ts';
import {SourceSession} from './transport.ts';
import {sourceById,expandedSource,allowedUrl,type Source} from './sources.ts';
import {discoveryCards,inventoryEndpoint,inventoryUrls,nextDiscovery} from './source-discovery.ts';
import {readQueue,saveQueue,mergeDiscovery,removeCandidate,recordCandidateFailure,hasOffering,hasPosting,inventoryCheckKey} from './discovery-queue.ts';
import {parseListing} from './parsers.ts';
import {extractTrial} from './trial-extraction.ts';
import {extractRemaining} from './remaining-extraction.ts';
import {extractZumperOfferings} from './zumper-extraction.ts';
import {reviewGallery} from './gallery-review.ts';
import {storePhoto} from './photo-storage.ts';
import {reusedDownload,rememberDownload} from './gallery-downloads.ts';
import {initializeNewValidation,validationAttempt,validationOutcome,validationTargetReached,ingestNewCandidate,validationSummary} from './new-listing-validation.ts';
import type {Listing,Criteria,Home} from '../src/domain.ts';
import type {ChromeJobClient} from './chrome-jobs.ts';
import {runApartmentsSource} from './apartments-worker.ts';
import {ChromeSourceSession} from './chrome-source-session.ts';
export type SourceResult={source:string;state:'complete'|'partial'|'paused'|'pending';detail:string;newListings?:number;targetNewListings?:number;newHomeIds?:number[];attemptedListings?:number;skippedExisting?:number;candidateFailures?:number};
export function hardFailure(l:Listing,c:Criteria){return l.offeringKind==='building'||listingUnavailable(l)||c.maxRent!==null&&l.rent!==null&&l.rent>=c.maxRent||c.requireLaundry&&['none','shared-only'].includes(l.laundry);}
export const knownUrl=hasPosting;
export function pendingHomes(store:Store,source:string){return store.homes().filter(h=>{const marker=store.get<{source:string;sources?:string[]}>(`pendingGallery:${h.id}`);return h.postings.some(p=>p.source===source)&&!!marker&&(marker.sources??[marker.source]).includes(source)&&!['Closed','Leased','Not Interested'].includes(h.stage);});}
export function postingForSource(store:Store,home:Home,source:string){return store.postingDetails(home.id).find(p=>p.source===source)?.listing??home.listing;}
function locate(l:Listing){if(l.location!=='unknown')return;const area=l.area!=='Unknown'?l.area:l.address;const text=area+' '+l.title;if(/\b(Coal Harbour|West End|Yaletown|Downtown Vancouver)\b/i.test(text)){l.location='downtown';l.evidence.location=text;}else if(/\b(North Vancouver|West Vancouver|Burnaby|Richmond|Coquitlam|Port Moody|Surrey|New Westminster)\b/i.test(text)){l.location='outside';l.evidence.location=text;}}
export function extractSourceOfferings(source:Source,html:string,url:string,xml?:string):Listing[]{
 let listings:Listing[];if(source.id==='craigslist')listings=[parseListing(html,url,source)];else if(['zillow','rew','facebook'].includes(source.id))listings=[extractRemaining(source.id as 'zillow'|'rew'|'facebook',html,url)];else if(source.id==='zumper')listings=extractZumperOfferings(html,url);else listings=[extractTrial(html,url,source,xml)];
 return listings.map(l=>{if(!l.title)throw new Error('Listing title missing; extraction needs review');locate(l);return scoringFacts(l);});
}
export function extractSource(source:Source,html:string,url:string,xml?:string){return extractSourceOfferings(source,html,url,xml)[0];}
type Session=Pick<SourceSession,'start'|'html'|'resource'|'image'|'close'|'stopped'>;
export type ScanDependencies={session?:(source:Source,budget:Budget,dataDir:string)=>Session;review?:typeof reviewGallery;apartments?:typeof runApartmentsSource};
const activeRefreshStages=new Set(['Interested','In Progress','Inquiry Sent','Viewing Booked','Applied']);
export function refreshCandidates(store:Store,source:string,budget:Budget){if(budget.caps.newListingsOnly||!budget.caps.refreshActiveListings||!budget.caps.maxRefreshListings)return [];const used=store.get<number>(`refreshCount:${budget.id}`)??0;if(used>=budget.caps.maxRefreshListings)return [];return store.homes().filter(h=>activeRefreshStages.has(h.stage)&&h.postings.some(p=>p.source===source)).sort((a,b)=>String(store.get(`factsChecked:${a.id}:${source}`)??'').localeCompare(String(store.get(`factsChecked:${b.id}:${source}`)??''))).slice(0,budget.caps.maxRefreshListings-used);}
export function reserveRefresh(store:Store,budget:Budget){budget.reserve('listings');store.set(`refreshCount:${budget.id}`,(store.get<number>(`refreshCount:${budget.id}`)??0)+1);}
export function saveGalleryProgress(store:Store,home:Home,listing:Listing,budget:Budget,source=listing.source){
 store.db.prepare('UPDATE homes SET listing=?,revision=revision+1,updated_at=? WHERE id=?').run(JSON.stringify(listing),new Date().toISOString(),home.id);
 if(hardFailure(listing,store.criteria)){store.db.prepare('DELETE FROM meta WHERE key=?').run(`pendingGallery:${home.id}`);return false;}
 const key=`pendingGallery:${home.id}`,old=store.get<{source:string;sources?:string[]}>(key),pendingSources=new Set(old?(old.sources??[old.source]):[]);
 const own=sourceById(source),ownedPhotos=listing.photos.filter(p=>allowedUrl(p.url,own.mediaHosts)||source==='apartments'&&/^https:\/\/images\d+\.apartments\.com\//.test(p.url));
 const ownPosting=postingForSource(store,home,source),unfinished=!ownPosting.galleryComplete||!ownedPhotos.length||ownedPhotos.some(p=>p.status==='pending'||p.status==='downloaded'||p.attributionPending);
 if(unfinished)pendingSources.add(source);else pendingSources.delete(source);
 if(pendingSources.size)store.set(key,{source,sources:[...pendingSources],homeId:home.id,planId:budget.id});else store.db.prepare('DELETE FROM meta WHERE key=?').run(key);
 return !listing.galleryComplete||!listing.photos.length||listing.photos.some(p=>p.status!=='reviewed'||p.attributionPending);
}
export async function runWebSource(store:Store,source:Source,budget:Budget,dataDir:string,deps:ScanDependencies={}):Promise<SourceResult>{
 const session=deps.session?.(source,budget,dataDir)??new SourceSession(source,budget,dataDir,{visibleChrome:source.visibleChrome});const queue=readQueue(store,source.id);let partial=false,failed=0,processed=0;
 const snapshot=async(url:string,html:string)=>{const dir=join(dataDir,'snapshots',budget.id);await mkdir(dir,{recursive:true});await writeFile(join(dir,hash(url)+'.html'),html.slice(0,5_000_000));};
 const discover=async(url:string,fresh:boolean)=>{const html=await session.html(url);if(!html)throw new Error('Discovery page unavailable');await snapshot(url,html);let cards=discoveryCards(html,source,url);const endpoint=inventoryEndpoint(html,source);if(endpoint)cards=[...cards,...inventoryUrls(await session.resource(endpoint),source).map(url=>({url}))];if(!cards.length)throw new Error('No rental links recognized; discovery requires attention');const next=nextDiscovery(html,source,url);if(!fresh||!queue.next)queue.next=next;if(fresh)queue.freshCheckedAt=new Date().toISOString();mergeDiscovery(store,source.id,queue,cards);};
 try{
  await session.start();if(budget.remaining('pages'))await discover(source.search,true);
  for(const home of refreshCandidates(store,source.id,budget)){
   if(!budget.remaining('pages')||!budget.remaining('listings'))break;reserveRefresh(store,budget);const url=home.postings.find(p=>p.source===source.id)!.url;
   const html=await session.html(url);if(!html){recordCandidateFailure(store,source.id,url,'Listing page returned no facts; availability is unchanged','refresh');continue;}await snapshot(url,html);
   try{const listings=extractSourceOfferings(source,html,url),listing=listings.find(l=>l.sourceId===home.listing.sourceId)??(listings.length===1?listings[0]:null);if(!listing)throw new Error('Saved offering not found in current page; no facts overwritten');store.ingest(listing,{preservePhotos:true});store.set(`factsChecked:${home.id}:${source.id}`,new Date().toISOString());}catch(e){recordCandidateFailure(store,source.id,url,String(e),'refresh');failed++;}
  }
  const pending=budget.caps.newListingsOnly?[]:pendingHomes(store,source.id);let pendingAllowance=galleryResumeAllowance(store,source.id,budget,pending.length,queue.urls.length+(queue.offerings?.length??0));
  while(budget.remaining('listings')&&!validationTargetReached(budget,source.id)){
   budget.check();let home=pendingAllowance>0||!queue.urls.length&&!queue.offerings?.length?pending.shift():undefined;if(home)pendingAllowance--;let offering=home?undefined:queue.offerings?.shift();
   if(!home&&!offering&&!queue.urls.length){if(queue.next&&budget.remaining('pages')>1){await discover(queue.next,false);if(!queue.urls.length&&!queue.offerings?.length)break;}else break;}
   const posting=home?postingForSource(store,home,source.id):undefined,url=posting?.url??offering?.url??queue.urls[0];if(!url)break;if(!offering&&!posting?.galleryComplete&&!budget.remaining('pages')){if(home)pending.unshift(home);break;}budget.reserve('listings');validationAttempt(budget,source.id);
   if(!offering&&!posting?.galleryComplete){
    const html=await session.html(url);if(!html){removeCandidate(store,source.id,queue,url);recordCandidateFailure(store,source.id,url,'Listing page unavailable; no removal inferred','not-found');validationOutcome(budget,source.id,{url,result:'unavailable'});failed++;continue;}await snapshot(url,html);
    const xml=source.id==='sunstar'&&/juicebox/i.test(html)?await session.resource(new URL('config.xml',url).href):undefined;
    try{const listings=extractSourceOfferings(source,html,url,xml),newListings=home?listings.filter(l=>l.sourceId===posting!.sourceId):listings.filter(l=>!hasOffering(store,l));store.set(inventoryCheckKey(source.id,url),new Date().toISOString());removeCandidate(store,source.id,queue,url);if(!newListings.length){validationOutcome(budget,source.id,{url,result:'existing',reason:'No new source offering found'});continue;}offering=newListings[0];queue.offerings=[...(queue.offerings??[]),...newListings.slice(1)];saveQueue(store,source.id,queue);}catch(e){removeCandidate(store,source.id,queue,url);recordCandidateFailure(store,source.id,url,String(e),'parse',{preserveExistingGallery:budget.caps.newListingsOnly});validationOutcome(budget,source.id,{url,result:'parse-failure',reason:String(e)});failed++;continue;}
   }
   if(offering){const saved=ingestNewCandidate(store,budget,source.id,offering);saveQueue(store,source.id,queue);if(!saved)continue;home=store.home(saved.id)!;}if(!home)continue;const listing=home.listing;processed++;
   try{if(!hardFailure(listing,store.criteria)&&!['Not Interested','Closed','Leased'].includes(home.stage)){
    for(const photo of listing.photos){if(photo.local||photo.status==='unavailable'||!allowedUrl(photo.url,source.mediaHosts))continue;const cached=reusedDownload(budget,photo.url,dataDir);if(cached){Object.assign(photo,cached,{status:'downloaded'});continue;}if(!budget.remaining('photos')){partial=true;break;}try{const downloaded=await storePhoto(await session.image(photo.url),dataDir);Object.assign(photo,downloaded,{status:'downloaded'});rememberDownload(budget,photo.url,downloaded);}catch(e){if(!session.stopped&&/Daily (?:image|photo) (?:cap|limit) reached/i.test(String(e))){partial=true;break;}if(session.stopped||!/Image unavailable: (404|410)/.test(String(e)))throw e;photo.status='unavailable';photo.note='Image no longer available from the source; retained as an explicit gallery gap.';}}
    if(listing.photos.some(p=>p.local&&(p.status!=='reviewed'||p.attributionPending))&&budget.remaining('aiCalls'))await(deps.review??reviewGallery)(listing,budget,dataDir);
   }}finally{partial=saveGalleryProgress(store,home,listing,budget,source.id)||partial;}
  }
  saveQueue(store,source.id,queue);const more=queue.urls.length>0||!!queue.next||!!queue.offerings?.length||pending.length>0;
  return {source:source.id,state:partial||more||failed?'partial':'complete',detail:`Fresh discovery checked; ${processed} candidates processed.${more?' More inventory remains queued.':''}${partial?' Gallery gaps or pending review are recorded.':''}${failed?` ${failed} listing issues retained for review; other candidates continued.`:''}`};
 }finally{await session.close();}
}
/** Old incomplete evidence cannot consume every candidate slot forever. */
export function galleryResumeAllowance(store:Store,source:string,budget:Budget,pending:number,newCandidates:number){if(!pending||!newCandidates)return pending;const available=budget.remaining('listings');if(available>1)return Math.floor(available/2);const key=`galleryResumePriority:${source}`,resume=store.get<boolean>(key)??false;store.set(key,!resume);return resume?1:0;}
export async function runRegularPlan(store:Store,id:string,dataDir:string,jobs?:ChromeJobClient,deps:ScanDependencies={}){
 assertFeedbackReady(store);const plan=claimPlan(store,id),budget=new Budget(store,id,plan.caps),results:SourceResult[]=plan.caps.sources.map((source:string)=>({source,state:'pending',detail:'Awaiting its turn.'}));initializeNewValidation(budget);store.set(`sourceResults:${id}`,results);
 try{if(plan.caps.purpose!=='listings')throw new Error('Access checks use their dedicated runner');if(plan.caps.maxAiCalls&&plan.caps.billingMode!=='chatgpt')throw new Error('Regular scans require ChatGPT plan access; paid API fallback is disabled');
  for(let i=0;i<results.length;i++){budget.check();const base=sourceById(results[i].source),index=store.get<number>(`expandedRouteIndex:${base.id}`)??0,source=plan.caps.expandedCoverage?expandedSource(base,index):base,share=new SourceBudget(budget,results.length-i);
   try{store.checkSource(source.id);if(!share.remaining('pages')||!share.remaining('listings'))throw new Error('Approved allowance exhausted before this source; no requests made');if(source.coverageTrial)store.set(`expandedRouteIndex:${source.id}`,index+1);results[i]=source.id==='apartments'?await(deps.apartments??runApartmentsSource)(store,share,dataDir,jobs,{source}):await runWebSource(store,source,share,dataDir,source.id==='zillow'&&!deps.session?{...deps,session:(s,b)=>new ChromeSourceSession(s,b,jobs)}:deps);if(source.coverageTrial)results[i].detail=`Expanded coverage trial (${source.search}); broader coverage remains unvalidated. ${results[i].detail}`;if(results[i].state==='complete')store.db.prepare('INSERT INTO source_health(source,last_success) VALUES (?,?) ON CONFLICT(source) DO UPDATE SET last_success=excluded.last_success').run(source.id,new Date().toISOString());}
   catch(e){const detail=e instanceof Error?e.message:String(e);results[i]={source:source.id,state:/paused|challenge|warning/i.test(detail)?'paused':'partial',detail};}
   const validation=validationSummary(budget,source.id);if(plan.caps.newListingsOnly){results[i]={...results[i],...validation};if((validation.newListings??0)<(validation.targetNewListings??2)&&results[i].state==='complete')results[i].state='partial';results[i].detail+=` New-apartment target: ${validation.newListings}/${validation.targetNewListings}; ${validation.attemptedListings} attempts, ${validation.skippedExisting} existing homes skipped, ${validation.candidateFailures} unsuccessful candidates.`;}
   store.set(`sourceResults:${id}`,results);store.event(`${source.name}: ${results[i].detail}`);
  }
 }catch(e){store.event(`Scan stopped: ${String(e)}`);}finally{jobs?.fail('Scan stopped');const state=getPlan(store,id).state==='cancelled'?'cancelled':results.every(r=>r.state==='complete')?'complete':'partial';store.db.prepare('UPDATE plans SET state=?,detail=? WHERE id=?').run(state,results.map(r=>`${sourceById(r.source).name}: ${r.state} — ${r.detail}`).join('\n'),id);store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(id);store.event(`Scan ${state}; ${results.filter(r=>r.state!=='pending').length}/${results.length} sources handled.`);}
}
