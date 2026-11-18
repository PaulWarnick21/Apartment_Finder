import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {Store} from '../server/db.ts';
import {criteriaSchema,listingSchema} from '../src/domain.ts';
import {areaSearchRoute,searchAreaExclusion,applySearchArea,type SearchAreaPolicy} from '../server/search-area.ts';
import {mergeDiscovery,readQueue,saveQueue} from '../server/discovery-queue.ts';
import {createPlan,approvePlan,getPlan} from '../server/plans.ts';
import {runRegularPlan} from '../server/regular-worker.ts';
import {inventoryRoutes} from '../server/inventory-discovery.ts';
import {sourceById} from '../server/sources.ts';
const search='https://www.craigslist.org/search/city/north-vancouver-bc?cat=apa';
const url='https://vancouver.craigslist.org/van/apa/d/example/1234567890.html';
const policy:SearchAreaPolicy={regions:['north-vancouver'],mode:'source-filters',existingHomeIds:[],configuredAt:'2026-11-18',sourceRoutes:{craigslist:[{url:search,region:'north-vancouver'}]}};
function setup(){const s=new Store(':memory:');s.set('reviewWorkflow',{mode:'quick-first'});s.set('criteria',criteriaSchema.parse({requireLaundry:false,quickIntake:{minRent:1000,maxRent:3500,minPhotos:0,allowedBeds:[1,2]}}));s.set('searchAreaPolicy',policy);return s;}
test('website scope accepts pagination, rejects broad searches, and keeps old unscoped backlog out',()=>{
 const s=setup();try{
  assert.ok(areaSearchRoute(s,'craigslist',search+'&page=2'));assert.equal(areaSearchRoute(s,'craigslist',search.replace('cat=apa','cat=roo')),undefined);
  assert.equal(areaSearchRoute(s,'craigslist','https://www.craigslist.org/search/area/vancouver?cat=apa'),undefined);
  saveQueue(s,'craigslist',{urls:[url],next:null,cards:{[url]:{url,city:'North Vancouver'}}});assert.equal(readQueue(s,'craigslist').urls.length,0);
  const q=readQueue(s,'craigslist');assert.throws(()=>mergeDiscovery(s,'craigslist',q,[{url}]),/filtered/);
  mergeDiscovery(s,'craigslist',q,[{url}],search);assert.deepEqual(readQueue(s,'craigslist').urls,[url]);
  assert.deepEqual(inventoryRoutes(s,sourceById('craigslist')).map(r=>r.url),[search]);
 }finally{s.close();}
});
test('source provenance can establish search area without claiming a verified address; known outside facts override it',()=>{
 const s=setup();try{
  const make=(area:string)=>listingSchema.parse({source:'craigslist',sourceId:'x',url,title:'Apartment',address:'',area,rent:2400,beds:1});
  const inside=applySearchArea(s,make('Unknown'),{searchUrl:search,searchRegion:'north-vancouver'});
  assert.equal(searchAreaExclusion(s,inside,true),undefined);assert.equal(inside.area,'North Vancouver');assert.equal(inside.evidence.addressLookupStatus,undefined);
  const outside=applySearchArea(s,make('Burnaby'),{searchUrl:search,searchRegion:'north-vancouver'});assert.match(searchAreaExclusion(s,outside,true)!,/Outside/);
  assert.match(searchAreaExclusion(s,make('Unknown'),true)!,/filter/);
 }finally{s.close();}
});
test('Zillow advertised numbered pagination retains only its exact configured geographic scope',()=>{
 const s=setup(),root='https://www.zillow.com/downtown-vancouver-bc/apartments/';
 try{
  s.set('searchAreaPolicy',{...policy,regions:['downtown-vancouver'],sourceRoutes:{zillow:[{url:root,region:'downtown-vancouver'}]}});
  // Exact next URLs retained in the November 18 live captures.
  for(const url of [root,root+'2_p/',root+'3_p/'])assert.equal(areaSearchRoute(s,'zillow',url)?.region,'downtown-vancouver');
  for(const url of [root+'other/',root+'2_p/extra/',root+'0_p/',root.replace('downtown-vancouver','vancouver')+'2_p/',root.replace('downtown-vancouver','north-vancouver')+'2_p/',root+'2_p/?searchQueryState='+encodeURIComponent(JSON.stringify({regionSelection:[{regionId:1}]})),root+'2_p/?city=Burnaby'])assert.equal(areaSearchRoute(s,'zillow',url),undefined,url);
  const scoped='https://www.zillow.com/homedetails/Example/12345_zpid/';
  const q=readQueue(s,'zillow');mergeDiscovery(s,'zillow',q,[{url:scoped}],root+'2_p/');
  assert.equal(readQueue(s,'zillow').cards?.[scoped]?.searchUrl,root+'2_p/');
 }finally{s.close();}
});
test('filtered quick run downloads eligible photos with zero address calls, excludes explicit outside details, and retains decisions/ranks',async()=>{
 const bytes=await sharp({create:{width:4,height:4,channels:3,background:'white'}}).jpeg().toBuffer();
 for(const outside of [false,true]){
  const s=setup(),dir=mkdtempSync(join(tmpdir(),'source-filter-'));let photos=0;
  try{
   const fixture=readFileSync('tests/fixtures/craigslist.html','utf8').replace('100 Example Street',outside?'100 Example Street, Burnaby, BC':'100 Example Street');
   const p=createPlan(s,{assessmentMode:'quick',sources:['craigslist'],newListingsOnly:true,targetNewListingsPerSource:1,maxPages:3,maxListings:1,maxPhotos:5,maxAiCalls:0,maxReservedUsd:0,maxAddressLookups:1});assert.equal(p.caps.maxAddressLookups,0);approvePlan(s,p.id,'APPROVE ONE SCAN');
   await runRegularPlan(s,p.id,dir,undefined,{session:(_source,b)=>({stopped:false,start:async()=>{},close:async()=>{},html:async u=>{b.reserve('pages');assert.ok([search,url].includes(u));return u===url?fixture:`<a href="${url}">Apartment</a>`;},resource:async()=>'',image:async()=>{b.reserve('photos');photos++;return bytes;}}),addressLookup:async()=>{throw Error('Unexpected address call');},review:async()=>{throw Error('Unexpected AI');}});
   assert.equal(photos,outside?0:3);assert.equal(getPlan(s,p.id).addressLookups,0);assert.equal(getPlan(s,p.id).usage.aiCalls,0);
   if(!outside){const home=s.homes()[0];assert.equal(home.deskExclusion,undefined);assert.equal(home.listing.evidence.searchAreaSourceUrl,search);assert.notEqual(home.quickRank!.grade,'S');}
  }finally{s.close();}
 }
});
test('filtered fresh discovery continues past an unrecognized route and never broadens through an unscoped REST inventory',async()=>{
 const north='https://www.austeville.com/vacancies/?city=north-vancouver',west='https://www.austeville.com/vacancies/?city=west-vancouver';
 const suite='https://www.austeville.com/property/example/suite-101/',endpoint='https://www.austeville.com/wp-json/wp/v2/re_property?per_page=100';
 for(const phase of ['combined','inventory'] as const){
  const s=setup(),dir=mkdtempSync(join(tmpdir(),'scoped-rest-')),visited:string[]=[];let resources=0;
  try{
   s.set('searchAreaPolicy',{...policy,regions:['north-vancouver','west-vancouver'],sourceRoutes:{austeville:[...(phase==='combined'?[{url:north,region:'north-vancouver'}]:[]),{url:west,region:'west-vancouver'}]}});
   const p=createPlan(s,{assessmentMode:'quick',phase,sources:['austeville'],newListingsOnly:phase==='combined',targetNewListingsPerSource:1,maxPages:4,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});approvePlan(s,p.id,'APPROVE ONE SCAN');
   await runRegularPlan(s,p.id,dir,undefined,{session:(_source,b)=>({stopped:false,start:async()=>{},close:async()=>{},html:async u=>{b.reserve('pages');visited.push(u);if(u===suite)return readFileSync('tests/fixtures/austeville-unit-header.html','utf8');return `<main>${u===west?`<a href="${suite}">West Vancouver apartment</a>`:'No recognizable rental links'}</main><script>const inventory="${endpoint}"</script>`;},resource:async()=>{resources++;throw Error('Unscoped REST expansion must not run');},image:async()=>{throw Error('No photo budget');}})});
   assert.equal(resources,0);assert.ok(visited.includes(west));
   if(phase==='combined'){assert.ok(visited.includes(suite));assert.match(s.events().map(e=>e.message).join('\n'),/trying the next configured geographic route/);}
   else assert.deepEqual(readQueue(s,'austeville').urls,[suite]);
  }finally{s.close();}
 }
});
