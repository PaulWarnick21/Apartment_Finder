import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import sharp from 'sharp';
import {Store,hash} from './db.ts';
import {Budget,claimPlan,getPlan} from './plans.ts';
import {sourceById} from './sources.ts';
import {SourceSession} from './transport.ts';
import {discover,parseListing} from './parsers.ts';
import {type VisionProvider} from './provider.ts';
import {createVisionProvider} from './chatgpt-provider.ts';
import type {Listing} from '../src/domain.ts';
export async function assessPhotos(store:Store,l:Listing,provider:VisionProvider,budget:Budget,dataDir:string){
 const otherUnit=/photos?\s+(?:are\s+)?(?:of|show|from)\s+(?:a\s+)?(?:similar|other|different|display|model)\s+(?:unit|suite)|photos?\s+(?:are\s+)?(?:representative|for illustrative purposes)|not\s+(?:the\s+)?actual\s+unit/i.test(l.description);
 const checkProvenance=()=>{if(otherUnit)for(const p of l.photos){p.unitCertain=false;p.note=`Exact-unit provenance unverified: listing describes representative photos. ${p.note}`.slice(0,2000);}};
 try{for(const photo of l.photos){budget.check();if(!photo.local||!photo.hash)continue;if(photo.status==='reviewed'&&photo.version===provider.version)continue;const cached=store.db.prepare('SELECT result FROM photo_cache WHERE hash=? AND version=?').get(photo.hash,provider.version) as any;if(cached){Object.assign(photo,JSON.parse(cached.result),{status:'reviewed',version:provider.version});continue;}budget.reserveAi();const finding=await provider.review(photo,join(dataDir,'media',photo.local));Object.assign(photo,finding,{status:'reviewed',version:provider.version});store.db.prepare('INSERT OR REPLACE INTO photo_cache VALUES (?,?,?)').run(photo.hash,provider.version,JSON.stringify(finding));}}finally{checkProvenance();}
}
export async function runPlan(store:Store,id:string,dataDir:string){
 const plan=claimPlan(store,id),budget=new Budget(store,id,plan.caps);let detail='Finished within the approved limits.',state='complete';
 const saveSnapshot=async(url:string,html:string)=>{const dir=join(dataDir,'snapshots',id);await mkdir(dir,{recursive:true});await writeFile(join(dir,`${hash(url)}.html`),html.slice(0,2000000));};
 try{if(plan.caps.sources.includes('apartments'))throw new Error('Run Apartments.com scans from the desk Chrome connection.');if(plan.caps.purpose==='access-check')throw new Error('Access-check plans use the dedicated bounded trial runner.');let provider:VisionProvider|undefined;if(plan.caps.maxAiCalls>0)provider=await createVisionProvider(dataDir,plan.caps);
 for(const sourceId of plan.caps.sources){budget.check();const source=sourceById(sourceId),session=new SourceSession(source,budget,dataDir);
 try{await session.start();const search=await session.html(source.search);if(!search)throw new Error('Discovery page unavailable');await saveSnapshot(source.search,search);const urls=discover(search,source);if(!urls.length)throw new Error('No listing links recognized; adapter needs validation');
 let processed=0;
 for(const url of urls){budget.check();if(getPlan(store,id).usage.listings>=plan.caps.maxListings)break;const seen=store.db.prepare('SELECT checked_at FROM seen WHERE source=? AND url=?').get(sourceId,url) as any;if(seen&&Date.now()-Date.parse(seen.checked_at)<86400000)continue;budget.reserve('listings');const html=await session.html(url);if(!html)continue;await saveSnapshot(url,html);const listing=parseListing(html,url,source);const saved=store.ingest(listing);const home=store.home(saved.id)!;const l=home.listing;
 // Known hard failures and explicit user rejections skip costly image work.
 if(home.stage!=='Not Interested'&&home.score.reasons.length===0){try{await mkdir(join(dataDir,'media'),{recursive:true});for(const p of l.photos){if(p.local)continue;try{const bytes=await session.image(p.url);const jpeg=await sharp(bytes,{limitInputPixels:50000000}).rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer();p.hash=hash(jpeg.toString('base64'));p.local=`${p.hash}.jpg`;await writeFile(join(dataDir,'media',p.local),jpeg);p.status='downloaded';}catch(e){if(session.stopped||/cap|limit|stopped/.test(String(e)))throw e;p.status='unavailable';p.note=String(e).slice(0,300);}}
 if(provider)await assessPhotos(store,l,provider,budget,dataDir);
 }finally{store.db.prepare('UPDATE homes SET listing=?,revision=revision+1 WHERE id=?').run(JSON.stringify(l),saved.id);}}
 store.db.prepare('INSERT OR REPLACE INTO seen VALUES (?,?,?)').run(sourceId,url,new Date().toISOString());processed++;
 }
 store.db.prepare('INSERT INTO source_health(source,last_success) VALUES (?,?) ON CONFLICT(source) DO UPDATE SET last_success=excluded.last_success,reason=NULL,paused_until=NULL').run(sourceId,new Date().toISOString());
 if(processed<urls.length){state='partial';detail='Known listings skipped or bounded coverage; more inventory may remain.';}
 }catch(e){state='partial';detail=String(e).replace(/^Error: /,'');store.event(`${source.name}: ${detail}`);}finally{await session.close();}}
 }catch(e){state='partial';detail=String(e).replace(/^Error: /,'');}
 finally{if(getPlan(store,id).state==='cancelled')state='cancelled';store.db.prepare('UPDATE plans SET state=?,detail=? WHERE id=?').run(state,detail,id);store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(id);store.event(`Scan ${state}: ${detail}`);}
}
