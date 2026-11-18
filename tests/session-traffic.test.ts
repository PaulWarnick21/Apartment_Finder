import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {createPlan,approvePlan,claimPlan,getPlan,Budget} from '../server/plans.ts';
import {SourceBudget} from '../server/source-budget.ts';
import {recordSourceAccess,requestLimit} from '../server/traffic-policy.ts';
import {sourceById} from '../server/sources.ts';
import {listingSchema} from '../src/domain.ts';
import {ingestNewCandidate,validationTargetReached,validationSummary} from '../server/new-listing-validation.ts';
import {conditionCorrections,feedbackFacts} from '../server/feedback-learning.ts';
import {chromium} from 'playwright';
import {SourceSession} from '../server/transport.ts';
import {runRegularPlan} from '../server/regular-worker.ts';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('approved session can pass old page, image and request quotas, while its totals remain enforced',()=>{
 const store=new Store(':memory:');try{
  const p=createPlan(store,{sources:['vada','craigslist'],trafficPolicy:'session',maxPages:160,maxListings:120,maxListingsPerSource:60,maxPhotos:2000,maxAiCalls:0,maxReservedUsd:0});
  approvePlan(store,p.id,'APPROVE ONE SCAN');claimPlan(store,p.id);const budget=new SourceBudget(new Budget(store,p.id,p.caps),2),source=sourceById('vada');
  for(let i=0;i<101;i++)store.db.prepare('INSERT INTO requests(source,at,kind) VALUES (?,?,?)').run('vada',new Date().toISOString(),i<16?'page':'image');
  assert.equal(budget.remaining('pages'),80);for(let i=0;i<20;i++){budget.reserve('pages');recordSourceAccess(budget,source,'page');}
  for(let i=0;i<120;i++){budget.reserve('photos');recordSourceAccess(budget,source,'image');}
  budget.reserve('requests',501);assert.equal(getPlan(store,p.id).usage.requests,501);
  assert.throws(()=>budget.reserve('pages',61),/Per-source/);assert.throws(()=>budget.reserve('requests',requestLimit(p.caps)),/Per-source/);
  store.pause('vada','Real access challenge',true);assert.throws(()=>store.checkSource('vada'),/paused/);
 }finally{store.close();}
});

test('saved trial approvals still enforce rolling daily traffic quotas',()=>{
 const store=new Store(':memory:');try{
  const p=createPlan(store,{sources:['vada'],trafficPolicy:'trial',maxPages:5,maxListings:3,maxPhotos:120,maxAiCalls:0,maxReservedUsd:0});
  const budget=new Budget(store,p.id,p.caps);for(let i=0;i<100;i++)recordSourceAccess(budget,sourceById('vada'),'image');
  assert.throws(()=>recordSourceAccess(budget,sourceById('vada'),'image'),/Daily image/);
 }finally{store.close();}
});

test('ordinary browser subresources are observed without consuming the scanner request allowance',async t=>{
 const store=new Store(':memory:');try{
  const p=createPlan(store,{sources:['vada'],maxPages:30,maxListings:25,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});approvePlan(store,p.id,'APPROVE ONE SCAN');claimPlan(store,p.id);
  let handler:(route:any)=>Promise<void>=async()=>{},continued=0;
  t.mock.method(chromium,'launchPersistentContext',async()=>({route:async(_pattern:string,fn:typeof handler)=>{handler=fn;},pages:()=>[{on:()=>{}}],close:async()=>{}}));
  const session=new SourceSession(sourceById('vada'),new Budget(store,p.id,p.caps),'.');await session.start();
  for(let i=0;i<600;i++)await handler({request:()=>({url:()=>`https://vadapm.com/script-${i}.js`,resourceType:()=> 'script'}),continue:async()=>{continued++;},abort:async()=>{throw Error('Normal subresource was aborted');}});
  await session.close();assert.equal(continued,600);assert.equal(getPlan(store,p.id).usage.requests,0);assert.equal(store.get(`browserRequests:${p.id}:vada`),600);
 }finally{store.close();}
});

test('unit-only targets do not count or ingest floor-plan offers',()=>{
 const store=new Store(':memory:');try{
  const p=createPlan(store,{sources:['zumper'],maxPages:30,maxListings:40,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0,newListingsOnly:true,unitListingsOnly:true,targetNewListingsPerSource:20}),budget=new Budget(store,p.id,p.caps);
  const l=listingSchema.parse({source:'zumper',sourceId:'floor-1',url:'https://www.zumper.com/apartment-buildings/p1/example',title:'Plan',address:'Example',offeringKind:'floorplan',rent:2400,beds:1});
  assert.equal(ingestNewCandidate(store,budget,'zumper',l),null);assert.equal(validationSummary(budget,'zumper').skippedFloorplans,1);assert.equal(validationTargetReached(budget,'zumper'),false);assert.equal(store.homes().length,0);
 }finally{store.close();}
});

test('an explicit user studio correction affects scoring facts without treating uncertainty as confirmation',()=>{
 const reason='Based on the floor plan, this is actually a studio instead of a 1 bedroom.';
 assert.deepEqual(conditionCorrections(reason),{beds:0});assert.deepEqual(conditionCorrections('This might be a studio instead of a 1 bedroom.'),{});
 const l=listingSchema.parse({source:'fixture',sourceId:'1',url:'https://example.test/1',title:'One bedroom',address:'Example',rent:2400,beds:1});
 assert.equal(feedbackFacts(l,reason,25).beds,0);assert.equal(l.beds,1);
});

test('a continuation resumes only named homes and a zero intake target cannot add more apartments',async()=>{
 const store=new Store(':memory:');try{
  const listing=(id:string)=>listingSchema.parse({source:'vada',sourceId:id,url:`https://vadapm.com/one-bedroom-rental-${id}`,title:id,address:id,rent:2400,beds:1,galleryComplete:true,expectedPhotos:1,photos:[{id:'p1',url:'https://vadapm.com/photo.jpg',local:'saved.jpg',status:'downloaded'}]});
  const old=store.ingest(listing('old')).id,recent=store.ingest(listing('new')).id;for(const id of [old,recent])store.set(`pendingGallery:${id}`,{source:'vada',homeId:id});
  const before=store.db.prepare('SELECT * FROM homes WHERE id=?').get(old),reviewed:number[]=[];
  const p=createPlan(store,{sources:['vada'],maxPages:2,maxListings:2,maxPhotos:0,maxAiCalls:1,maxReservedUsd:0,billingMode:'chatgpt',newListingsOnly:true,unitListingsOnly:true,targetNewListingsPerSource:20,targetNewListingsBySource:{vada:0},resumeHomeIds:[recent]});approvePlan(store,p.id,'APPROVE ONE SCAN');
  await runRegularPlan(store,p.id,mkdtempSync(join(tmpdir(),'af-continuation-')),undefined,{session:()=>({stopped:false,start:async()=>{},html:async()=>'<a href="https://vadapm.com/one-bedroom-rental-unseen">Another apartment</a>',resource:async()=>{throw Error('No source resource expected');},image:async()=>{throw Error('No media retrieval expected');},close:async()=>{}}),review:async(l,b)=>{b.reserveAi();reviewed.push(l.homeId!);for(const photo of l.photos)photo.status='reviewed';}});
  assert.deepEqual(reviewed,[recent]);assert.equal(store.homes().length,2);assert.deepEqual(store.db.prepare('SELECT * FROM homes WHERE id=?').get(old),before);assert.equal(getPlan(store,p.id).sources[0].newListings,0);
  assert.ok(store.get(`galleryResumeAttempt:${p.id}:${recent}`));assert.equal(store.get(`galleryResumeAttempt:${p.id}:${old}`),undefined);
 }finally{store.close();}
});
