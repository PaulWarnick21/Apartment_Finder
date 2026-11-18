import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import {Store} from '../server/db.ts';
import {criteriaSchema,listingSchema,type Listing,type Photo} from '../src/domain.ts';
import {createPlan,approvePlan,claimPlan,getPlan} from '../server/plans.ts';
import {assertCanStartScan,releaseScan} from '../server/scan-concurrency.ts';
import {FullReviewService} from '../server/full-review.ts';
import {cachedReviewReady} from '../server/cached-review.ts';
import {runRegularPlan,type ScanDependencies} from '../server/regular-worker.ts';
import {reviewGallery} from '../server/gallery-review.ts';

const usage=(usedPercent=4)=>({ordinaryUsageAllowed:true,accountId:'fixture-account',rateLimits:{primary:{usedPercent,windowDurationMins:10080,resetsAt:2000000000},secondary:null,spendControlReached:false},rateLimitsByLimitId:null});
function setup(){
 const store=new Store(':memory:');store.set('reviewWorkflow',{mode:'quick-first'});store.set('criteria',criteriaSchema.parse({quickIntake:{minRent:1000,maxRent:3500,minPhotos:2,allowedBeds:[1,2]}}));
 store.set('fullReviewPolicy',{accountId:'fixture-account',profileId:'fixture-profile',stopAt:95,maxPages:24,maxPhotos:240,maxAiCalls:120});return store;
}
function apartment(store:Store,name:string,change:Partial<Listing>={}){
 const id=store.ingest(listingSchema.parse({source:'craigslist',sourceId:name,url:`https://vancouver.craigslist.org/van/apa/d/${name}/1234567890.html`,title:'Saved apartment',address:'123 Example Street',unit:name,rent:2400,beds:1,laundry:'in-unit',galleryComplete:true,expectedPhotos:5,photos:Array.from({length:5},(_,n)=>({id:`${name}-${n}`,hash:`hash-${name}-${n}`,url:`https://images.craigslist.org/${name}-${n}.jpg`,local:`${name}-${n}.jpg`,status:'downloaded'})),...change})).id;
 const home=store.home(id)!;store.update(id,home.revision,{stage:'Interested',notes:`Keep ${name}`,followUp:'',viewing:'',rescued:false});return id;
}
function serviceFixture(){
 const store=setup(),active=new Set<string>(),started:string[]=[];let usedPercent=4,admissionBlocked=false,blockedAtSpawn=false;
 const runner={get hasActive(){return active.size>0;},assertCanStart(id:string){if(admissionBlocked)throw Error('A child is still closing');assertCanStartScan(store,id,[...active]);},start(id:string){if(blockedAtSpawn)admissionBlocked=true;this.assertCanStart(id);claimPlan(store,id);active.add(id);started.push(id);}};
 const service=new FullReviewService(store,'.',runner,false,{usage:async()=>usage(usedPercent),connection:async()=>({sharing:true,model:'fixture',active:'fixture-profile'})});
 const finish=(id:string)=>{store.db.prepare("UPDATE plans SET state='complete' WHERE id=?").run(id);releaseScan(store,id);active.delete(id);};
 return {store,service,started,finish,setUsage:(n:number)=>{usedPercent=n;},blockAdmission:(value:boolean)=>{admissionBlocked=value;},blockAtSpawn:(value:boolean)=>{blockedAtSpawn=value;},close:async()=>{await service.close();store.close();}};
}
function quickPlan(store:Store,group=randomUUID()){
 const plan=createPlan(store,{sources:['craigslist'],assessmentMode:'quick',parallelGroup:group,billingMode:'chatgpt',maxPages:2,maxListings:2,maxPhotos:4,maxAiCalls:0,maxAddressLookups:0,maxReservedUsd:0});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);return plan;
}
function cachedPlan(store:Store,id:number,group=randomUUID()){
 const plan=createPlan(store,{sources:['craigslist'],assessmentMode:'full',phase:'assessment',fullReviewHomeIds:[id],cachedReviewOnly:true,parallelGroup:group,billingMode:'chatgpt',maxPages:1,maxListings:1,maxPhotos:0,maxAiCalls:12,maxAddressLookups:0,maxReservedUsd:0});approvePlan(store,plan.id,'APPROVE ONE SCAN');return plan;
}
const findings=(photos:Photo[])=>({photos:photos.map(photo=>({id:photo.id,kind:'interior',scenery:'buildings',quality:2,unitCertain:true,note:'Fixture apartment interior'})),allOutlooksCovered:false,summary:'All supplied photos reviewed',interior:null});
const noSource:ScanDependencies['session']=()=>{throw Error('Cached review must not open a source transport');};
const gate=()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};};

test('the queue starts two cached homes, retains a third, and respects finishing sibling locks',async()=>{
 const f=serviceFixture();try{
  const ids=['one','two','three'].map(name=>apartment(f.store,name));await f.service.tick();
  assert.equal(f.started.length,2);assert.equal(f.store.home(ids[2])!.fullReview!.status,'queued');
  const plans=f.started.map(id=>getPlan(f.store,id));assert.equal(plans[0].caps.parallelGroup,plans[1].caps.parallelGroup);
  for(const plan of plans){assert.equal(plan.caps.cachedReviewOnly,true);assert.equal(plan.caps.maxPhotos,0);assert.equal(plan.caps.maxAddressLookups,0);assert.equal(plan.caps.maxListings,1);assert.equal(plan.caps.maxReservedUsd,0);assert.deepEqual(plan.caps.sources,['craigslist']);}
  // A terminal result still holds its slot until the worker releases membership.
  f.store.db.prepare("UPDATE plans SET state='complete' WHERE id=?").run(plans[0].id);await f.service.tick();assert.equal(f.started.length,2);
  f.finish(plans[0].id);await f.service.tick();assert.equal(f.started.length,3);assert.equal(f.store.home(ids[1])!.fullReview!.status,'running');assert.equal(f.store.home(ids[1])!.notes,'Keep two');
 }finally{await f.close();}
});

test('cached homes join a quick source group while an incomplete gallery waits for exclusive access',async()=>{
 const f=serviceFixture();try{
  const missing=apartment(f.store,'missing',{galleryComplete:false}),ids=['cached-one','cached-two','queued'].map(name=>apartment(f.store,name));const scan=quickPlan(f.store);
  f.store.db.prepare("INSERT INTO source_health(source,paused_until,reason,needs_attention) VALUES ('craigslist',?,'Fixture source pause',1)").run(new Date(Date.now()+60000).toISOString());
  await f.service.tick();assert.equal(f.started.length,2);assert.equal(f.store.home(missing)!.fullReview!.status,'queued');assert.equal(f.store.home(ids[2])!.fullReview!.status,'queued');
  assert.ok(f.started.every(id=>getPlan(f.store,id).caps.parallelGroup===scan.caps.parallelGroup));assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM parallel_scan_members').get()!.n,3);
 }finally{await f.close();}
});

test('configured review concurrency and transient process admission keep authorized work queued',async()=>{
 const f=serviceFixture();try{
  f.store.set('processingPolicy',{reviewConcurrency:1});const ids=['one','two'].map(name=>apartment(f.store,name));f.blockAdmission(true);await f.service.tick();
  assert.equal(f.started.length,0);assert.ok(ids.every(id=>f.store.home(id)!.fullReview!.status==='queued'));
  f.blockAdmission(false);await f.service.tick();assert.equal(f.started.length,1);assert.equal(f.store.home(ids[1])!.fullReview!.status,'queued');
 }finally{await f.close();}
});

test('fresh reserve readings stop each queued review before approval',async()=>{
 const f=serviceFixture();try{const ids=['one','two'].map(name=>apartment(f.store,name));f.setUsage(95);await f.service.tick();assert.equal(f.started.length,0);for(const id of ids){assert.equal(f.store.home(id)!.fullReview!.status,'paused');assert.match(f.store.home(id)!.fullReview!.detail!,/reserve/);}}finally{await f.close();}
});

test('a slot lost between approval and spawn restores the existing queued authorization',async()=>{
 const f=serviceFixture();try{
  const id=apartment(f.store,'spawn-race');f.blockAtSpawn(true);await f.service.tick();assert.equal(f.started.length,0);assert.equal(f.store.home(id)!.fullReview!.status,'queued');
  assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM plans WHERE state IN ('approved','running')").get()!.n,0);
  f.blockAtSpawn(false);f.blockAdmission(false);await f.service.tick();assert.equal(f.started.length,1);assert.equal(f.store.home(id)!.fullReview!.status,'running');
 }finally{await f.close();}
});

test('cached eligibility includes gallery enumeration, expected counts and every accessible saved photo',()=>{
 const store=setup();try{
  const listing=store.home(apartment(store,'eligibility'))!.listing;assert.equal(cachedReviewReady(listing),true);
  for(const change of [{galleryComplete:false},{expectedPhotos:6},{photos:[]},{photos:listing.photos.map(photo=>({...photo,local:undefined}))}])assert.equal(cachedReviewReady({...listing,...change}),false);
  listing.photos[4].local=undefined;assert.equal(cachedReviewReady(listing),false);listing.photos[4].status='unavailable';assert.equal(cachedReviewReady(listing),true);
  listing.photos=listing.photos.map(photo=>({...photo,local:undefined,status:'unavailable'}));assert.equal(cachedReviewReady(listing),false);
 }finally{store.close();}
});

test('two apartments overlap model work, keep each gallery sequential and cover every saved photo',async()=>{
 const store=setup(),hold=gate(),group=randomUUID();let active=0,peak=0;const activeHomes=new Set<number>(),seen=new Map<number,string[]>();
 try{
  const ids=['first','second'].map(name=>apartment(store,name)),plans=ids.map(id=>cachedPlan(store,id,group));
  const deps:ScanDependencies={session:noSource,review:(listing,budget,dir)=>reviewGallery(listing,budget,dir,{maxBatchPhotos:2,review:async(photos,listing)=>{
   const id=listing.homeId!;assert.equal(activeHomes.has(id),false);activeHomes.add(id);active++;peak=Math.max(peak,active);seen.set(id,[...(seen.get(id)??[]),...photos.map(photo=>photo.id)]);
   await hold.promise;active--;activeHomes.delete(id);return findings(photos);
  }})};
  const runs=plans.map(plan=>runRegularPlan(store,plan.id,'.',undefined,deps));await setImmediate();assert.equal(active,2);hold.release();await Promise.all(runs);
  assert.equal(peak,2);for(const id of ids){assert.equal(seen.get(id)!.length,5);assert.equal(new Set(seen.get(id)).size,5);assert.ok(store.home(id)!.listing.photos.every(photo=>photo.status==='reviewed'));assert.equal(store.home(id)!.notes,`Keep ${id===ids[0]?'first':'second'}`);}
  for(const plan of plans){const saved=getPlan(store,plan.id);assert.equal(saved.usage.aiCalls,3);assert.equal(saved.usage.pages,0);assert.equal(saved.usage.photos,0);assert.equal(saved.usage.requests,0);}
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM parallel_scan_members').get()!.n,0);
 }finally{hold.release();store.close();}
});

test('a stale cached gallery fails closed without fetching or silently completing missing photos',async()=>{
 const store=setup();try{
  const id=apartment(store,'stale'),plan=cachedPlan(store,id),listing=store.home(id)!.listing;listing.photos[0].local=undefined;listing.photos[0].status='pending';store.db.prepare('UPDATE homes SET listing=? WHERE id=?').run(JSON.stringify(listing),id);
  await runRegularPlan(store,plan.id,'.',undefined,{session:noSource,review:async()=>{throw Error('No model call permitted');}});
  assert.equal(getPlan(store,plan.id).usage.aiCalls,0);const result=store.get<{complete:boolean;detail:string}>(`fullReviewResult:${plan.id}:${id}`)!;assert.equal(result.complete,false);assert.match(result.detail,/no longer cached/);
 }finally{store.close();}
});

test('listing changes during cached review survive, while model findings remain reusable',async()=>{
 const store=setup();try{
  const id=apartment(store,'changed'),plan=cachedPlan(store,id);
  await runRegularPlan(store,plan.id,'.',undefined,{session:noSource,review:(listing,budget,dir)=>reviewGallery(listing,budget,dir,{review:async photos=>{
   const updated=store.home(id)!.listing;updated.description='New source facts arrived while reviewing';updated.galleryComplete=false;store.db.prepare('UPDATE homes SET listing=? WHERE id=?').run(JSON.stringify(updated),id);return findings(photos);
  }})});
  assert.equal(store.home(id)!.listing.description,'New source facts arrived while reviewing');assert.equal(store.home(id)!.listing.galleryComplete,false);
  assert.equal(store.get<{complete:boolean}>(`fullReviewResult:${plan.id}:${id}`)!.complete,false);assert.equal(store.db.prepare('SELECT count(*) AS n FROM photo_cache').get()!.n,5);assert.equal(store.home(id)!.notes,'Keep changed');
 }finally{store.close();}
});

test('cancelling one overlapping assessment retains its completed batch and lets its sibling finish',async()=>{
 const store=setup(),hold=gate(),group=randomUUID();try{
  const ids=['cancelled','retained'].map(name=>apartment(store,name)),plans=ids.map(id=>cachedPlan(store,id,group)),seen=new Map<number,number>();
  const deps:ScanDependencies={session:noSource,review:(listing,budget,dir)=>reviewGallery(listing,budget,dir,{maxBatchPhotos:2,review:async(photos,listing)=>{seen.set(listing.homeId!,(seen.get(listing.homeId!)??0)+1);await hold.promise;return findings(photos);}})};
  const runs=plans.map(plan=>runRegularPlan(store,plan.id,'.',undefined,deps));await setImmediate();const home=store.home(ids[0])!;
  store.set(`fullReview:${home.id}`,{status:'running',planId:plans[0].id,updatedAt:new Date().toISOString()});store.update(home.id,home.revision,{stage:'Not Interested',notes:'Keep my rejection',followUp:'',viewing:'',rescued:false});hold.release();await Promise.all(runs);
  assert.equal(seen.get(ids[0]),1);assert.equal(seen.get(ids[1]),3);assert.equal(store.home(ids[0])!.stage,'Not Interested');assert.equal(store.home(ids[0])!.notes,'Keep my rejection');assert.equal(store.home(ids[0])!.listing.photos.filter(photo=>photo.status==='reviewed').length,2);assert.equal(store.home(ids[1])!.listing.photos.filter(photo=>photo.status==='reviewed').length,5);assert.equal(store.home(ids[0])!.fullReview!.status,'cancelled');
 }finally{hold.release();store.close();}
});
