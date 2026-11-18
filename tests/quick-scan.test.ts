import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {Store} from '../server/db.ts';
import {criteriaSchema,listingSchema} from '../src/domain.ts';
import {createPlan,approvePlan,getPlan} from '../server/plans.ts';
import {runRegularPlan,pendingCollectionHomes,type ScanDependencies} from '../server/regular-worker.ts';
import {saveQueue,readQueue,discoveryIntakeFailure} from '../server/discovery-queue.ts';
import {deskCategory} from '../src/desk-category.ts';
import {selectedReviewComplete} from '../server/selected-review-worker.ts';

const url='https://vancouver.craigslist.org/van/apa/d/example/1234567890.html';
const fixture=readFileSync('tests/fixtures/craigslist.html','utf8');
const caps={assessmentMode:'quick',billingMode:'chatgpt',sources:['craigslist'],maxPages:3,maxListings:1,maxAddressLookups:0,maxPhotos:10,maxAiCalls:0,maxReservedUsd:0};
function setup(){const store=new Store(':memory:');store.set('reviewWorkflow',{mode:'quick-first'});store.set('criteria',criteriaSchema.parse({requireNiceViewForDesk:true,requireLaundry:true,quickIntake:{minRent:1000,maxRent:3500,minPhotos:2,allowedBeds:[1,2]}}));return store;}
async function run(store:Store,dir:string,input:unknown,deps:ScanDependencies){const plan=createPlan(store,input);approvePlan(store,plan.id,'APPROVE ONE SCAN');await runRegularPlan(store,plan.id,dir,undefined,deps);return getPlan(store,plan.id);}

test('quick intake downloads every gallery photo without AI and retains uncertain view on Unreviewed',async()=>{
 const store=setup(),dir=mkdtempSync(join(tmpdir(),'quick-intake-')),bytes=await sharp({create:{width:4,height:4,channels:3,background:'white'}}).jpeg().toBuffer();let downloads=0,reviews=0;
 const deps:ScanDependencies={session:(_s,b)=>({stopped:false,start:async()=>{},close:async()=>{},html:async u=>{b.reserve('pages');return u===url?fixture:`<a href="${url}">Apartment</a>`;},resource:async()=>'',image:async()=>{b.reserve('photos');downloads++;return bytes;}}),review:async()=>{reviews++;throw Error('Quick intake must not call a model');}};
 try{
  const p=await run(store,dir,caps,deps),home=store.homes()[0];
  assert.equal(downloads,3);assert.equal(reviews,0);assert.equal(p.usage.aiCalls,0);assert.equal(home.listing.photos.filter(photo=>photo.local).length,3);
  assert.equal(home.reviewMode,'quick');assert.equal(deskCategory(home),'Unreviewed');assert.ok(home.score.value<3);assert.equal(home.quickRank!.eligible,true);
  assert.deepEqual(pendingCollectionHomes(store,'craigslist'),[]);
  await run(store,dir,{...caps,phase:'assessment'},deps);assert.equal(downloads,3);assert.equal(reviews,0);
 }finally{store.close();}
});

test('known studio and under-range rent stop before photos; the upper intake boundary is inclusive',async()=>{
 for(const [html,downloadsExpected] of [[fixture.replace('1BR / 1BA','0BR / 1BA').replace('1BR apartment','Studio apartment'),0],[fixture.replace('$2,400','$999'),0],[fixture.replace('$2,400','$3,500'),3]] as const){
  const store=setup(),dir=mkdtempSync(join(tmpdir(),'quick-hard-')),bytes=await sharp({create:{width:4,height:4,channels:3,background:'white'}}).jpeg().toBuffer();let downloads=0;
  try{await run(store,dir,caps,{session:(_s,b)=>({stopped:false,start:async()=>{},close:async()=>{},html:async u=>{b.reserve('pages');return u===url?html:`<a href="${url}">Apartment</a>`;},resource:async()=>'',image:async()=>{b.reserve('photos');downloads++;return bytes;}}),review:async()=>{throw Error('Unexpected AI');}});assert.equal(downloads,downloadsExpected);}finally{store.close();}
 }
});

test('future quick intake resolves the address before presenting a rank, using one bounded lookup and no AI',async()=>{
 const store=setup(),dir=mkdtempSync(join(tmpdir(),'quick-address-intake-'));let lookups=0;
 const html=fixture.replace('100 Example Street','1200 W Georgia St, Vancouver, BC');
 try{
  const plan=await run(store,dir,{...caps,maxPhotos:0,maxAddressLookups:1},{
   session:(_s,b)=>({stopped:false,start:async()=>{},close:async()=>{},html:async u=>{b.reserve('pages');return u===url?html:`<a href="${url}">Apartment</a>`;},resource:async()=>'',image:async()=>{throw Error('No image allowance');}}),
   addressLookup:async()=>{lookups++;return new Response(JSON.stringify({features:[{geometry:{type:'Point',coordinates:[-123.123,49.287]},properties:{score:100,matchPrecision:'CIVIC_NUMBER',civicNumber:1200,streetName:'Georgia',streetType:'St',streetDirection:'W',localityName:'Vancouver',provinceCode:'BC',faults:[]}}]}));},
   review:async()=>{throw Error('No AI in quick intake');}
  });
  const home=store.homes()[0];assert.equal(lookups,1);assert.equal(plan.addressLookups,1);assert.equal(plan.usage.aiCalls,0);
  assert.equal(home.listing.evidence.addressLookupStatus,'verified');assert.equal(home.listing.downtownDistance,'downtown');assert.notEqual(home.listing.area,'Unknown');assert.notEqual(home.quickRank!.grade,'S');
 }finally{store.close();}
});

test('Interested full assessment reviews only the selected saved apartment without discovering or changing decisions',async()=>{
 const store=setup(),dir=mkdtempSync(join(tmpdir(),'selected-review-'));let reviews=0;
 try{
  const listing=listingSchema.parse({source:'craigslist',sourceId:'saved',url,title:'Saved home',address:'123 Example Street',unit:'101',rent:2400,beds:1,laundry:'in-unit',galleryComplete:true,expectedPhotos:2,photos:[1,2].map(n=>({id:`p${n}`,url:`https://images.craigslist.org/${n}.jpg`,local:`cached${n}.jpg`,status:'downloaded'}))});
  const id=store.ingest(listing).id,home=store.home(id)!;store.update(id,home.revision,{stage:'Interested',notes:'Keep this decision',followUp:'',viewing:'',rescued:false});
  const other=store.ingest({...listing,sourceId:'other',url:url.replace('1234567890','9876543210'),unit:'202'}).id;
  const queue={urls:['https://vancouver.craigslist.org/van/apa/d/queued/5555555555.html'],next:null};saveQueue(store,'craigslist',queue);
  const plan=await run(store,dir,{...caps,assessmentMode:'full',fullReviewHomeIds:[id],maxAiCalls:2},{session:()=>{throw Error('Cached selected reviews must not open a browser');},review:async(l,b)=>{b.reserveAi();reviews++;for(const photo of l.photos){photo.status='reviewed';photo.kind='interior';photo.unitCertain=true;photo.scenery='buildings';}}});
  assert.equal(reviews,1);assert.equal(plan.usage.pages,0);assert.equal(plan.usage.aiCalls,1);assert.equal(plan.usage.listings,1);assert.deepEqual(readQueue(store,'craigslist'),queue);
  assert.equal(store.home(id)!.stage,'Interested');assert.equal(store.home(id)!.notes,'Keep this decision');assert.equal(deskCategory(store.home(id)!),'Scoring in Progress');
  assert.ok(store.home(other)!.listing.photos.every(p=>p.status==='downloaded'));
  assert.equal(store.get<{complete:boolean}>(`fullReviewResult:${plan.id}:${id}`)!.complete,true);
 }finally{store.close();}
});

test('full review retains missing-image work and resumes only the missing photos',async()=>{
 const store=setup(),dir=mkdtempSync(join(tmpdir(),'selected-resume-')),bytes=await sharp({create:{width:4,height:4,channels:3,background:'white'}}).jpeg().toBuffer();let downloads=0;
 try{
  const id=store.ingest(listingSchema.parse({source:'craigslist',sourceId:'resume',url,title:'Saved home',address:'123 Example Street',unit:'201',rent:2400,beds:1,laundry:'in-unit',galleryComplete:true,expectedPhotos:3,photos:[0,1,2].map(n=>({id:`p${n}`,url:`https://images.craigslist.org/${n}.jpg`,...(n===0?{local:'saved.jpg',status:'downloaded'}:{})}))})).id;
  const home=store.home(id)!;store.update(id,home.revision,{stage:'Interested',notes:'Saved',followUp:'',viewing:'',rescued:false});
  const deps:ScanDependencies={session:(_s,b)=>({stopped:false,start:async()=>{},close:async()=>{},html:async()=>{throw Error('No discovery or page refresh required');},resource:async()=>'',image:async()=>{b.reserve('photos');downloads++;return bytes;}}),review:async(l,b)=>{b.reserveAi();for(const p of l.photos.filter(p=>p.local)){p.status='reviewed';p.kind='interior';}}};
  const first=await run(store,dir,{...caps,assessmentMode:'full',fullReviewHomeIds:[id],maxPhotos:1,maxAiCalls:1},deps);
  assert.equal(store.get<{complete:boolean}>(`fullReviewResult:${first.id}:${id}`)!.complete,false);assert.equal(downloads,1);
  const second=await run(store,dir,{...caps,assessmentMode:'full',fullReviewHomeIds:[id],maxPhotos:1,maxAiCalls:1},deps);
  assert.equal(downloads,2);assert.equal(store.get<{complete:boolean}>(`fullReviewResult:${second.id}:${id}`)!.complete,true);assert.equal(store.home(id)!.notes,'Saved');
 }finally{store.close();}
});

test('permanently inaccessible photos remain explicit terminal gaps, pending photos remain incomplete',()=>{
 const listing=listingSchema.parse({source:'craigslist',sourceId:'gap',url,title:'Home',address:'',rent:2000,beds:1,galleryComplete:true,expectedPhotos:2,photos:[{id:'a',url:'https://images.craigslist.org/a.jpg',status:'reviewed'},{id:'b',url:'https://images.craigslist.org/b.jpg',status:'unavailable'}]});
 assert.equal(selectedReviewComplete(listing),true);listing.photos[1].status='pending';assert.equal(selectedReviewComplete(listing),false);
});

test('quick discovery rejects known factual mismatches before detail visits and preserves unknowns and inclusive prices',()=>{
 const store=setup();try{
  for(const rent of [999,3501])assert.match(discoveryIntakeFailure(store,{url,rent})!,/rent/i);
  for(const beds of [0,3,4])assert.match(discoveryIntakeFailure(store,{url,beds})!,/bedroom/i);
  for(const rent of [1000,3500])assert.equal(discoveryIntakeFailure(store,{url,rent,beds:1}),null);
  assert.equal(discoveryIntakeFailure(store,{url,rent:null,beds:null}),null);
 }finally{store.close();}
});

test('multi-source quick plans prioritize supported interest while reserving other sources and periodic exploration',async()=>{
 const store=setup(),dir=mkdtempSync(join(tmpdir(),'quick-allocation-'));try{
  const id=store.ingest(listingSchema.parse({source:'facebook',sourceId:'favorite',url:'https://www.facebook.com/marketplace/item/123456/',title:'Home',address:'',rent:2400,beds:1,laundry:'in-unit',photos:[{id:'saved',url:'https://example.test/saved.jpg',local:'saved.jpg',status:'downloaded'}],})).id;
  const home=store.home(id)!;store.update(id,home.revision,{stage:'Interested',notes:'',followUp:'',viewing:'',rescued:false});
  const starts:Array<{source:string;pages:number;listings:number}>=[];
  const deps:ScanDependencies={session:(s,b)=>({stopped:false,start:async()=>{starts.push({source:s.id,pages:b.remaining('pages'),listings:b.remaining('listings')});},close:async()=>{},html:async()=>{b.reserve('pages');return '<html>Unrecognized fixture inventory</html>';},image:async()=>{throw Error('No gallery');},resource:async()=>''})};
  for(let i=0;i<4;i++)await run(store,dir,{...caps,sources:['craigslist','facebook'],maxPages:8,maxListings:8},deps);
  assert.deepEqual(starts.filter((_,i)=>i%2===0).map(s=>s.source),['facebook','facebook','facebook','craigslist']);
  assert.equal(starts[0].pages,6);assert.equal(starts[0].listings,6);assert.equal(starts.filter(s=>s.source==='craigslist').length,4);assert.equal(starts.filter(s=>s.source==='facebook').length,4);
  assert.equal(store.get<{selectionCount:number}>('sourceAllocation')!.selectionCount,4);
 }finally{store.close();}
});
