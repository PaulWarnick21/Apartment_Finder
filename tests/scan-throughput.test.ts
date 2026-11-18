import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {Store} from '../server/db.ts';
import {createPlan,approvePlan,claimPlan,Budget,getPlan} from '../server/plans.ts';
import {sourceById} from '../server/sources.ts';
import {sourceGapMs,recordAccessSuccess,waitForSourceAccess} from '../server/source-pacing.ts';
import {fetchSourcePhoto,pauseAccess,pauseTransport,retryAfterUntil} from '../server/source-failures.ts';
import {collectGalleryPhotos} from '../server/gallery-collection.ts';
import {listingSchema} from '../src/domain.ts';
import {ChromeJobs} from '../server/chrome-jobs.ts';
import {areaSearchRoute} from '../server/search-area.ts';
import {runInventorySource} from '../server/inventory-discovery.ts';
import {readQueue} from '../server/discovery-queue.ts';

function setup(extra:Record<string,unknown>={}){
 const store=new Store(':memory:');store.set('browserExtension',{id:'a'.repeat(32),tokenHash:'fixture'});
 const plan=createPlan(store,{assessmentMode:'quick',sources:['rew'],maxPages:20,maxListings:20,maxPhotos:80,maxAiCalls:0,maxReservedUsd:0,...extra});
 approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);return {store,budget:new Budget(store,plan.id,plan.caps)};
}
test('persisted benchmark deadline stops new requests even without its supervisor timer',t=>{
 t.mock.timers.enable({apis:['Date'],now:100000});const {store,budget}=setup({stopAt:new Date(101000).toISOString()});try{
  budget.reserve('pages');t.mock.timers.tick(1000);assert.throws(()=>budget.reserve('pages'),/deadline/);
  assert.equal(getPlan(store,budget.id).usage.pages,1);
 }finally{store.close();}
});
test('adaptive pacing warms up independently, persists across batches, slows on latency and ages out',t=>{
 t.mock.timers.enable({apis:['Date'],now:100000});const {store,budget}=setup();try{
  assert.equal(sourceGapMs(budget,'rew','page'),10000);
  for(let i=0;i<5;i++)recordAccessSuccess(budget,'rew','page',1000);
  assert.equal(sourceGapMs(budget,'rew','page'),7500);assert.equal(sourceGapMs(budget,'zumper','page'),10000);
  for(let i=0;i<5;i++)recordAccessSuccess(budget,'rew','page',1000);
  assert.equal(sourceGapMs(new Budget(store,budget.id,budget.caps),'rew','page'),5000);
  assert.equal(sourceGapMs(new Budget(store,budget.id,{...budget.caps,pacingPolicy:'conservative'}),'rew','page'),10000);
  recordAccessSuccess(budget,'rew','page',16000);assert.equal(sourceGapMs(budget,'rew','page'),20000);
  t.mock.timers.tick(1800001);assert.equal(sourceGapMs(budget,'rew','page'),10000);
 }finally{store.close();}
});
test('overlapping photo slots retain a single paced source clock',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});const {store,budget}=setup();try{
  for(let i=0;i<40;i++)recordAccessSuccess(budget,'rew','image',100);
  await waitForSourceAccess(budget,'rew','image');let admitted=false;
  const waiting=waitForSourceAccess(budget,'rew','image').then(()=>{admitted=true;});
  t.mock.timers.tick(499);await Promise.resolve();assert.equal(admitted,false);
  t.mock.timers.tick(1);await waiting;assert.equal(admitted,true);
 }finally{store.close();}
});
test('photo transport retries once with fresh accounting and does not create a day-long pause',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});const {store,budget}=setup();try{
  let calls=0;const work=fetchSourcePhoto(budget,sourceById('rew'),async()=>{if(++calls===1)throw new DOMException('timeout','TimeoutError');return 'bytes';});
  for(let i=0;i<8;i++)await Promise.resolve();assert.equal(calls,1);
  t.mock.timers.tick(2000);assert.equal(await work,'bytes');assert.equal(calls,2);
  assert.equal(getPlan(store,budget.id).usage.photos,2);assert.equal(getPlan(store,budget.id).usage.requests,2);assert.doesNotThrow(()=>store.checkSource('rew'));
 }finally{store.close();}
});
test('repeated network failure backs off five minutes and cannot erase a challenge',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});const {store,budget}=setup();try{
  const work=fetchSourcePhoto(budget,sourceById('rew'),async()=>{throw new DOMException('timeout','TimeoutError');}),failure=assert.rejects(work,/timeout/);
  for(let i=0;i<8;i++)await Promise.resolve();t.mock.timers.tick(2000);await failure;
  assert.equal(Date.parse(store.health()[0].paused_until!),Date.now()+300000);
  pauseAccess(budget,'rew','Challenge',true);const before=store.health()[0];pauseTransport(budget,'rew','Network issue');assert.deepEqual(store.health()[0],before);
  t.mock.timers.tick(86400001);assert.throws(()=>store.checkSource('rew'),/Challenge/);
 }finally{store.close();}
});
test('rate limits honor a longer Retry-After and are never retried',async()=>{
 const {store,budget}=setup();try{
  let requests=0;const now=Date.now();await assert.rejects(fetchSourcePhoto(budget,sourceById('rew'),async()=>{requests++;pauseAccess(budget,'rew','HTTP 429',false,'172800');throw Error('Source paused');}),/paused/);
  assert.equal(requests,1);assert.ok(Date.parse(store.health()[0].paused_until!)>=now+172800000);
  assert.equal(retryAfterUntil('garbage',now),now);assert.equal(retryAfterUntil('10',now),now+10000);
 }finally{store.close();}
});
test('cancellation during a retry wait prevents the second network attempt',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});const {store,budget}=setup();try{
  let calls=0;const work=fetchSourcePhoto(budget,sourceById('rew'),async()=>{calls++;throw new DOMException('timeout','TimeoutError');}),stopped=assert.rejects(work,/Scan stopped/);
  for(let i=0;i<8;i++)await Promise.resolve();store.db.prepare("UPDATE plans SET state='cancelled' WHERE id=?").run(budget.id);t.mock.timers.tick(2000);await stopped;assert.equal(calls,1);
 }finally{store.close();}
});
test('gallery overlaps two downloads, retains successful siblings on failure, and never silently samples',async()=>{
 const {store,budget}=setup(),dir=mkdtempSync(join(tmpdir(),'af-fast-gallery-'));
 const bytes=await sharp({create:{width:8,height:8,channels:3,background:'white'}}).jpeg().toBuffer();
 try{
  const listing=listingSchema.parse({source:'rew',sourceId:'fixture',url:'https://www.rew.ca/rentals/1/example',title:'Fixture',address:'Example',rent:2400,beds:1,photos:[0,1,2,3].map(i=>({id:String(i),url:`https://assets-listings.rew.ca/${i}.jpg`}))});
  let active=0,max=0,calls=0;let unblock!:()=>void;const barrier=new Promise<void>(resolve=>{unblock=resolve;});
  await collectGalleryPhotos(listing,budget,sourceById('rew'),dir,async()=>{budget.reserve('photos');calls++;active++;max=Math.max(max,active);if(calls===2)unblock();await barrier;active--;return bytes;});
  assert.equal(max,2);assert.equal(calls,4);assert.equal(listing.photos.filter(p=>p.local).length,4);
  for(const p of listing.photos){delete p.local;p.url=p.url.replace('.jpg','-failure.jpg');}
  calls=0;let release!:()=>void;const sibling=new Promise<void>(r=>{release=r;});
  const collection=collectGalleryPhotos(listing,budget,sourceById('rew'),dir,async()=>{if(++calls===1){await sibling;return bytes;}release();throw Error('Source paused');});
  await assert.rejects(collection,/paused/);assert.equal(calls,2);assert.ok(listing.photos[0].local);assert.equal(listing.photos.filter(p=>p.local).length,1);
 }finally{store.close();}
});
test('Chrome long poll wakes immediately, claims once and leaves cancelled jobs unclaimed',async()=>{
 const {store,budget}=setup({sources:['apartments']}),jobs=new ChromeJobs(store);try{
  const waiting=jobs.waitForJob(),done=jobs.request(budget,'https://www.apartments.com/example/abcdefg/','discovery',3500,0),failed=assert.rejects(done,/cleanup/);
  const {job}=await waiting;assert.ok(job);assert.equal(jobs.poll().job,null);jobs.fail('cleanup');await failed;
  const controller=new AbortController(),abort=jobs.waitForJob(20000,controller.signal);controller.abort();assert.equal((await abort).job,null);
  assert.equal(jobs.watching,true);
 }finally{jobs.fail('cleanup');store.close();}
});
test('REW source-advertised /page/2 remains scoped and advances inventory without geocoding',async()=>{
 const {store,budget}=setup({phase:'inventory',maxPhotos:0,maxPages:2});const root='https://www.rew.ca/rentals/areas/west-end-vancouver-bc',next=root+'/page/2';
 try{
  store.set('searchAreaPolicy',{mode:'source-filters',regions:['downtown-vancouver'],existingHomeIds:[],sourceRoutes:{rew:[{url:root,region:'downtown-vancouver'}]}});
  assert.ok(areaSearchRoute(store,'rew',next));
  for(const u of [root+'/page/0',root+'/page/2/else',root.replace('west-end','kitsilano')+'/page/2'])assert.equal(areaSearchRoute(store,'rew',u),undefined);
  const visited:string[]=[];await runInventorySource(store,sourceById('rew'),budget,mkdtempSync(join(tmpdir(),'af-rew-pages-')),undefined,{session:()=>({start:async()=>{},close:async()=>{},stopped:false,image:async()=>{throw Error('No images');},resource:async()=>{throw Error('No resource');},html:async url=>{budget.reserve('pages');visited.push(url);return `<a href="https://www.rew.ca/rentals/${visited.length}/example">Apartment</a>${url===root?`<a rel="next" href="${next}">Next</a>`:''}`;}})});
  assert.deepEqual(visited,[root,next]);assert.equal(readQueue(store,'rew').urls.length,2);assert.equal(store.homes().length,0);
 }finally{store.close();}
});
