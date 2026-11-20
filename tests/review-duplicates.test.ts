import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {Store} from '../server/db.ts';
import {listingSchema,type Listing} from '../src/domain.ts';
import {storePhoto} from '../server/photo-storage.ts';
import {reviewDuplicateEvidence,deduplicateForFullReview} from '../server/review-duplicates.ts';
import {duplicateEvidence} from '../server/automatic-duplicates.ts';
import {FullReviewService} from '../server/full-review.ts';
import {runSelectedReviews} from '../server/selected-review-worker.ts';
import {Budget,createPlan,approvePlan,claimPlan} from '../server/plans.ts';
import {sourceById} from '../server/sources.ts';

const description='This furnished corner penthouse has a private rooftop patio accessed by internal stairs beside the laundry cupboard. The living room contains a blue sectional sofa and a round wall mirror beside the breakfast counter. A separate den contains a standing desk and bookcases. The bedroom includes a queen bed with a wooden frame and two bedside lights. A green patterned wall surrounds the bathroom vanity. Rent includes one secure parking stall and a bicycle space. Available December first for a twelve month lease. The owner leaves the dining table, patio umbrella, fire table and outdoor sectional for the tenant. Please arrange a viewing of this specific home.';
const listing=(id:string,patch:Partial<Listing>={})=>listingSchema.parse({source:'craigslist',sourceId:id,url:`https://vancouver.craigslist.org/van/apa/d/${id}.html`,title:'Furnished penthouse',address:'123 Example Street, Vancouver',unit:'',beds:1,sqft:630,rent:3000,description,galleryComplete:true,...patch});
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'af-perceptual-')),store=new Store(':memory:');
 const original=[],reencoded=[];
 for(let n=0;n<8;n++){
  let seed=n+1;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  const shapes=Array.from({length:35},()=>`<rect x="${random()%450}" y="${random()%290}" width="${30+random()%120}" height="${30+random()%110}" fill="rgb(${random()%256},${random()%256},${random()%256})"/>`).join('');
  const bytes=await sharp(Buffer.from(`<svg width="600" height="400"><rect width="600" height="400" fill="#ece6d8"/>${shapes}</svg>`)).jpeg({quality:95}).toBuffer();
  original.push({...await storePhoto(bytes,dir),id:`a${n}`,url:`https://images.craigslist.org/a${n}.jpg`,status:'reviewed',kind:'interior',unitCertain:true,note:'The non-representative listing identifies the actual apartment.'});
  if(n<4)reencoded.push({...await storePhoto(await sharp(bytes).resize(360,240).webp({quality:75}).toBuffer(),dir),id:`b${n}`,url:`https://other.test/b${n}.webp`,status:'downloaded',kind:'unknown',unitCertain:false});
 }
 return {dir,store,a:listingSchema.parse({...listing('a'),photos:original}),b:listingSchema.parse({...listing('b',{address:'Vancouver, BC V5T 0G5'}),photos:reencoded}),close:async()=>{store.close();await rm(dir,{recursive:true,force:true});}};
}
test('resized subset galleries match using corroborated facts; marketing, conflicts and missing evidence do not',async()=>{
 const f=await fixture();try{
  assert.equal(duplicateEvidence(f.a,f.b),undefined);
  assert.match(await reviewDuplicateEvidence(f.store,f.dir,f.a,f.b)??'',/4 visually matching/);
  for(const patch of [{unit:'204',address:'123 Example Street #204, Vancouver'},{address:'456 Other Street, Vancouver'},{beds:2},{sqft:900},{rent:1800},{floorLevel:3},{description:'A different rental without supporting details.'},{description:description+' Images shown are display suites.'}]){
   assert.equal(await reviewDuplicateEvidence(f.store,f.dir,{...f.a,unit:'203',floorLevel:12},{...f.b,...patch}),undefined,JSON.stringify(patch));
  }
  const shared={...f.a,description:description+' A collection of 31 modern rental homes.'};
  assert.equal(duplicateEvidence(shared,{...shared,sourceId:'shared-other'}),undefined);
  assert.equal(await reviewDuplicateEvidence(f.store,f.dir,shared,f.b),undefined);
  assert.equal(await reviewDuplicateEvidence(f.store,f.dir,{...f.a,photos:f.a.photos.map(p=>({...p,unitCertain:false}))},f.b),undefined);
  assert.equal(await reviewDuplicateEvidence(f.store,f.dir,{...f.a,photos:Array(5).fill(f.a.photos[0])},{...f.b,photos:Array(5).fill(f.b.photos[0])}),undefined);
  assert.equal(await reviewDuplicateEvidence(f.store,f.dir,f.a,{...f.b,photos:f.b.photos.map(p=>({...p,local:'f'.repeat(64)+'.jpg'}))}),undefined);
  const count=f.store.db.prepare("SELECT count(*) n FROM meta WHERE key LIKE 'review-duplicates-v1:image:%'").get()!.n;
  await reviewDuplicateEvidence(f.store,f.dir,f.a,f.b);
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM meta WHERE key LIKE 'review-duplicates-v1:image:%'").get()!.n,count,'Immutable image signatures are reused');
 }finally{await f.close();}
});
test('specific identical rental text supports missing-gallery cross-posts, but multi-suite and generic text do not',async()=>{
 const f=await fixture();try{
  assert.match(await reviewDuplicateEvidence(f.store,f.dir,f.a,{...f.b,address:f.a.address,photos:[]})??'',/identical specific/);
  assert.equal(await reviewDuplicateEvidence(f.store,f.dir,{...f.a,description:description+' Slideshow photos: 1st #302, 2nd #1105.'},{...f.b,address:f.a.address,photos:[]}),undefined);
  assert.equal(await reviewDuplicateEvidence(f.store,f.dir,{...f.a,description:'Nice building with gym.'},{...f.b,address:f.a.address,description:'Nice building with gym.',photos:[]}),undefined);
 }finally{await f.close();}
});
test('submission deduplicates before account/network calls and preserves the more advanced record plus recovery history',async()=>{
 const f=await fixture();const service=new FullReviewService(f.store,f.dir,{hasActive:false,start(){assert.fail('Duplicate must not launch');}},false,{usage:async()=>assert.fail('No usage request'),connection:async()=>assert.fail('No connection request')});
 try{
  f.store.set('reviewWorkflow',{mode:'quick-first'});const lower=f.store.ingest(f.b).id,keep=f.store.ingest(f.a).id;
  f.store.db.prepare("UPDATE homes SET stage='Serious Candidates',notes='Keep my review' WHERE id=?").run(keep);
  f.store.set(`fullReview:${keep}`,{status:'complete',detail:'saved assessment',updatedAt:new Date().toISOString()});
  const before=f.store.home(keep)!;f.store.db.prepare("UPDATE homes SET stage='Interested',notes='New cross-post note' WHERE id=?").run(lower);
  f.store.set(`fullReview:${lower}`,{status:'queued',updatedAt:new Date().toISOString()});await service.tick();
  assert.equal(f.store.resolveHomeId(lower),keep);assert.equal(f.store.home(keep)!.stage,'Serious Candidates');assert.deepEqual(f.store.home(keep)!.score,before.score);assert.deepEqual(f.store.home(keep)!.fullReview,before.fullReview);
  assert.match(f.store.home(keep)!.notes,/Keep my review[\s\S]*New cross-post note/);assert.equal(f.store.get<any>(`fullReview:${lower}`).status,'cancelled');assert.equal(f.store.db.prepare('SELECT count(*) n FROM plans').get()!.n,0);
  const merge=f.store.get<any>(`reviewDuplicate:${lower}`);assert.ok(merge.mergeId);f.store.splitMerge(merge.mergeId);
  await deduplicateForFullReview(f.store,lower,f.dir);assert.equal(f.store.resolveHomeId(lower),lower,'Explicit different-home decision prevents remerging after split');
 }finally{await service.close();await f.close();}
});
test('worker also deduplicates before source/model work, including direct selected-review plans',async()=>{
 const f=await fixture();try{
  const keep=f.store.ingest(f.a).id,drop=f.store.ingest(f.b).id;
  f.store.db.prepare("UPDATE homes SET stage='Interested' WHERE id IN (?,?)").run(keep,drop);
  const plan=createPlan(f.store,{sources:['craigslist'],assessmentMode:'full',fullReviewHomeIds:[drop],maxPages:1,maxListings:1,maxPhotos:0,maxAiCalls:1,maxReservedUsd:0});approvePlan(f.store,plan.id,'APPROVE ONE SCAN');claimPlan(f.store,plan.id);
  const result=await runSelectedReviews(f.store,sourceById('craigslist'),new Budget(f.store,plan.id,plan.caps),f.dir,undefined,{session(){assert.fail('No source request');},async review(){assert.fail('No model request');}});
  assert.match(result.detail,/Duplicate assessment skipped/);assert.equal(f.store.resolveHomeId(drop),keep);
 }finally{await f.close();}
});
test('a stage decision during asynchronous image reads prevents a stale merge',async()=>{
 const f=await fixture();try{
  const keep=f.store.ingest(f.a).id,drop=f.store.ingest(f.b).id;f.store.db.prepare("UPDATE homes SET stage='Interested' WHERE id IN (?,?)").run(keep,drop);
  const checking=deduplicateForFullReview(f.store,drop,f.dir);
  f.store.db.prepare("UPDATE homes SET stage='Not Interested',revision=revision+1 WHERE id=?").run(drop);await checking;
  assert.equal(f.store.resolveHomeId(drop),drop);assert.equal(f.store.home(drop)!.stage,'Not Interested');
 }finally{await f.close();}
});
test('a fresh production worker loads the check with zero source and AI usage',async()=>{
 const f=await fixture();let persisted:Store|undefined;
 try{
  const keep=f.store.ingest(f.a).id,drop=f.store.ingest(f.b).id;
  f.store.db.prepare("UPDATE homes SET stage='Interested' WHERE id IN (?,?)").run(keep,drop);
  const plan=createPlan(f.store,{sources:['craigslist'],assessmentMode:'full',phase:'assessment',billingMode:'chatgpt',fullReviewHomeIds:[drop],cachedReviewOnly:true,maxPages:1,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});approvePlan(f.store,plan.id,'APPROVE ONE SCAN');
  await f.store.backupTo(join(f.dir,'apartments.sqlite'));
  await promisify(execFile)(process.execPath,['--import','tsx',fileURLToPath(new URL('../server/worker-cli.ts',import.meta.url)),plan.id,'--data-dir',f.dir],{timeout:20000,windowsHide:true});
  persisted=new Store(join(f.dir,'apartments.sqlite'));
  assert.equal(persisted.resolveHomeId(drop),keep);assert.equal(persisted.get<any>(`reviewDuplicateCheck:${drop}`).version,'review-duplicates-v1');
  const usage=JSON.parse(persisted.db.prepare('SELECT usage FROM plans WHERE id=?').get(plan.id)!.usage as string);
  assert.equal(usage.pages,0);assert.equal(usage.photos,0);assert.equal(usage.aiCalls,0);
 }finally{persisted?.close();await f.close();}
});
