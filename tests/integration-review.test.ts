import test from 'node:test';
import assert from 'node:assert/strict';
import type {EventEmitter} from 'node:events';
import {Store} from '../server/db.ts';
import {listingSchema} from '../src/domain.ts';
import {patchPreferences,preferencesRevision} from '../server/preferences.ts';
import {PublicConnectionStatus} from '../server/public-connection.ts';
import type {ChatGptState} from '../server/chatgpt.ts';
import {cardSummary} from '../server/desk-state.ts';
import {enrichListingContext} from '../server/listing-context.ts';
import {recurringCosts} from '../src/listing-costs.ts';
import {BuildingResearchService,matchingPermits} from '../server/building-research.ts';
import type {LocationMaps} from '../server/location-map.ts';
import {chromeIpcClient} from '../server/scan-process.ts';
import {createPlan,approvePlan,claimPlan,Budget,getPlan} from '../server/plans.ts';

const listing=(extra:Record<string,unknown>={})=>listingSchema.parse({source:'fixture',sourceId:'review',url:'https://example.test/review',title:'Apartment',address:'100 Example Street, Vancouver',rent:2400,beds:1,description:'Saved listing text',laundry:'in-unit',photos:[{id:'window',url:'https://example.test/window.jpg',local:'window.jpg',status:'reviewed',kind:'interior',unitCertain:true,scenery:'nature',quality:4}],galleryComplete:true,expectedPhotos:1,...extra});
const state=(model:string):ChatGptState=>({connected:true,sharing:true,model,models:[],active:'account',profiles:[],pending:false,message:''});

test('preference patches preserve unrelated learned settings and require the latest revision for each save',()=>{
 const store=new Store(':memory:');try{
  store.set('criteria',{...store.criteria,farFromDowntownCeiling:3.2,preferredMinFloor:8});
  const before=store.criteria,revision=preferencesRevision(before);
  const saved=patchPreferences(store,{revision,changes:{bonuses:{gas:.2}}});assert.equal(store.criteria.farFromDowntownCeiling,3.2);assert.equal(store.criteria.preferredMinFloor,8);assert.equal(store.criteria.bonuses.workspace,before.bonuses.workspace);
  assert.throws(()=>patchPreferences(store,{revision,changes:{maxRent:3300}}),/Preferences changed/);
  const again=patchPreferences(store,{revision:saved.revision,changes:{maxRent:3300}});assert.equal(store.criteria.maxRent,3300);assert.equal(again.revision,preferencesRevision(store.criteria));
  assert.throws(()=>patchPreferences(store,{revision:again.revision,changes:{learnedExamples:[]}}));
 }finally{store.close();}
});

test('invalidating an in-flight public status prevents the next read from returning the old account',async()=>{
 let release!:()=>void;const blocked=new Promise<void>(r=>release=r);let calls=0;
 const cache=new PublicConnectionStatus(async()=>{calls++;if(calls===1){await blocked;return state('old-model');}return state('new-model');});
 const old=cache.get();cache.invalidate();const current=cache.get();release();await old;
 assert.equal((await current).model,'new-model');assert.equal((await cache.get()).model,'new-model');assert.equal(calls,2);
});

test('compact cards retain an available local image without mutating detailed evidence',()=>{
 const store=new Store(':memory:');try{
  const l=listing({photos:[{id:'remote-window',url:'https://example.test/view.jpg',status:'reviewed',kind:'interior',unitCertain:true,scenery:'nature',quality:4},{id:'local-room',url:'https://example.test/room.jpg',local:'room.jpg',status:'reviewed',kind:'interior',scenery:'unknown',note:'Full room evidence'}],research:[{label:'Saved research',note:'Preserve full detail',url:'https://example.test/research',checkedAt:new Date().toISOString()}]});
  const h=store.home(store.ingest(l).id)!,card=cardSummary(h);assert.equal(card.listing.photos[0].local,'room.jpg');assert.equal(card.listing.description,'');assert.equal(card.galleryCount,2);assert.equal(h.listing.photos.length,2);assert.equal(h.listing.photos[1].note,'Full room evidence');assert.equal(h.listing.research.length,1);assert.deepEqual(card.score,h.score);
 }finally{store.close();}
});

test('conflicting required fees stay unresolved and singular/plural utility labels do not double-count',()=>{
 const conflicting=enrichListingContext(listing({description:'Mandatory utilities $100 per month. Mandatory utilities $200 per month. Mandatory utilities $100 per month.'}));
 assert.equal(conflicting.monthlyCharges?.length??0,0);assert.ok(conflicting.conflicts.some(c=>/monthly fee conflicts/.test(c)));
 const duplicate=enrichListingContext(listing({description:'Required utilities $100 per month. Required utility fee $100 per month.'}));assert.equal(duplicate.monthlyCharges?.length,1);assert.equal(recurringCosts(duplicate).knownMonthlyTotal,2500);
});

test('placeholder rent and a false completeness statement cannot become a known complete monthly cost',()=>{
 const costs=recurringCosts(listing({rent:1,parking:'included',internet:'Included',evidence:{rentPlaceholder:'true',monthlyCostsComplete:'false'}}));
 assert.equal(costs.knownMonthlyTotal,null);assert.ok(costs.unknown.includes('Base rent'));assert.equal(costs.complete,false);
});

test('another unit availability date cannot become the advertised apartment date',()=>{
 const other=enrichListingContext(listing({description:'Other units are available January 1. This apartment availability is not confirmed.'}));assert.equal(other.available,'Unknown');
 const specific=enrichListingContext(listing({description:'Other units are available January 1. This apartment is available February 10.'}));assert.equal(specific.available,'February 10');
 const dedicated=enrichListingContext(listing({available:'March 5',description:'Other units are available January 1.'}));assert.equal(dedicated.available,'March 5');
});

test('building research keeps decisions saved during a mocked public-record lookup',async()=>{
 const store=new Store(':memory:');try{
  const id=store.ingest(listing()).id;
  let release!:(r:Response)=>void,started!:()=>void;const began=new Promise<void>(r=>started=r);
  const maps={get:async()=>({status:'ready',label:'100 Example Street',lat:49.2828,lon:-123.1207,approximate:false})} as unknown as LocationMaps;
  const request=(async()=>{started();return await new Promise<Response>(r=>release=r);}) as typeof fetch;
  const service=new BuildingResearchService(store,maps,false,request),pending=service.run(id,'APPROVE TWO PUBLIC RESEARCH REQUESTS');await began;
  const current=store.home(id)!;store.update(id,current.revision,{stage:'Interested',notes:'Keep my new note',viewing:'2026-12-01T12:00',followUp:'2026-11-30',rescued:false});
  release(new Response(JSON.stringify({results:[],total_count:0}),{status:200}));const result=await pending;
  assert.equal(result.status,'complete');assert.equal(result.requestCount,2);assert.equal(store.home(id)!.notes,'Keep my new note');assert.equal(store.home(id)!.stage,'Interested');assert.equal(store.home(id)!.viewing,'2026-12-01T12:00');assert.equal(store.home(id)!.listing.photos[0].local,'window.jpg');
  const verifiedArea=store.home(id)!.listing.area,verifiedSource=store.home(id)!.listing.evidence.locationSource;
  store.ingest(listing({rent:2450}),{preservePhotos:true});assert.equal(store.home(id)!.listing.area,verifiedArea);assert.equal(store.home(id)!.listing.evidence.locationSource,verifiedSource);
  assert.equal((await service.run(id,'APPROVE TWO PUBLIC RESEARCH REQUESTS')).checkedAt,result.checkedAt);
  assert.equal(matchingPermits({results:[{address:'100 Example Street',permitnumber:'one'},{address:'200 Example Street',permitnumber:'two'}]},'100 Example St, Vancouver').rows.length,1);
 }finally{store.close();}
});

test('research completed after a duplicate merge updates the canonical home rather than the hidden alias',async()=>{
 const store=new Store(':memory:');try{
  const keep=store.ingest(listing()).id,duplicate=store.ingest(listing({source:'another',sourceId:'other',url:'https://example.test/other'})).id;assert.notEqual(keep,duplicate);
  let release!:(r:Response)=>void,started!:()=>void;const began=new Promise<void>(r=>started=r);
  const maps={get:async()=>({status:'ready',label:'100 Example Street',lat:49.2828,lon:-123.1207,approximate:false})} as unknown as LocationMaps;
  const service=new BuildingResearchService(store,maps,false,(async()=>{started();return await new Promise<Response>(r=>release=r);}) as typeof fetch),pending=service.run(duplicate,'APPROVE TWO PUBLIC RESEARCH REQUESTS');await began;
  store.mergeHomes(keep,duplicate);release(new Response(JSON.stringify({results:[],total_count:0}),{status:200}));await pending;
  assert.notEqual(store.home(keep)!.listing.area,'Unknown');assert.ok(store.home(keep)!.listing.evidence.locationSource);assert.equal(store.home(duplicate)!.id,keep);
 }finally{store.close();}
});

test('a failed public-record check can recover after its cooldown instead of reusing the failure for a week',async()=>{
 const store=new Store(':memory:');try{
  const id=store.ingest(listing()).id;let requests=0;
  const maps={get:async()=>({status:'ready',label:'100 Example Street',lat:49.2828,lon:-123.1207,approximate:false})} as unknown as LocationMaps;
  const service=new BuildingResearchService(store,maps,false,(async()=>{requests++;return requests===1?new Response('Temporary error',{status:503}):new Response(JSON.stringify({results:[],total_count:0}),{status:200});}) as typeof fetch);
  const failed=await service.run(id,'APPROVE TWO PUBLIC RESEARCH REQUESTS');assert.notEqual(failed.status,'complete');
  const entry=store.db.prepare("SELECT key FROM meta WHERE key LIKE 'buildingResearch:v2:%'").get() as {key:string};store.set(entry.key,{...failed,checkedAt:new Date(Date.now()-25*3600000).toISOString()});store.set('buildingResearchPausedUntil',Date.now()-1);
  const recovered=await service.run(id,'APPROVE TWO PUBLIC RESEARCH REQUESTS');assert.equal(requests,2);assert.equal(recovered.status,'complete');
 }finally{store.close();}
});

test('browser IPC reserves once before dispatch and resolves only its matching response',async()=>{
 const store=new Store(':memory:'),beforeMessage=new Set(process.listeners('message')),beforeDisconnect=new Set(process.listeners('disconnect'));
 const oldSend=process.send,connected=Object.getOwnPropertyDescriptor(process,'connected');let sent:any;
 try{
  Object.defineProperty(process,'connected',{configurable:true,value:true});process.send=((message:any,...args:any[])=>{sent=message;const callback=args.at(-1);if(typeof callback==='function')callback(null);return true;}) as typeof process.send;
  const p=createPlan(store,{sources:['zillow'],billingMode:'chatgpt',maxPages:2,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});approvePlan(store,p.id,'APPROVE ONE SCAN');claimPlan(store,p.id);const budget=new Budget(store,p.id,p.caps),client=chromeIpcClient();
  const pending=client.request(budget,'https://www.zillow.com/vancouver-bc/rentals/','discovery',null,0);assert.equal(sent.type,'chrome-request');assert.equal(getPlan(store,p.id).usage.pages,1);assert.equal(getPlan(store,p.id).usage.requests,1);
  const messages=process as unknown as EventEmitter;
  messages.emit('message',{type:'chrome-result',requestId:'unrelated',snapshot:{url:'wrong'}});messages.emit('message',{type:'chrome-result',requestId:sent.requestId,snapshot:{url:'expected'}});assert.equal((await pending).url,'expected');
  const cancelled=client.request(budget,'https://www.zillow.com/vancouver-bc/rentals/','discovery',null,0);client.fail('Fixture cancellation');await assert.rejects(cancelled,/Fixture cancellation/);assert.equal(getPlan(store,p.id).usage.pages,2);
 }finally{
  for(const listener of process.listeners('message'))if(!beforeMessage.has(listener))process.removeListener('message',listener);for(const listener of process.listeners('disconnect'))if(!beforeDisconnect.has(listener))process.removeListener('disconnect',listener);
  if(connected)Object.defineProperty(process,'connected',connected);else delete (process as any).connected;if(oldSend)process.send=oldSend;else delete process.send;store.close();
 }
});
