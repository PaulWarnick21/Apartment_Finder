import {loadEnvFile} from 'node:process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import {Store,hash} from '../server/db.ts';
import {listingSchema} from '../src/domain.ts';
import {createPlan,approvePlan,claimPlan,Budget,getPlan} from '../server/plans.ts';
import {reviewGallery} from '../server/gallery-review.ts';
import {aiMode} from '../server/chatgpt.ts';
if(!process.argv.includes('--run')){console.log('No requests. Explicit --run requires the authorized three-per-source trial.');process.exit(0);}
loadEnvFile('.env');if(aiMode()!=='chatgpt')throw new Error('ChatGPT plan required; paid API fallback prohibited');
const dir=resolve('data/live'),out=join(dir,'remaining-trial'),store=new Store(join(dir,'apartments.sqlite'));
const listings=(JSON.parse(await readFile(join(out,'extracted.json'),'utf8')) as unknown[]).map(l=>listingSchema.parse(l));
const allowed=(source:string,url:string)=>{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&(source==='zillow'?u.hostname==='photos.zillowstatic.com':source==='rew'?u.hostname==='assets-listings.rew.ca':source==='facebook'?u.hostname.endsWith('.fbcdn.net'):false);};
const rows:listRow[]=[];type listRow={source:string;id:number};let aiStopped=false;
try{
 await store.backupTo(join(dir,'backups','before-remaining-trial.sqlite'));await mkdir(join(dir,'media'),{recursive:true});
 for(const listing of listings)rows.push({source:listing.source,id:store.ingest(listing).id});
 for(const source of [...new Set(rows.map(r=>r.source))]){
  if(rows.filter(r=>r.source===source).length>3)throw new Error('Three candidate cap exceeded');
  let plan:any,error='';try{
   plan=createPlan(store,{purpose:'access-check',billingMode:'chatgpt',sources:[source],maxPages:1,maxListings:3,maxPhotos:200,maxAiCalls:3,maxReservedUsd:0});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);const budget=new Budget(store,plan.id,plan.caps);
   for(const row of rows.filter(r=>r.source===source)){
    budget.reserve('listings');const home=store.home(row.id)!,l=home.listing;
    if(home.score.reasons.length||home.stage==='Not Interested'){console.log(JSON.stringify({source,id:row.id,skipped:home.score.reasons}));continue;}
    try{
     for(const p of l.photos){if(p.local)continue;budget.check();store.checkSource(source);if(!allowed(source,p.url))throw new Error('Photo URL outside source media hosts');
      const daily=store.db.prepare('SELECT COUNT(*) n FROM requests WHERE source=? AND kind=? AND at>=?').get(source,'image',new Date(Date.now()-86400000).toISOString()) as {n:number};if(daily.n>=200)throw new Error('Daily image cap reached');
      budget.reserve('photos');budget.reserve('requests');store.db.prepare('INSERT INTO requests(source,at,kind) VALUES (?,?,?)').run(source,new Date().toISOString(),'image');
      const response=await fetch(p.url,{redirect:'error',signal:AbortSignal.timeout(25000)});
      if([403,429,503].includes(response.status)){store.pause(source,`Photo server returned HTTP ${response.status}`,true);throw new Error('Source paused on photo access warning');}
      if(!response.ok){p.status='unavailable';p.note=`HTTP ${response.status}`;continue;}
      const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>15000000)throw new Error('Photo exceeds size limit');chunks.push(value);}}finally{await reader.cancel();}
      const jpg=await sharp(Buffer.concat(chunks),{limitInputPixels:50000000}).rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer();p.hash=hash(jpg.toString('base64'));p.local=p.hash+'.jpg';p.status='downloaded';await writeFile(join(dir,'media',p.local),jpg);
      await new Promise(r=>setTimeout(r,1000));
     }
     console.log(JSON.stringify({source,id:row.id,photos:l.photos.filter(p=>p.local).length,total:l.photos.length,stage:'AI review'}));
     if(!aiStopped)try{await reviewGallery(l,budget,dir);}catch(e){aiStopped=true;store.event('AI stopped without API fallback: '+String(e));throw e;}
    }finally{store.db.prepare('UPDATE homes SET listing=?,revision=revision+1,updated_at=? WHERE id=?').run(JSON.stringify(l),new Date().toISOString(),row.id);}
    const updated=store.home(row.id)!;console.log(JSON.stringify({source,id:row.id,score:updated.score.value,view:updated.score.view,reviewed:l.photos.filter(p=>p.status==='reviewed').length}));
   }
  }catch(e){error=String(e);console.log(JSON.stringify({source,error}));}
  finally{if(plan){store.db.prepare('UPDATE plans SET state=?,detail=? WHERE id=?').run(error||aiStopped?'partial':'complete',error||'Three remaining-trial candidates processed.',plan.id);store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(plan.id);console.log(JSON.stringify({source,usage:getPlan(store,plan.id).usage}));}await writeFile(join(out,'results.json'),JSON.stringify(rows.map(r=>store.home(r.id)),null,2));}
 }
}finally{store.close();}
