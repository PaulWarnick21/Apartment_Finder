import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {listingSchema,type Listing} from '../src/domain.ts';
import {duplicateEvidence,deduplicateHome,rememberDuplicatePosting,refreshDuplicateIndex} from '../server/automatic-duplicates.ts';
import {hasPosting} from '../server/discovery-queue.ts';
import {FullReviewService} from '../server/full-review.ts';
import {Budget,createPlan,approvePlan,claimPlan} from '../server/plans.ts';
import {runSelectedReviews} from '../server/selected-review-worker.ts';
import {sourceById} from '../server/sources.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {storePhoto} from '../server/photo-storage.ts';

const listing=(id:string,patch:Partial<Listing>={})=>listingSchema.parse({source:'craigslist',sourceId:id,url:`https://vancouver.craigslist.org/van/apa/d/${id}.html`,title:'Apartment',address:'123 Example Street, Vancouver',unit:'203',beds:1,sqft:650,rent:2400,offeringKind:'unit',galleryComplete:true,photos:[{id:'p1',url:`https://images.craigslist.org/${id}.jpg`,local:`${id}.jpg`,status:'downloaded'}],...patch});
const photos=(reviewed=true)=>[1,2,3,4,5].map(n=>({id:String(n),url:`https://images.craigslist.org/${n}.jpg`,hash:`same-content-${n}`,local:`${n}.jpg`,kind:reviewed?'interior':'unknown',unitCertain:reviewed,status:reviewed?'reviewed':'downloaded'}));
function pair(store:Store){return [store.ingest(listing('old')).id,store.ingest(listing('new',{address:'123 Example St., Vancouver'})).id];}
function stage(store:Store,id:number,value:'Interested'|'Not Interested',notes=''){const h=store.home(id)!;store.update(id,h.revision,{stage:value,notes,followUp:'',viewing:'',rescued:false});}

test('normalized explicit units match; a building address, conflicting unit, street type or rental facts does not',()=>{
 const a=listing('old');
 assert.ok(duplicateEvidence(a,listing('new',{address:'203 - 123 Example St, Vancouver',unit:''})));
 for(const patch of [{unit:'204'},{unit:''},{address:'123 Example St #204'},{address:'123 Example Avenue, Vancouver'},{beds:2},{sqft:1000},{rent:900},{address:'123 Example St, North Vancouver'}])assert.equal(duplicateEvidence(a,listing('new',patch)),undefined,JSON.stringify(patch));
});
test('unit photos match across changed URLs by content hash; stock galleries, distinct units and repeated slots stay separate',()=>{
 const a=listingSchema.parse({...listing('old',{unit:''}),photos:photos()});
 const b=listingSchema.parse({...listing('new',{unit:'',address:'123 Example St, Vancouver'}),photos:photos(false).map((p,i)=>({...p,url:`https://different.test/${i}.jpg`}))});
 assert.match(duplicateEvidence(a,b)??'',/5 matching/);
 assert.equal(duplicateEvidence({...a,unit:'201'},{...b,unit:'202'}),undefined);
 assert.equal(duplicateEvidence({...a,evidence:{photoProvenance:'Representative model unit'}},b),undefined);
 assert.equal(duplicateEvidence({...a,photos:a.photos.map(p=>({...p,kind:'amenity'}))},b),undefined);
 assert.equal(duplicateEvidence({...a,photos:Array(5).fill(a.photos[0])},{...b,photos:Array(5).fill(b.photos[0])}),undefined);
 assert.equal(duplicateEvidence({...a,photos:b.photos},b),undefined);
 assert.equal(duplicateEvidence({...a,photos:a.photos.map(p=>({...p,note:'Exact-unit provenance is not independently established.'}))},b),undefined);
});
test('automatic merge keeps the older rejection, assessment and notes, cancels the newer queue, and remembers its URL',()=>{
 const store=new Store(':memory:');try{
  store.set('reviewWorkflow',{mode:'quick-first'});const [old,newer]=pair(store);stage(store,old,'Not Interested','Already reviewed');stage(store,newer,'Interested','New note');
  store.set(`fullReview:${old}`,{status:'complete',updatedAt:'2026-11-01',detail:'Existing assessment'});
  const before=store.home(old)!,raw=store.db.prepare('SELECT listing FROM homes WHERE id=?').get(old)!.listing;
  assert.equal(deduplicateHome(store,newer)?.olderId,old);
  const after=store.home(old)!;assert.equal(after.stage,'Not Interested');assert.deepEqual(after.score,before.score);assert.deepEqual(after.fullReview,before.fullReview);assert.match(after.notes,/Already reviewed/);assert.match(after.notes,/New note/);
  assert.equal(store.db.prepare('SELECT listing FROM homes WHERE id=?').get(old)!.listing,raw);
  assert.equal(store.home(newer)!.id,old);assert.equal(store.homes().length,1);assert.equal(store.get<any>(`fullReview:${newer}`).status,'cancelled');
  assert.ok(hasPosting(store,'craigslist',listing('new').url));
  store.ingest(listing('new',{address:'123 Example St., Vancouver',rent:2900}));assert.equal(store.db.prepare('SELECT listing FROM homes WHERE id=?').get(old)!.listing,raw);
  const merge=store.get<any>(`automaticDuplicate:${newer}`);store.splitMerge(merge.mergeId);assert.equal(store.homes().length,2);assert.equal(deduplicateHome(store,newer),undefined);
 }finally{store.close();}
});
test('different-apartment decisions prevent automatic merges, including through older aliases',()=>{
 const store=new Store(':memory:');try{
  const [old,newer]=pair(store),third=store.ingest(listing('third',{address:'203 - 123 Example St, Vancouver',unit:''})).id;
  store.db.prepare('INSERT INTO duplicate_decisions VALUES (?,?,?)').run(old,newer,'different');
  store.mergeHomes(third,newer);assert.equal(deduplicateHome(store,third),undefined);assert.equal(store.homes().length,2);
 }finally{store.close();}
});
test('new cross-post is remembered without touching the older listing or creating another home; index updates only dirty rows',()=>{
 const store=new Store(':memory:');try{
  const old=store.ingest(listing('old')).id;refreshDuplicateIndex(store);assert.equal(store.db.prepare('SELECT count(*) n FROM duplicate_index_dirty').get()!.n,0);
  const before=store.db.prepare('SELECT * FROM homes WHERE id=?').get(old);
  store.set('discoveryQueue:craigslist',{urls:[listing('new').url,listing('other').url],next:null});
  assert.equal(rememberDuplicatePosting(store,listing('new',{address:'123 Example St, Vancouver'})),old);
  assert.deepEqual(store.get<any>('discoveryQueue:craigslist').urls,[listing('other').url]);
  assert.deepEqual(store.db.prepare('SELECT * FROM homes WHERE id=?').get(old),before);assert.ok(hasPosting(store,'craigslist',listing('new').url));assert.equal(store.homes().length,1);
  store.ingest(listing('old',{rent:2450}));assert.equal(store.home(old)!.listing.rent,2450);assert.equal(store.home(old)!.listing.sourceId,'old');
  assert.equal(store.db.prepare('SELECT count(*) n FROM duplicate_index_dirty').get()!.n,1);refreshDuplicateIndex(store);assert.equal(store.db.prepare('SELECT count(*) n FROM duplicate_index_dirty').get()!.n,0);
 }finally{store.close();}
});
test('queue deduplication runs before account checks or launching assessment',async()=>{
 const store=new Store(':memory:'),service=new FullReviewService(store,'.',{hasActive:false,start(){assert.fail('No scan should start');}},false,{usage:async()=>assert.fail('No account request'),connection:async()=>assert.fail('No connection request')});
 try{store.set('reviewWorkflow',{mode:'quick-first'});const [old,newer]=pair(store);stage(store,old,'Not Interested');stage(store,newer,'Interested');await service.tick();assert.equal(store.resolveHomeId(newer),old);assert.equal(store.db.prepare('SELECT count(*) n FROM plans').get()!.n,0);}finally{await service.close();store.close();}
});
test('selected worker skips a saved duplicate before source requests and model calls',async()=>{
 const store=new Store(':memory:');try{
  store.set('reviewWorkflow',{mode:'quick-first'});const [old,newer]=pair(store);stage(store,old,'Not Interested');stage(store,newer,'Interested');
  const plan=createPlan(store,{sources:['craigslist'],assessmentMode:'full',fullReviewHomeIds:[newer],maxPages:1,maxListings:1,maxPhotos:0,maxAiCalls:1,maxReservedUsd:0});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);
  const result=await runSelectedReviews(store,sourceById('craigslist'),new Budget(store,plan.id,plan.caps),'.',undefined,{session(){assert.fail('No source request');},async review(){assert.fail('No AI request');}});
  assert.match(result.detail,/Duplicate assessment skipped/);assert.equal(store.resolveHomeId(newer),old);
 }finally{store.close();}
});

test('newly downloaded matching photo hashes stop full scoring before AI and leave the older gallery intact',async()=>{
 const store=new Store(':memory:'),dir=await mkdtemp(join(tmpdir(),'af-duplicates-'));
 try{
  store.set('reviewWorkflow',{mode:'quick-first'});
  const bytes=await Promise.all([1,2,3,4,5].map(n=>sharp({create:{width:16,height:16,channels:3,background:{r:n*40,g:30,b:80}}}).png().toBuffer()));
  const saved=await Promise.all(bytes.map(value=>storePhoto(value,dir)));
  const old=store.ingest(listingSchema.parse({...listing('old',{unit:''}),photos:saved.map((p,i)=>({...p,id:String(i),url:`https://images.craigslist.org/old-${i}.jpg`,kind:'interior',unitCertain:true,status:'reviewed'}))})).id;
  const newer=store.ingest(listingSchema.parse({...listing('new',{unit:''}),photos:bytes.map((_,i)=>({id:String(i),url:`https://images.craigslist.org/new-${i}.jpg`}))})).id;
  stage(store,old,'Not Interested');
  // Fixtures enter Interested directly so admission's downloaded-photo requirement
  // does not mask the worker's download-time duplicate check.
  store.db.prepare("UPDATE homes SET stage='Interested' WHERE id=?").run(newer);
  const before=store.db.prepare('SELECT listing FROM homes WHERE id=?').get(old)!.listing;
  const plan=createPlan(store,{sources:['craigslist'],assessmentMode:'full',fullReviewHomeIds:[newer],maxPages:1,maxListings:1,maxPhotos:5,maxAiCalls:5,maxReservedUsd:0});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);
  store.set(`fullReview:${newer}`,{status:'running',planId:plan.id,updatedAt:new Date().toISOString()});
  await runSelectedReviews(store,sourceById('craigslist'),new Budget(store,plan.id,plan.caps),dir,undefined,{session:()=>({async start(){},async close(){},async html(){assert.fail('Complete gallery needs no page');},async image(url:string){return bytes[Number(url.match(/new-(\d)/)![1])];}}) as any,async review(){assert.fail('Matching hashes must skip AI');}});
  assert.equal(store.resolveHomeId(newer),old);assert.equal(store.db.prepare('SELECT listing FROM homes WHERE id=?').get(old)!.listing,before);
  assert.equal(store.get<any>(`fullReview:${newer}`).status,'cancelled');
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
