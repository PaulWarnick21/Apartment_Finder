import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {storePhoto} from './photo-storage.ts';
import {reusedDownload,rememberDownload} from './gallery-downloads.ts';
import {validationAttempt,validationOutcome,validationTargetReached,ingestNewCandidate} from './new-listing-validation.ts';
import {Store,hash} from './db.ts';
import {Budget,getPlan} from './plans.ts';
import type {ChromeJobClient,ChromeSnapshot} from './chrome-jobs.ts';
import {extractApartments} from './apartments-extraction.ts';
import {reviewGallery} from './gallery-review.ts';
import {hardFailure,pendingHomes,postingForSource,refreshCandidates,reserveRefresh,saveGalleryProgress,galleryResumeAllowance,type SourceResult} from './regular-worker.ts';
import {sourceById,allowedUrl,type Source} from './sources.ts';
import {discoveryCards,nextDiscovery,listingUrl} from './source-discovery.ts';
import {readQueue,saveQueue,mergeDiscovery,removeCandidate,recordCandidateFailure} from './discovery-queue.ts';
type ApartmentDependencies={image?:(url:string,budget:Budget)=>Promise<Buffer>;review?:typeof reviewGallery;source?:Source};
async function downloadImage(url:string,budget:Budget){
 const store=budget.store;budget.check();store.checkSource('apartments');
 const u=new URL(url);if(u.protocol!=='https:'||!/^images\d+\.apartments\.com$/.test(u.hostname)||u.username||u.password||u.port&&u.port!=='443')throw new Error('Untrusted photo host');
 const daily=store.db.prepare("SELECT COUNT(*) n FROM requests WHERE source='apartments' AND kind='image' AND at>=?").get(new Date(Date.now()-86400000).toISOString()) as {n:number};if(daily.n>=150)throw new Error('Daily photo cap reached');
 budget.reserve('photos');budget.reserve('requests');store.db.prepare('INSERT INTO requests(source,at,kind) VALUES (?,?,?)').run('apartments',new Date().toISOString(),'image');
 const response=await fetch(url,{signal:AbortSignal.timeout(20000),redirect:'error'}).catch(e=>{store.pause('apartments','Photo request failed or exceeded its time limit');throw e;});
 if([404,410].includes(response.status))throw new Error(`Image unavailable: ${response.status}`);
 if(!response.ok){store.pause('apartments',`Photo server returned HTTP ${response.status}`,response.status===403);throw new Error('Photo access warning; source paused');}
 const chunks:Uint8Array[]=[];let size=0;const reader=response.body!.getReader();try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>15000000)throw new Error('Photo too large');chunks.push(value);}}finally{await reader.cancel();}
 await new Promise(r=>setTimeout(r,1000));return Buffer.concat(chunks);
}
export async function runApartmentsSource(store:Store,budget:Budget,dataDir:string,jobs?:ChromeJobClient,deps:ApartmentDependencies={}):Promise<SourceResult>{
 const id=budget.id,plan=getPlan(store,id);let partial=false,failed=0,processed=0;
 try{
  if(!jobs)throw new Error('Keep the app and paired Chrome extension open for Apartments.com scans');if(plan.caps.maxAiCalls&&plan.caps.billingMode!=='chatgpt')throw new Error('Chrome trial uses ChatGPT plan access only');
  const source=deps.source??sourceById('apartments'),snapshotDir=join(dataDir,'chrome-scans',id);await mkdir(snapshotDir,{recursive:true});const queue=readQueue(store,'apartments');
  const discover=async(url:string,fresh:boolean)=>{const page=await jobs.request(budget,url,'discovery',store.criteria.maxRent,0);await writeFile(join(snapshotDir,hash(url)+'.json'),JSON.stringify(page));if(page.truncated)throw new Error('Discovery capture truncated');const cards=discoveryCards(page.html,source,url),seen=new Set(cards.map(card=>card.url));for(const link of page.links){const normalized=listingUrl(link,source,url);if(normalized&&!seen.has(normalized)){cards.push({url:normalized});seen.add(normalized);}}if(!cards.length)throw new Error('No listing links recognized on the discovery page');const next=page.next&&allowedUrl(page.next,source.hosts)&&!listingUrl(page.next,source)?page.next:nextDiscovery(page.html,source,url);if(!fresh||!queue.next)queue.next=next;if(fresh)queue.freshCheckedAt=new Date().toISOString();mergeDiscovery(store,source.id,queue,cards);};
  await discover(source.search,true);
  for(const home of refreshCandidates(store,'apartments',budget)){
   if(!budget.remaining('pages')||!budget.remaining('listings'))break;reserveRefresh(store,budget);const url=home.postings.find(p=>p.source==='apartments')!.url;
   const page=await jobs.request(budget,url,'listing',store.criteria.maxRent,0,false,{factsOnly:true});await writeFile(join(snapshotDir,hash(url)+'.json'),JSON.stringify(page));
   try{store.ingest(extractApartments(page),{preservePhotos:true});store.set(`factsChecked:${home.id}:apartments`,new Date().toISOString());}catch(e){recordCandidateFailure(store,'apartments',url,String(e),'refresh');failed++;}
  }
  const pending=budget.caps.newListingsOnly?[]:pendingHomes(store,'apartments');let pendingAllowance=galleryResumeAllowance(store,'apartments',budget,pending.length,queue.urls.length);
  while(budget.remaining('listings')&&!validationTargetReached(budget,'apartments')){
   budget.check();let home=pendingAllowance>0||!queue.urls.length?pending.shift():undefined;if(home)pendingAllowance--;if(!home&&!queue.urls.length){if(queue.next&&budget.remaining('pages')>1){await discover(queue.next,false);if(!queue.urls.length)break;}else break;}
   const posting=home?postingForSource(store,home,'apartments'):undefined,url=posting?.url??queue.urls[0];if(!url)break;if(!posting?.galleryComplete&&!budget.remaining('pages')){if(home)pending.unshift(home);break;}budget.reserve('listings');validationAttempt(budget,'apartments');
   if(!posting?.galleryComplete){
    const knownImages:ChromeSnapshot['images']=home?.listing.photos.map(p=>({url:p.sourceUrl??p.url,alt:'',width:p.sourceWidth??0,height:p.sourceHeight??0}))??[];
    const cursor=store.get<number>(`galleryCursor:apartments:${url}`)??0;
    const page=await jobs.request(budget,url,'listing',store.criteria.maxRent,budget.caps.newListingsOnly?0:budget.remaining('photos'),false,{galleryCursor:cursor,knownImages,factsOnly:budget.caps.newListingsOnly});await writeFile(join(snapshotDir,hash(url)+'.json'),JSON.stringify(page));
    try{const listing=extractApartments(page);listing.galleryComplete=page.galleryComplete&&listing.expectedPhotos!==null&&(page.gallerySlots??listing.photos.length)>=listing.expectedPhotos;const saved=ingestNewCandidate(store,budget,'apartments',listing);removeCandidate(store,'apartments',queue,url);if(!saved)continue;home=store.home(saved.id)!;store.set(`galleryCursor:apartments:${url}`,page.galleryCursor??0);}catch(e){removeCandidate(store,'apartments',queue,url);recordCandidateFailure(store,'apartments',url,String(e),'parse',{preserveExistingGallery:budget.caps.newListingsOnly});validationOutcome(budget,'apartments',{url,result:'parse-failure',reason:String(e)});failed++;continue;}
    if(budget.caps.newListingsOnly&&home&&!hardFailure(home.listing,store.criteria)){
     // Identity is now known to be new. Only this new home may have its full gallery opened.
     saveGalleryProgress(store,home,home.listing,budget,'apartments');
     if(budget.remaining('pages')&&budget.remaining('photos')){
      const gallery=await jobs.request(budget,url,'listing',store.criteria.maxRent,budget.remaining('photos'));await writeFile(join(snapshotDir,hash(url)+'-gallery.json'),JSON.stringify(gallery));
      try{const listing=extractApartments(gallery);listing.galleryComplete=gallery.galleryComplete&&listing.expectedPhotos!==null&&(gallery.gallerySlots??listing.photos.length)>=listing.expectedPhotos;home=store.home(store.ingest(listing).id)!;store.set(`galleryCursor:apartments:${url}`,gallery.galleryCursor??0);}catch(e){recordCandidateFailure(store,'apartments',url,String(e),'parse',{preserveExistingGallery:budget.caps.newListingsOnly});validationOutcome(budget,'apartments',{url,result:'parse-failure',reason:String(e)});failed++;partial=true;}
     }
    }
   }
   if(!home)continue;const listing=home.listing;processed++;
   try{if(!['Not Interested','Closed','Leased'].includes(home.stage)&&!hardFailure(listing,store.criteria)){
    for(const photo of listing.photos){budget.check();store.checkSource('apartments');if(photo.local||photo.status==='unavailable'||!/^https:\/\/images\d+\.apartments\.com\//.test(photo.url))continue;const cached=reusedDownload(budget,photo.url,dataDir);if(cached){Object.assign(photo,cached,{status:'downloaded'});continue;}if(!budget.remaining('photos')){partial=true;break;}try{const downloaded=await storePhoto(await(deps.image??downloadImage)(photo.url,budget),dataDir);Object.assign(photo,downloaded,{status:'downloaded'});rememberDownload(budget,photo.url,downloaded);}catch(e){if(/Daily (?:image|photo) (?:cap|limit) reached/i.test(String(e))){partial=true;break;}if(!/Image unavailable: (404|410)/.test(String(e)))throw e;photo.status='unavailable';photo.note='Source image is no longer available; the gallery gap remains recorded.';}}
    if(listing.photos.some(p=>p.local&&(p.status!=='reviewed'||p.attributionPending))&&budget.remaining('aiCalls'))await(deps.review??reviewGallery)(listing,budget,dataDir);
   }}finally{partial=saveGalleryProgress(store,home,listing,budget,'apartments')||partial;}
  }
  saveQueue(store,'apartments',queue);const more=!!queue.urls.length||!!queue.next||!!pending.length;return {source:'apartments',state:partial||failed||more?'partial':'complete',detail:`Fresh discovery checked; ${processed} candidates processed.${more?' More inventory remains queued.':''}${partial?' Gallery gaps or pending review are recorded.':''}${failed?` ${failed} listing issues retained for review.`:''}`};
 }catch(e){return {source:'apartments',state:/paused|challenge|warning/i.test(String(e))?'paused':'partial',detail:e instanceof Error?e.message:String(e)};}finally{jobs?.fail('Source finished');}
}
export async function runApartmentsPlan(store:Store,id:string,dataDir:string,jobs:ChromeJobClient){const {runRegularPlan}=await import('./regular-worker.ts');return runRegularPlan(store,id,dataDir,jobs);}
