import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {Store,hash} from './db.ts';
import {Budget,claimPlan,getPlan} from './plans.ts';
import {ChromeJobs} from './chrome-jobs.ts';
import {extractApartments} from './apartments-extraction.ts';
import {reviewGallery} from './gallery-review.ts';
import {sourceById} from './sources.ts';
export async function runApartmentsPlan(store:Store,id:string,dataDir:string,jobs:ChromeJobs){
 const plan=claimPlan(store,id),budget=new Budget(store,id,plan.caps);let state='complete',detail='Approved Apartments.com scan finished.';
 try{
  if(plan.caps.sources.length!==1||plan.caps.sources[0]!=='apartments')throw new Error('Chrome scans require Apartments.com alone');
  if(plan.caps.maxAiCalls&&plan.caps.billingMode!=='chatgpt')throw new Error('Chrome trial uses ChatGPT plan access only');
  const source=sourceById('apartments'),snapshotDir=join(dataDir,'chrome-scans',id);await mkdir(snapshotDir,{recursive:true});
  const discovery=await jobs.request(budget,source.search,'discovery',store.criteria.maxRent,0);
  await writeFile(join(snapshotDir,'discovery.json'),JSON.stringify(discovery));
  const urls=[...new Set(discovery.links)].filter(url=>/^https:\/\/www\.apartments\.com\/[^/]+\/[a-z0-9]{7}\/$/.test(url)).slice(0,plan.caps.maxListings);
  if(!urls.length)throw new Error('No listing links recognized on the discovery page');
  for(const url of urls){
   const existing=store.homes().find(h=>h.postings.some(p=>p.source==='apartments'&&p.url===url));
   // A bounded repair run retains its candidates and skips known hard failures.
   if(existing&&(existing.stage==='Not Interested'||existing.score.reasons.length))continue;
   budget.check();budget.reserve('listings');const remaining=plan.caps.maxPhotos-getPlan(store,id).usage.photos;
   const page=await jobs.request(budget,url,'listing',store.criteria.maxRent,remaining);await writeFile(join(snapshotDir,hash(url)+'.json'),JSON.stringify(page));
   const listing=extractApartments(page),saved=store.ingest(listing),home=store.home(saved.id)!;const l=home.listing;
   if(home.stage==='Not Interested'||home.score.reasons.length)continue;
   l.galleryComplete=page.galleryComplete&&l.expectedPhotos!==null&&l.photos.length===l.expectedPhotos;
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
     const jpg=await sharp(Buffer.concat(chunks),{limitInputPixels:50000000}).rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer();
     photo.hash=hash(jpg.toString('base64'));photo.local=photo.hash+'.jpg';photo.status='downloaded';await writeFile(join(dataDir,'media',photo.local),jpg);
     await new Promise(r=>setTimeout(r,1000));
    }
    if(plan.caps.maxAiCalls&&l.galleryComplete)await reviewGallery(l,budget,dataDir);
    if(!l.galleryComplete||l.photos.some(p=>p.status!=='reviewed')){state='partial';detail='Captured work retained; gallery retrieval or AI review remains incomplete.';}
   }finally{store.db.prepare('UPDATE homes SET listing=?,revision=revision+1,updated_at=? WHERE id=?').run(JSON.stringify(l),new Date().toISOString(),saved.id);}
  }
 }catch(e){state='partial';detail=e instanceof Error?e.message:String(e);}
 finally{jobs.fail('Scan stopped');if(getPlan(store,id).state==='cancelled')state='cancelled';store.db.prepare('UPDATE plans SET state=?,detail=? WHERE id=?').run(state,detail,id);store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(id);store.event(`Apartments.com scan ${state}: ${detail}`);}
}
