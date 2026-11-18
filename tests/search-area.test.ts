import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {Store} from '../server/db.ts';
import {listingSchema,criteriaSchema} from '../src/domain.ts';
import {deskCategory} from '../src/desk-category.ts';
import {searchRegion,searchAreaExclusion,searchRouteAllowed,type SearchAreaPolicy} from '../server/search-area.ts';
import {discoveryIntakeFailure,readQueue,saveQueue} from '../server/discovery-queue.ts';
import {inventoryRoutes,resetInventoryCycle} from '../server/inventory-discovery.ts';
import {sourceById} from '../server/sources.ts';
import {createPlan,approvePlan,getPlan,Budget} from '../server/plans.ts';
import {runRegularPlan} from '../server/regular-worker.ts';
import {ingestNewCandidate,validationSummary} from '../server/new-listing-validation.ts';

const policy:SearchAreaPolicy={regions:['downtown-vancouver','west-vancouver','north-vancouver'],existingHomeIds:[],configuredAt:'2026-11-18T00:00:00Z'};
const listing=(area='Unknown')=>listingSchema.parse({source:'craigslist',sourceId:area,url:'https://example.test/'+encodeURIComponent(area),title:'Apartment with downtown views',address:'',area,rent:2400,beds:1,laundry:'in-unit',photos:[{id:'one',url:'https://example.test/one.jpg',local:'one.jpg',status:'downloaded'}]});
function setup(){const store=new Store(':memory:');store.set('reviewWorkflow',{mode:'quick-first'});store.set('criteria',criteriaSchema.parse({requireLaundry:false,quickIntake:{minRent:1000,maxRent:3500,minPhotos:0,allowedBeds:[1,2]}}));store.set('searchAreaPolicy',policy);return store;}

test('scoped locations distinguish the downtown peninsula and North Shore municipalities from Vancouver westside and nearby cities',()=>{
 for(const area of ['Downtown','Downtown Vancouver','West End','Coal Harbour','Yaletown','Gastown','West End, Vancouver'])assert.equal(searchRegion({area}),'downtown-vancouver',area);
 for(const area of ['North Vancouver','City of North Vancouver','District of North Vancouver','Lower Lonsdale, North Vancouver'])assert.equal(searchRegion({area}),'north-vancouver',area);
 assert.equal(searchRegion({address:'123 Example Street, West Vancouver, BC'}),'west-vancouver');
 assert.equal(searchRegion({address:'123 Example Street',area:'North Vancouver'}),'north-vancouver');
 for(const area of ['Kitsilano','Fairview','Mount Pleasant','Kerrisdale','Marpole','Oakridge','Burnaby','Downtown New Westminster','Richmond','Port Moody'])assert.equal(searchRegion({area}),'outside',area);
 for(const fields of [{area:'Vancouver'},{area:'Vancouver Westside'},{area:'Unknown',address:'123 Example Street'},{area:'North Vancouver / West Vancouver'}])assert.equal(searchRegion(fields),'unknown');
 assert.equal(searchRegion({area:'Downtown',address:'123 Example Street, Burnaby, BC'}),'outside');
});

test('a future-only policy leaves existing homes and ranks intact but blocks new outside or unconfirmed locations',()=>{
 const store=setup();try{
  store.set('searchAreaPolicy',{...policy,regions:[]});const id=store.ingest(listing('Burnaby')).id,old=store.home(id)!;
  store.set(`preservedQuickRank:${id}`,old.quickRank);const raw=store.db.prepare('SELECT * FROM homes WHERE id=?').get(id);
  store.set('searchAreaPolicy',{...policy,existingHomeIds:[id]});assert.deepEqual(store.home(id),old);assert.deepEqual(store.db.prepare('SELECT * FROM homes WHERE id=?').get(id),raw);
  for(const area of ['Kitsilano','Unknown']){const home=store.home(store.ingest(listing(area)).id)!;assert.equal(deskCategory(home),'Excluded');assert.match(home.deskExclusion!,area==='Unknown'?/not confirmed/:/Outside/);assert.throws(()=>store.update(home.id,home.revision,{stage:'Interested',notes:'',followUp:'',viewing:'',rescued:false}),/selected search areas/);}
  for(const area of ['West End','North Vancouver','West Vancouver'])assert.equal(searchAreaExclusion(store,listing(area),true),undefined);
 }finally{store.close();}
});

test('known outside search cards, saved backlog and new-only candidates are skipped before detail collection',()=>{
 const store=setup();try{
  assert.ok(discoveryIntakeFailure(store,{url:'outside',city:'Burnaby',area:'Downtown'}));assert.equal(discoveryIntakeFailure(store,{url:'unknown'}),null);
  saveQueue(store,'craigslist',{urls:['outside','inside','unknown'],next:null,cards:{outside:{url:'outside',city:'Burnaby'},inside:{url:'inside',city:'North Vancouver'}},offerings:[listing('Richmond'),listing('West End')]});
  const q=readQueue(store,'craigslist');assert.deepEqual(q.urls,['inside','unknown']);assert.deepEqual(q.offerings!.map(l=>l.area),['West End']);
  const p=createPlan(store,{sources:['craigslist'],newListingsOnly:true,maxPages:2,maxListings:2,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0}),budget=new Budget(store,p.id,p.caps);
  assert.equal(ingestNewCandidate(store,budget,'craigslist',listing('Burnaby')),null);assert.equal(store.homes().length,0);assert.equal(validationSummary(budget,'craigslist').skippedAreas,1);
 }finally{store.close();}
});

test('outside inventory routes are dormant, retain their progress, and become available again after expansion',()=>{
 const store=setup(),source=sourceById('zillow');try{
  const outside='https://www.zillow.com/burnaby-bc/rentals/',inside='https://www.zillow.com/north-vancouver-bc/rentals/';
  store.set('inventoryCoverage:zillow',[outside,inside].map(url=>({url,next:url,visited:[],pages:7,recognized:20,status:'partial',detail:'Saved progress'})));
  assert.equal(searchRouteAllowed(store,outside),false);assert.equal(searchRouteAllowed(store,inside),true);assert.ok(!inventoryRoutes(store,source).some(r=>r.url===outside));
  resetInventoryCycle(store,source);const retained=store.get<any[]>('inventoryCoverage:zillow')!.find(r=>r.url===outside);assert.equal(retained.pages,7);assert.equal(retained.detail,'Saved progress');
  store.set('searchAreaPolicy',{...policy,regions:[]});assert.ok(inventoryRoutes(store,source).some(r=>r.url===outside));
 }finally{store.close();}
});

test('after bounded address lookup only in-area listings download photos; outside and unresolved locations never enter the active desk',async()=>{
 const fixture=readFileSync('tests/fixtures/craigslist.html','utf8'),url='https://vancouver.craigslist.org/van/apa/d/example/1234567890.html';
 const bytes=await sharp({create:{width:4,height:4,channels:3,background:'white'}}).jpeg().toBuffer();
 for(const [coordinates,expected] of [[[-123.123,49.287],'allowed'],[[-123.16,49.267],'outside'],[null,'unknown']] as const){
  const store=setup(),dir=mkdtempSync(join(tmpdir(),'search-area-'));let images=0,lookups=0;
  try{
   const p=createPlan(store,{assessmentMode:'quick',sources:['craigslist'],newListingsOnly:true,targetNewListingsPerSource:1,maxPages:3,maxListings:1,maxPhotos:5,maxAiCalls:0,maxReservedUsd:0,maxAddressLookups:1});approvePlan(store,p.id,'APPROVE ONE SCAN');
   await runRegularPlan(store,p.id,dir,undefined,{session:(_s,b)=>({stopped:false,start:async()=>{},close:async()=>{},resource:async()=>'',html:async u=>{b.reserve('pages');return u===url?fixture.replace('100 Example Street','1200 W Georgia St, Vancouver, BC'):`<a href="${url}">Apartment</a>`;},image:async()=>{b.reserve('photos');images++;return bytes;}}),addressLookup:async()=>{lookups++;return new Response(JSON.stringify({features:coordinates?[{geometry:{type:'Point',coordinates},properties:{score:100,matchPrecision:'CIVIC_NUMBER',civicNumber:1200,streetName:'Georgia',streetType:'St',streetDirection:'W',localityName:'Vancouver',provinceCode:'BC',faults:[]}}]:[]}));},review:async()=>{throw Error('Unexpected AI');}});
   assert.equal(lookups,1);assert.equal(images,expected==='allowed'?3:0);assert.equal(getPlan(store,p.id).usage.aiCalls,0);assert.equal(validationSummary(new Budget(store,p.id,p.caps),'craigslist').newListings,expected==='allowed'?1:0);
   const home=store.homes()[0];assert.equal(deskCategory(home),expected==='allowed'?'Unreviewed':'Excluded');
   if(expected!=='allowed')assert.match(home.deskExclusion!,expected==='outside'?/Outside/:/not confirmed/);
  }finally{store.close();}
 }
});
