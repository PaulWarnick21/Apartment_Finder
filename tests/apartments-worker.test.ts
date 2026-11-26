import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {createPlan,approvePlan,getPlan} from '../server/plans.ts';
import {extractApartments} from '../server/apartments-extraction.ts';
import {runApartmentsPlan} from '../server/apartments-worker.ts';
import type {ChromeJobs} from '../server/chrome-jobs.ts';
import {readQueue,isQuarantined} from '../server/discovery-queue.ts';
import type {Budget} from '../server/plans.ts';

test('a mismatched apartment page is quarantined without stalling later candidates',async()=>{
 const db=new Store(':memory:'),dir=mkdtempSync(join(tmpdir(),'af-redirect-'));
 const wrong='https://www.apartments.com/old-listing/abcdefg/',good='https://www.apartments.com/current-listing/ghijklm/';
 try{
  db.set('browserExtension',{id:'a'.repeat(32)});db.set('discoveryQueue:apartments',{urls:[wrong,good],next:null});
  const plan=createPlan(db,{sources:['apartments'],phase:'assessment',assessmentMode:'quick',newListingsOnly:true,billingMode:'chatgpt',maxPages:3,maxListings:2,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0,maxAddressLookups:0});approvePlan(db,plan.id,'APPROVE ONE SCAN');
  const visited:string[]=[];
  const jobs={request:async(b:Budget,url:string)=>{b.reserve('pages');visited.push(url);if(url===wrong)throw Error('Chrome returned a different page; listing identity unverified');return {url,title:'Example Unit 2',text:'',html:'<header id="profileHeaderWrapper">$2500 Total Monthly Price Bedrooms 1 Bathrooms 1</header><section id="descriptionSection"><p>One apartment available.</p></section>',images:[],advertisedPhotos:0,warning:null,truncated:false,galleryComplete:true,links:[]};},fail:()=>{}} as unknown as ChromeJobs;
  await runApartmentsPlan(db,plan.id,dir,jobs);
  assert.deepEqual(visited,[wrong,good]);assert.equal(isQuarantined(db,'apartments',wrong),true);assert.ok(!readQueue(db,'apartments').urls.includes(wrong));assert.doesNotThrow(()=>db.checkSource('apartments'));
  assert.equal(getPlan(db,plan.id).usage.aiCalls,0);
 }finally{db.close();}
});

test('incomplete Chrome gallery preserves cached work and defers AI without billing',async()=>{
 const db=new Store(':memory:'),dir=mkdtempSync(join(tmpdir(),'af-gallery-'));
 const url='https://www.apartments.com/example/abcdefg/';
 const page={url,title:'Example Unit 2',text:'',html:'<header id="profileHeaderWrapper">$2500 Total Monthly Price Bedrooms 1 Bathrooms 1</header><section id="descriptionSection"><p>One apartment available.</p></section>',images:[{url:'https://images1.apartments.com/i2/photo-key/112/photo.jpg'}],advertisedPhotos:2,warning:null,truncated:false,galleryComplete:false,links:[]};
 try{
  db.set('browserExtension',{id:'a'.repeat(32)});
  const l=extractApartments(page);Object.assign(l.photos[0],{local:'cached.jpg',status:'reviewed',kind:'interior'});
  const saved=db.ingest(l),home=db.home(saved.id)!;db.update(saved.id,home.revision,{stage:'Interested',notes:'Keep my note',followUp:'',viewing:'',rescued:false});
  db.set(`pendingGallery:${saved.id}`,{source:'apartments',homeId:saved.id});
  const plan=createPlan(db,{sources:['apartments'],billingMode:'chatgpt',maxPages:2,maxListings:1,maxPhotos:2,maxAiCalls:1,maxReservedUsd:0});approvePlan(db,plan.id,'APPROVE ONE SCAN');
  const jobs={request:async(_budget:unknown,_url:string,kind:string)=>kind==='discovery'?{...page,links:[url]}:page,fail:()=>{}} as unknown as ChromeJobs;
  await runApartmentsPlan(db,plan.id,dir,jobs);
  const result=getPlan(db,plan.id);assert.equal(result.state,'partial');assert.equal(result.usage.aiCalls,0);assert.equal(result.usage.photos,0);
  assert.equal(db.home(saved.id)!.notes,'Keep my note');assert.equal(db.home(saved.id)!.stage,'Interested');assert.equal(db.home(saved.id)!.listing.photos[0].local,'cached.jpg');
 }finally{db.close();}
});
