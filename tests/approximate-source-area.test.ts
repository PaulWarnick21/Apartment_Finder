import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {Store} from '../server/db.ts';
import {criteriaSchema,listingSchema} from '../src/domain.ts';
import {applySearchArea,areaSearchRoute,searchAreaExclusion,discoveryAreaFailure,intakeSearchUrls,searchRegion,type SearchAreaPolicy} from '../server/search-area.ts';
import {areaMixBucket} from '../server/area-mix.ts';
import {catchupAreaWork} from '../server/area-mix-routing.ts';
import {mergeDiscovery,readQueue} from '../server/discovery-queue.ts';
import {sourceById} from '../server/sources.ts';
import {nextDiscovery} from '../server/source-discovery.ts';
import {createPlan,approvePlan,getPlan} from '../server/plans.ts';
import {runRegularPlan} from '../server/regular-worker.ts';

const search='https://www.craigslist.org/search/area/vancouver?cat=apa';
const url='https://vancouver.craigslist.org/van/apa/d/example/1234567890.html';
const policy:SearchAreaPolicy={regions:['downtown-vancouver'],existingHomeIds:[],configuredAt:'2026-11-19',mode:'source-filters',sourceRoutes:{craigslist:[{url:search,region:'downtown-vancouver',scope:'vancouver-approximate'},{url:'https://www.craigslist.org/search/city/north-vancouver-bc?cat=apa',region:'north-vancouver'}]}};
function setup(){const store=new Store(':memory:');store.set('searchAreaPolicy',policy);return store;}
const make=(area:string,address='')=>listingSchema.parse({source:'craigslist',sourceId:'test',url,title:'Apartment',address,area,rent:2400,beds:1});
const card={searchUrl:search,searchRegion:'downtown-vancouver'};

test('approximate searches admit uncertain and nearby Vancouver homes without inventing a downtown location',()=>{
 const store=setup();try{
  assert.deepEqual(intakeSearchUrls(store,sourceById('craigslist')),[search]);
  assert.equal(areaSearchRoute(store,'craigslist',search+'&city=Surrey'),undefined);
  assert.ok(areaSearchRoute(store,'craigslist',search+'&page=2'));
  for(const area of ['Unknown','Vancouver','Fairview','Kitsilano','Strathcona','Mount Pleasant']){
   const listing=applySearchArea(store,make(area),card);
   assert.equal(searchAreaExclusion(store,listing,true),undefined,area);
   assert.equal(listing.area,area);assert.notEqual(listing.location,'downtown');
   assert.equal(listing.evidence.addressLookupStatus,undefined);
   assert.match(listing.evidence.searchAreaBasis,/not independently verified/);
  }
  for(const area of ['West End','Coal Harbour','Gastown','Yaletown','English Bay','Davie Village'])assert.equal(searchRegion(make(area)),'downtown-vancouver');
 }finally{store.close();}
});

test('fallback provenance never overrides explicit distant, disabled or off-mainland facts',()=>{
 const store=setup();try{
  for(const area of ['North Vancouver','West Vancouver','Burnaby','Richmond','Killarney','Dunbar-Southlands','Bowen Island']){
   const listing=applySearchArea(store,make(area),card);
   assert.ok(searchAreaExclusion(store,listing,true),area);
   assert.ok(discoveryAreaFailure(store,{...card,area}),area);
  }
  assert.ok(searchAreaExclusion(store,applySearchArea(store,make('Kitsilano','123 Example St, Burnaby, BC'),card),true));
  assert.ok(searchAreaExclusion(store,make('Unknown'),true),'Unscoped old queues do not acquire fallback provenance');
 }finally{store.close();}
});

test('broad candidates stay schedulable and scoped precise routes remain strict',()=>{
 const store=setup();try{
  store.set('areaMixPolicy',{downtownShare:1,configuredAt:'2026-11-19',baselineHomeIds:[]});
  const queue=readQueue(store,'craigslist');
  mergeDiscovery(store,'craigslist',queue,[{url,area:'Fairview'}],search);
  assert.deepEqual(readQueue(store,'craigslist').urls,[url]);
  const candidate=readQueue(store,'craigslist').cards![url];
  assert.equal(areaMixBucket(store,'craigslist',candidate),'downtown');
  assert.deepEqual(catchupAreaWork(store,[],['craigslist'],[{source:'craigslist',routes:[],candidates:[candidate]}]).candidates,['craigslist']);
  store.set('searchAreaPolicy',{...policy,sourceRoutes:{craigslist:[{url:search,region:'downtown-vancouver'}]}});
  assert.ok(searchAreaExclusion(store,applySearchArea(store,make('Fairview'),card),true));
 }finally{store.close();}
});

test('a new broad-search apartment reaches the desk with photos and no address or model requests',async()=>{
 const store=setup(),dir=mkdtempSync(join(tmpdir(),'approximate-area-'));
 const bytes=await sharp({create:{width:4,height:4,channels:3,background:'white'}}).jpeg().toBuffer();
 try{
  store.set('reviewWorkflow',{mode:'quick-first'});
  store.set('criteria',criteriaSchema.parse({requireLaundry:false,quickIntake:{minRent:1000,maxRent:3500,minPhotos:0,allowedBeds:[1,2]}}));
  const fixture=readFileSync('tests/fixtures/craigslist.html','utf8');
  const p=createPlan(store,{sources:['craigslist'],assessmentMode:'quick',newListingsOnly:true,targetNewListingsPerSource:1,maxPages:3,maxListings:1,maxPhotos:5,maxAiCalls:0,maxAddressLookups:0,maxReservedUsd:0});
  approvePlan(store,p.id,'APPROVE ONE SCAN');
  await runRegularPlan(store,p.id,dir,undefined,{session:(_source,b)=>({stopped:false,start:async()=>{},close:async()=>{},html:async u=>{b.reserve('pages');assert.ok([url,search].includes(u));return u===url?fixture:`<a href="${url}">Apartment</a>`;},resource:async()=>'',image:async()=>{b.reserve('photos');return bytes;}}),addressLookup:async()=>{throw Error('Unexpected lookup');},review:async()=>{throw Error('Unexpected AI');}});
  const home=store.homes()[0];assert.ok(home);assert.equal(home.deskExclusion,undefined);
  assert.equal(home.listing.evidence.searchAreaScope,'vancouver-approximate');
  assert.ok(home.listing.photos.every(p=>p.local));assert.equal(getPlan(store,p.id).addressLookups,0);assert.equal(getPlan(store,p.id).usage.aiCalls,0);
 }finally{store.close();}
});

test('Kijiji advertised page segments retain the exact category, municipality and filter IDs',()=>{
 const store=setup(),source=sourceById('kijiji'),root=source.search;
 const next='https://www.kijiji.ca/b-apartments-condos/vancouver/apartment__condo/page-2/c37l1700287a29276001';
 try{
  store.set('searchAreaPolicy',{...policy,sourceRoutes:{kijiji:[{url:root,region:'downtown-vancouver',scope:'vancouver-approximate'}]}});
  // This URL structure is copied from the saved November 18 source-check Next link.
  const html=`<a aria-label="Go to next page" href="${next}">Next</a>`;
  assert.equal(nextDiscovery(html,source,root),next);
  assert.ok(areaSearchRoute(store,'kijiji',next));
  for(const bad of [next.replace('page-2','page-0'),next.replace('vancouver/','surrey/'),next.replace('apartment__condo','room'),next.replace('l1700287','l1700286'),next+'/extra'])assert.equal(areaSearchRoute(store,'kijiji',bad),undefined,bad);
 }finally{store.close();}
});
