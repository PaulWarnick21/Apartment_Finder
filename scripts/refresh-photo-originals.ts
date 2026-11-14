// Explicit one-time media repair. No discovery, page visits, AI, retries or auto-resume.
import {readFile,writeFile} from 'node:fs/promises';
import {setTimeout as pause} from 'node:timers/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {z} from 'zod';
import {Store} from '../server/db.ts';
import {storePhoto} from '../server/photo-storage.ts';
import {sourceById,allowedUrl} from '../server/sources.ts';
import {createPlan,approvePlan,claimPlan,Budget,getPlan} from '../server/plans.ts';
if(!process.argv.includes('--run')){console.log('Offline only. Run only after approval of the saved photo-refresh plan.');process.exit(0);}
const approvedCount=Number(process.argv.find(a=>a.startsWith('--approved-count='))?.split('=')[1]);
const schema=z.object({createdAt:z.string(),approved:z.boolean(),maxImageRequests:z.number().int().min(1).max(200),maxListingPages:z.literal(0),maxAiCalls:z.literal(0),apartmentIds:z.array(z.number()),items:z.array(z.object({homeId:z.number(),source:z.string(),photoId:z.string(),previousUrl:z.string().url(),url:z.string().url()}))});
const dir='data/live',manifest=schema.parse(JSON.parse(await readFile(join(dir,'photo-refresh-plan.json'),'utf8')));
if(approvedCount!==manifest.maxImageRequests||manifest.items.length>approvedCount||manifest.approved)throw new Error('A matching, unused approved request count is required.');
for(const i of manifest.items)if(!manifest.apartmentIds.includes(i.homeId)||!allowedUrl(i.url,sourceById(i.source).mediaHosts))throw new Error('Invalid repair manifest');
const store=new Store(join(dir,'apartments.sqlite')),results:any[]=[];
try{
 if(store.db.prepare("SELECT id FROM plans WHERE state IN ('approved','running')").get())throw new Error('Another scan is active or approved.');
 await store.backupTo(`data/backups/before-original-photos-${Date.now()}.sqlite`);
 manifest.approved=true;await writeFile(join(dir,'photo-refresh-plan.json'),JSON.stringify(manifest,null,2));
 for(const sourceId of [...new Set(manifest.items.map(i=>i.source))]){
  let plan:any;try{
   const items=manifest.items.filter(i=>i.source===sourceId),source=sourceById(sourceId);
   store.checkSource(sourceId);
   // Existing budget type has a minimum of one page. This runner exposes no page operation;
   // the stricter approved manifest permits zero and recorded page usage always remains zero.
   plan=createPlan(store,{purpose:'access-check',billingMode:'chatgpt',sources:[sourceId],maxPages:1,maxListings:manifest.apartmentIds.length,maxPhotos:items.length,maxAiCalls:0,maxReservedUsd:0});
   approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);const budget=new Budget(store,plan.id,plan.caps);
   for(const item of items){
    budget.check();store.checkSource(sourceId);const h=store.home(item.homeId),old=h?.listing.photos.find(p=>p.id===item.photoId&&p.url===item.previousUrl);
    if(!old||old.sourceLocal){results.push({homeId:item.homeId,photoId:item.photoId,status:'skipped: changed or already refreshed'});continue;}
    const daily=store.db.prepare("SELECT COUNT(*) n FROM requests WHERE source=? AND kind='image' AND at>=?").get(sourceId,new Date(Date.now()-86400000).toISOString()) as {n:number};
    if(daily.n>=(source.dailyImages??100))throw new Error('Daily image budget reached');
    budget.reserve('photos');budget.reserve('requests');store.db.prepare('INSERT INTO requests(source,at,kind) VALUES (?,?,?)').run(sourceId,new Date().toISOString(),'image');
    let bytes:Buffer;
    try{
     const response=await fetch(item.url,{redirect:'error',signal:AbortSignal.timeout(20000)});
     if(!response.ok)throw new Error(`Photo server HTTP ${response.status}`);
     const chunks:Uint8Array[]=[];let size=0;const reader=response.body!.getReader();try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>15*1024*1024)throw new Error('Source photo exceeds 15MB');chunks.push(value);}}finally{await reader.cancel();}
     bytes=Buffer.concat(chunks);
    }catch(e){store.pause(sourceId,String(e),true);throw e;}
    let stored:Awaited<ReturnType<typeof storePhoto>>;
    try{stored=await storePhoto(bytes,dir);}catch(e){store.pause(sourceId,'Unexpected or unsupported photo response; media refresh stopped.',true);throw e;}
    const previous=await sharp(join(dir,'media',old.local!)).metadata();
    if((stored.sourceWidth??0)*(stored.sourceHeight??0)<(previous.width??0)*(previous.height??0)){results.push({homeId:item.homeId,photoId:item.photoId,status:'kept higher-resolution existing preview'});continue;}
    store.transaction(()=>{
     const current=store.home(item.homeId)!,listing=structuredClone(current.listing),photo=listing.photos.find(p=>p.id===item.photoId&&p.url===item.previousUrl);if(!photo)return;
     // Preserve the assessed JPEG/hash and user-calibrated findings; this is a display upgrade.
     photo.sourceUrl=item.url;photo.sourceLocal=stored.sourceLocal;photo.sourceWidth=stored.sourceWidth;photo.sourceHeight=stored.sourceHeight;photo.sourceBytes=stored.sourceBytes;
     listing.evidence.sourcePhotoRefresh='Higher-resolution source files saved for display from advertised variants. Existing photo assessments retained; no AI re-review requested.';
     const now=new Date().toISOString();store.db.prepare('INSERT INTO history(home_id,at,event,before_json,after_json) VALUES (?,?,?,?,?)').run(current.id,now,'Source-quality photo saved',JSON.stringify(current.listing),JSON.stringify(listing));
     store.db.prepare('UPDATE homes SET listing=?,revision=revision+1,updated_at=? WHERE id=?').run(JSON.stringify(listing),now,current.id);
    });
    results.push({homeId:item.homeId,photoId:item.photoId,status:'saved',before:[previous.width,previous.height],after:[stored.sourceWidth,stored.sourceHeight]});
    console.log(JSON.stringify(results.at(-1)));await pause(2000);
   }
   store.db.prepare("UPDATE plans SET state='complete',detail='Approved photo refresh only: zero listing pages and zero AI calls.' WHERE id=?").run(plan.id);
  }catch(e){results.push({source:sourceId,error:String(e)});if(plan)store.db.prepare("UPDATE plans SET state='partial',detail=? WHERE id=?").run(String(e),plan.id);console.log(JSON.stringify(results.at(-1)));}
  finally{if(plan){store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(plan.id);console.log(JSON.stringify({source:sourceId,usage:getPlan(store,plan.id).usage}));}}
 }
 await writeFile(join(dir,'photo-refresh-results.json'),JSON.stringify(results,null,2));
 store.event(`Source-photo refresh saved ${results.filter(r=>r.status==='saved').length} images; no listing-page visits or AI calls.`);
}finally{store.close();}
