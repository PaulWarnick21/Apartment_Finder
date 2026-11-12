import {loadEnvFile} from 'node:process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import {Store,hash} from '../server/db.ts';
import {listingSchema} from '../src/domain.ts';
import {createPlan,approvePlan,claimPlan,Budget,getPlan} from '../server/plans.ts';
import {SourceSession} from '../server/transport.ts';
import {sourceById} from '../server/sources.ts';
import {reviewGallery} from '../server/gallery-review.ts';
import {aiMode} from '../server/chatgpt.ts';
if(!process.argv.includes('--run')){console.log('No network or AI requests made. --run requires prior user authorization.');process.exit(0);}
loadEnvFile('.env');if(aiMode()!=='chatgpt')throw new Error('Trial requires ChatGPT plan access.');
const dir=resolve('data/live'),store=new Store(join(dir,'apartments.sqlite'));
const selected=process.argv.find(a=>a.startsWith('--source='))?.slice(9);
const rows=(JSON.parse(await readFile(join(dir,'initial-trial/extracted.json'),'utf8')) as any[]).filter(r=>!selected||r.source===selected);
let aiStopped=false;
try{
 // Ingest every captured candidate before network work, retaining all interrupted work.
 for(const r of rows){const l=listingSchema.parse(r.listing);r.id=store.ingest(l).id;}
 await mkdir(join(dir,'media'),{recursive:true});
 for(const sourceId of [...new Set(rows.map(r=>r.source))]){
 let plan:any,session:SourceSession|undefined,error='';
 try{plan=createPlan(store,{purpose:'access-check',billingMode:'chatgpt',sources:[sourceId],maxPages:1,maxListings:3,maxPhotos:sourceId==='zumper'?150:100,maxAiCalls:3,maxReservedUsd:0});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);const budget=new Budget(store,plan.id,plan.caps);session=new SourceSession(sourceById(sourceId),budget,dir);await session.start();
 for(const r of rows.filter(r=>r.source===sourceId)){budget.reserve('listings');const h=store.home(r.id)!,l=h.listing;if(h.score.reasons.length||h.stage==='Not Interested'){console.log(JSON.stringify({id:r.id,source:sourceId,skipped:h.score.reasons}));continue;}
 try{for(const p of l.photos){if(p.local)continue;try{const bytes=await session.image(p.url);const jpeg=await sharp(bytes,{limitInputPixels:50000000}).rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer();p.hash=hash(jpeg.toString('base64'));p.local=p.hash+'.jpg';await writeFile(join(dir,'media',p.local),jpeg);p.status='downloaded';}catch(e){if(session.stopped||/cap|limit|stopped/i.test(String(e)))throw e;p.status='unavailable';p.note=String(e).slice(0,300);}}
 console.log(JSON.stringify({id:r.id,source:sourceId,downloaded:l.photos.filter(p=>p.local).length,total:l.photos.length,stage:'AI review'}));
 if(!aiStopped)try{await reviewGallery(l,budget,dir);}catch(e){aiStopped=true;store.event('Trial AI review stopped without paid fallback: '+String(e));console.log(JSON.stringify({aiStopped:true,error:String(e)}));}
 }finally{store.db.prepare('UPDATE homes SET listing=?,revision=revision+1 WHERE id=?').run(JSON.stringify(l),r.id);}
 const updated=store.home(r.id)!;console.log(JSON.stringify({id:r.id,source:sourceId,score:updated.score.value,view:updated.score.view,reviewed:l.photos.filter(p=>p.status==='reviewed').length}));
 store.db.prepare('INSERT OR REPLACE INTO seen VALUES (?,?,?)').run(sourceId,l.url,new Date().toISOString());
 }
 }catch(e){error=String(e);console.log(JSON.stringify({source:sourceId,error}));}finally{await session?.close();if(plan){const detail=error|| (aiStopped?'Captured listings retained; AI review interrupted.':'Captured listings assessed within the three-listing trial.');store.db.prepare('UPDATE plans SET state=?,detail=? WHERE id=?').run(error||aiStopped?'partial':'complete',detail,plan.id);store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(plan.id);console.log(JSON.stringify({source:sourceId,usage:getPlan(store,plan.id).usage}));}store.event(`${sourceById(sourceId).name}: ${error||'Initial trial results saved.'}`);}
 }
 const results=rows.map(r=>store.home(r.id));await writeFile(join(dir,'initial-trial/'+(selected?selected+'-':'')+'results.json'),JSON.stringify(results,null,2));
}finally{store.close();}
