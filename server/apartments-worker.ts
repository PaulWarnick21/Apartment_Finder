import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {storePhoto} from './photo-storage.ts';
import {Store,hash} from './db.ts';
import {Budget,claimPlan,getPlan} from './plans.ts';
import {ChromeJobs} from './chrome-jobs.ts';
import {extractApartments} from './apartments-extraction.ts';
import {reviewGallery} from './gallery-review.ts';
import {hardFailure,knownUrl,pendingHomes,type SourceResult} from './regular-worker.ts';
import {sourceById} from './sources.ts';
export async function runApartmentsSource(store:Store,budget:Budget,dataDir:string,jobs?:ChromeJobs):Promise<SourceResult>{
 const id=budget.id,plan=getPlan(store,id);let state:'complete'|'partial'='complete',detail='Approved Apartments.com scan finished.';
 try{
  if(!jobs)throw new Error('Keep the app and paired Chrome extension open for Apartments.com scans');
  if(plan.caps.maxAiCalls&&plan.caps.billingMode!=='chatgpt')throw new Error('Chrome trial uses ChatGPT plan access only');
  const source=sourceById('apartments'),snapshotDir=join(dataDir,'chrome-scans',id);await mkdir(snapshotDir,{recursive:true});
  const queueKey='discoveryQueue:apartments',queued=store.get<{urls:string[];next:string|null}>(queueKey);
  const discovery=queued?.urls.length?{links:queued.urls}:await jobs.request(budget,queued?.next??source.search,'discovery',store.criteria.maxRent,0);
  await writeFile(join(snapshotDir,'discovery.json'),JSON.stringify(discovery));
  const pending=pendingHomes(store,'apartments');
  const urls=[...new Set([...pending.map(h=>h.listing.url),...discovery.links])].filter(url=>/^https:\/\/www\.apartments\.com\/[^/]+\/[a-z0-9]{7}\/$/.test(url));
  if(!urls.length)throw new Error('No listing links recognized on the discovery page');
  store.set(queueKey,{urls:urls.filter(url=>!knownUrl(store,'apartments',url)),next:discovery.links.find(url=>/^https:\/\/www\.apartments\.com\/condos\/vancouver-bc\/\d+\/$/.test(url))||null});
  for(const url of urls){
   const existing=store.homes().find(h=>h.postings.some(p=>p.source==='apartments'&&p.url===url));
   // A bounded repair run retains its candidates and skips known hard failures.
   if(existing&&!pending.some(h=>h.id===existing.id))continue;if(!budget.remaining('listings')||!budget.remaining('pages')){state='partial';detail='Approved source allowance reached; more inventory remains.';break;}
   budget.check();budget.reserve('listings');const remaining=budget.remaining('photos');
   let home=existing;if(!home?.listing.galleryComplete){const page=await jobs.request(budget,url,'listing',store.criteria.maxRent,remaining);await writeFile(join(snapshotDir,hash(url)+'.json'),JSON.stringify(page));const listing=extractApartments(page);listing.galleryComplete=page.galleryComplete&&listing.expectedPhotos!==null&&listing.photos.length===listing.expectedPhotos;home=store.home(store.ingest(listing).id)!;}const l=home.listing;
   if(['Not Interested','Closed','Leased'].includes(home.stage)||hardFailure(l,store.criteria))continue;

   try{
    await mkdir(join(dataDir,'media'),{recursive:true});
    for(const photo of l.photos){
     budget.check();store.checkSource('apartments');if(photo.local)continue;
     const u=new URL(photo.url);if(u.protocol!=='https:'||!/^images\d+\.apartments\.com$/.test(u.hostname)||u.username||u.password||u.port&&u.port!=='443')throw new Error('Untrusted photo host');
     const daily=store.db.prepare("SELECT COUNT(*) n FROM requests WHERE source='apartments' AND kind='image' AND at>=?").get(new Date(Date.now()-86400000).toISOString()) as {n:number};
     if(daily.n>=150)throw new Error('Daily photo cap reached');
     budget.reserve('photos');budget.reserve('requests');store.db.prepare('INSERT INTO requests(source,at,kind) VALUES (?,?,?)').run('apartments',new Date().toISOString(),'image');
     const response=await fetch(u,{signal:AbortSignal.timeout(20000),redirect:'error'});
     if([403,429,503].includes(response.status)){store.pause('apartments',`Photo server returned HTTP ${response.status}`,true);throw new Error('Photo access warning; source paused');}
     if(!response.ok){photo.status='unavailable';photo.note=`HTTP ${response.status}`;continue;}
     const chunks:Uint8Array[]=[];let size=0;const reader=response.body!.getReader();try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>15000000)throw new Error('Photo too large');chunks.push(value);}}finally{await reader.cancel();}
     Object.assign(photo,await storePhoto(Buffer.concat(chunks),dataDir));photo.status='downloaded';
     await new Promise(r=>setTimeout(r,1000));
    }
    if(budget.remaining('aiCalls')&&l.galleryComplete&&l.photos.length&&l.photos.every(p=>p.local))await reviewGallery(l,budget,dataDir);
    if(!l.galleryComplete||l.photos.some(p=>p.status!=='reviewed')){state='partial';detail='Captured work retained; gallery retrieval or AI review remains incomplete.';}
   }finally{store.db.prepare('UPDATE homes SET listing=?,revision=revision+1,updated_at=? WHERE id=?').run(JSON.stringify(l),new Date().toISOString(),home.id);if(!l.galleryComplete||l.photos.some(p=>p.status!=='reviewed'))store.set(`pendingGallery:${home.id}`,{source:'apartments',homeId:home.id,planId:id});else store.db.prepare('DELETE FROM meta WHERE key=?').run(`pendingGallery:${home.id}`);}
  }
 }catch(e){state='partial';detail=e instanceof Error?e.message:String(e);}
 finally{jobs?.fail('Source finished');}
 return {source:'apartments',state,detail};
}

export async function runApartmentsPlan(store:Store,id:string,dataDir:string,jobs:ChromeJobs){const {runRegularPlan}=await import('./regular-worker.ts');return runRegularPlan(store,id,dataDir,jobs);}
