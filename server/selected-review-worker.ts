import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Listing} from '../src/domain.ts';
import {Store,hash} from './db.ts';
import type {Budget} from './plans.ts';
import type {ChromeJobClient,ChromeSnapshot} from './chrome-jobs.ts';
import {SourceSession} from './transport.ts';
import {ChromeSourceSession} from './chrome-source-session.ts';
import {allowedUrl,type Source} from './sources.ts';
import {extractApartments} from './apartments-extraction.ts';
import {downloadApartmentImage} from './apartments-worker.ts';
import {extractSourceOfferings,postingForSource,saveGalleryProgress,type SourceResult,type ScanDependencies} from './regular-worker.ts';
import {quickRank} from './quick-rank.ts';
import {reviewGallery} from './gallery-review.ts';
import {storePhoto,EmptyPhotoError} from './photo-storage.ts';
import {reusedDownload,rememberDownload} from './gallery-downloads.ts';
import {cachedReviewReady} from './cached-review.ts';

export function selectedReviewComplete(listing:Listing){
 return listing.galleryComplete&&listing.photos.length>0&&(listing.expectedPhotos===null||listing.photos.length>=listing.expectedPhotos)&&listing.photos.every(p=>(p.status==='reviewed'||p.status==='unavailable')&&!p.attributionPending);
}
/** This path has no source transport: one saved gallery, one model request at a time. */
async function runCachedReview(store:Store,source:Source,budget:Budget,dataDir:string,deps:ScanDependencies):Promise<SourceResult>{
 budget.check();const id=budget.caps.fullReviewHomeIds?.[0],home=id===undefined?undefined:store.home(id);
 if(!home||home.id!==id||!home.postings.some(posting=>posting.source===source.id))throw new Error('The selected saved apartment or its source changed; retry its assessment.');
 const resultKey=`fullReviewResult:${budget.id}:${id}`,original=(store.db.prepare('SELECT listing FROM homes WHERE id=?').get(id) as {listing:string}).listing;
 const sourceEvidence=()=>JSON.stringify(store.db.prepare('SELECT source,source_id,listing FROM posting_details WHERE home_id=? ORDER BY source,source_id').all(id)),originalSources=sourceEvidence();
 let detail='',hardFiltered=false,complete=false,ready=false;
 try{
  if(home.stage!=='Interested')throw new Error('Apartment is no longer Interested; no further assessment performed.');
  if(!cachedReviewReady(home.listing))throw new Error('The complete gallery is no longer cached; retry to collect the remaining evidence.');
  budget.reserve('listings');ready=true;hardFiltered=!quickRank(home.listing,store.criteria,id).eligible;
  if(!hardFiltered&&home.listing.photos.some(photo=>photo.local&&(photo.status!=='reviewed'||photo.attributionPending))&&budget.remaining('aiCalls'))await(deps.review??reviewGallery)(home.listing,budget,dataDir);
 }catch(error){detail=error instanceof Error?error.message:String(error);}
 finally{
  // Intake or a duplicate merge can add facts/photos while the model runs. Keep
  // reusable image findings, but never replace that newer listing with a snapshot.
  store.transaction(()=>{
   const latest=store.db.prepare('SELECT listing FROM homes WHERE id=?').get(id) as {listing:string}|undefined;
   if(store.resolveHomeId(id)!==id||latest?.listing!==original||sourceEvidence()!==originalSources)detail='Listing facts or gallery changed during assessment; saved image findings are retained for a retry.';
   else if(ready){saveGalleryProgress(store,home,home.listing,budget,source.id);complete=hardFiltered||selectedReviewComplete(home.listing);}
   const inaccessiblePhotos=home.listing.photos.filter(photo=>photo.status==='unavailable').length;
   store.set(resultKey,{complete,hardFiltered,inaccessiblePhotos,detail:detail||(hardFiltered?'Full scoring completed from confirmed hard requirements.':complete?`Full assessment complete.${inaccessiblePhotos?` ${inaccessiblePhotos} inaccessible photos remain explicitly recorded.`:''}`:'Gallery evidence remains incomplete; saved progress can resume.'),updatedAt:new Date().toISOString()});
  });
 }
 return {source:source.id,state:complete?'complete':'partial',detail:`Selected-apartment cached assessment: ${complete?'complete':'incomplete'}. No listing-source requests.${detail?' '+detail:''}`};
}
/** User-selected apartments only. This runner never reads or advances discovery queues. */
export async function runSelectedReviews(store:Store,source:Source,budget:Budget,dataDir:string,jobs?:ChromeJobClient,deps:ScanDependencies={}):Promise<SourceResult>{
 if(budget.caps.cachedReviewOnly)return runCachedReview(store,source,budget,dataDir,deps);
 let session:ReturnType<NonNullable<ScanDependencies['session']>>|undefined,partial=false,processed=0;
 const start=async()=>{
  if(!session){session=deps.session?.(source,budget,dataDir)??(source.id==='zillow'?new ChromeSourceSession(source,budget,jobs):new SourceSession(source,budget,dataDir,{visibleChrome:source.visibleChrome}));await session.start();}
  return session;
 };
 const ids=[...new Set(budget.caps.fullReviewHomeIds??[])].map(id=>store.resolveHomeId(id));
 try{
  for(const id of ids){
   budget.check();let home=store.home(id);if(!home||!home.postings.some(p=>p.source===source.id))continue;
   const resultKey=`fullReviewResult:${budget.id}:${id}`;
   if(home.stage!=='Interested'){store.set(resultKey,{complete:false,hardFiltered:false,detail:'Apartment is no longer Interested; no further assessment performed.'});continue;}
   if(!budget.remaining('listings')){partial=true;break;}budget.reserve('listings');processed++;
   let detail='',hardFiltered=!quickRank(home.listing,store.criteria,id).eligible;
   try{
    if(!hardFiltered){
     let posting=postingForSource(store,home,source.id);
     if(!posting.galleryComplete&&budget.remaining('pages')){
      if(source.id==='apartments'){
       if(!jobs)throw new Error('Keep the app and paired Chrome extension open to collect the remaining apartment gallery.');
       let previousCursor=-1;
       while(!posting.galleryComplete&&budget.remaining('pages')){
        const cursor=store.get<number>(`galleryCursor:apartments:${posting.url}`)??0;
        const knownImages:ChromeSnapshot['images']=home.listing.photos.map(p=>({url:p.sourceUrl??p.url,alt:'',width:p.sourceWidth??0,height:p.sourceHeight??0}));
        const capture=await jobs.request(budget,posting.url,'listing',store.criteria.maxRent,budget.remaining('photos'),false,{galleryCursor:cursor,knownImages});
        const listing=extractApartments(capture);listing.galleryComplete=capture.galleryComplete&&listing.expectedPhotos!==null&&(capture.gallerySlots??listing.photos.length)>=listing.expectedPhotos;
        if(listing.sourceId!==posting.sourceId)throw new Error('The saved apartment identity was not found; no replacement listing was accepted.');
        store.ingest(listing);home=store.home(id)!;posting=postingForSource(store,home,source.id);store.set(`galleryCursor:apartments:${posting.url}`,capture.galleryCursor??0);
        if(!posting.galleryComplete&&(capture.galleryCursor??0)<=previousCursor)break;previousCursor=capture.galleryCursor??0;
       }
      }else{
       const transport=await start(),html=await transport.html(posting.url);
       if(!html)throw new Error('Saved listing page unavailable; its availability and user decision are unchanged.');
       const dir=join(dataDir,'snapshots',budget.id);await mkdir(dir,{recursive:true});await writeFile(join(dir,hash(posting.url)+'.html'),html.slice(0,5_000_000));
       const xml=source.id==='sunstar'&&/juicebox/i.test(html)?await transport.resource(new URL('config.xml',posting.url).href):undefined;
       const listing=extractSourceOfferings(source,html,posting.url,xml).find(l=>l.sourceId===posting.sourceId);
       if(!listing)throw new Error('The saved apartment identity was not found; no replacement listing was accepted.');
       store.ingest(listing);home=store.home(id)!;
      }
     }
     hardFiltered=!quickRank(home.listing,store.criteria,id).eligible;
     if(!hardFiltered){
      for(const photo of home.listing.photos){
       budget.check();if(store.home(id)?.stage!=='Interested')throw new Error('Apartment is no longer Interested; assessment stopped.');
       if(photo.local||photo.status==='unavailable'||!allowedUrl(photo.url,source.mediaHosts))continue;
       const reused=reusedDownload(budget,photo.url,dataDir);if(reused){Object.assign(photo,reused,{status:'downloaded'});continue;}
       if(!budget.remaining('photos')){partial=true;break;}
       try{const bytes=source.id==='apartments'?await downloadApartmentImage(photo.url,budget):await(await start()).image(photo.url),downloaded=await storePhoto(bytes,dataDir);Object.assign(photo,downloaded,{status:'downloaded'});rememberDownload(budget,photo.url,downloaded);}
       catch(error){if(session?.stopped||!(error instanceof EmptyPhotoError)&&!/Image unavailable: (404|410)/.test(String(error)))throw error;photo.status='unavailable';photo.note='Photo is inaccessible; retained as an explicit evidence gap.';}
      }
      if(home.listing.photos.some(p=>p.local&&(p.status!=='reviewed'||p.attributionPending))&&budget.remaining('aiCalls'))await(deps.review??reviewGallery)(home.listing,budget,dataDir);
     }
    }
   }catch(error){detail=error instanceof Error?error.message:String(error);partial=true;}
   finally{
    saveGalleryProgress(store,home,home.listing,budget,source.id);
    const complete=hardFiltered||selectedReviewComplete(home.listing),inaccessiblePhotos=home.listing.photos.filter(p=>p.status==='unavailable').length;
    store.set(resultKey,{complete,hardFiltered,inaccessiblePhotos,detail:detail||(hardFiltered?'Full scoring completed from confirmed hard requirements.':complete?`Full assessment complete.${inaccessiblePhotos?` ${inaccessiblePhotos} inaccessible photos remain explicitly recorded.`:''}`:'Gallery evidence remains incomplete; saved progress can resume.'),updatedAt:new Date().toISOString()});
    if(!complete)partial=true;
   }
  }
  return {source:source.id,state:partial?'partial':'complete',detail:`Selected-apartment full assessment: ${processed} saved apartment(s). No new discovery.${partial?' Incomplete evidence or failures remain recorded.':''}`};
 }finally{await session?.close();}
}
