import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {Budget,approvePlan,claimPlan,createPlan,getPlan} from '../server/plans.ts';
import {listingSchema,type Listing} from '../src/domain.ts';
import {bcAddressString,matchQuickAddress,quickAddressQuery,resolveQuickLocation} from '../server/quick-location.ts';

const listing=(patch:Partial<Listing>={})=>listingSchema.parse({source:'craigslist',sourceId:'location',url:'https://example.test/listing',title:'Apartment',address:'1200 W Georgia St, Vancouver, BC',rent:2400,beds:1,...patch});
const response=(patch:Record<string,unknown>={},coordinates=[-123.123,49.287])=>({features:[{type:'Feature',geometry:{type:'Point',coordinates},properties:{score:100,matchPrecision:'CIVIC_NUMBER',civicNumber:1200,civicNumberSuffix:'',streetName:'Georgia',streetType:'St',streetDirection:'W',localityName:'Vancouver',provinceCode:'BC',faults:[],...patch}}]});
const caps={sources:['craigslist'],assessmentMode:'quick',maxPages:2,maxListings:2,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0,maxAddressLookups:1};
function setup(){const store=new Store(':memory:'),p=createPlan(store,caps);approvePlan(store,p.id,'APPROVE ONE SCAN');claimPlan(store,p.id);return {store,budget:new Budget(store,p.id,p.caps)};}

test('address queries strip unit numbers and use the advertised municipality',()=>{
 assert.match(quickAddressQuery(listing({address:'Suite 501 - 1200 W Georgia St'}))!.query,/^1200 W Georgia St, Vancouver/);
 assert.match(quickAddressQuery(listing({address:'501-1200 W Georgia St'}))!.query,/^1200 W Georgia St, Vancouver/);
 assert.match(quickAddressQuery(listing({address:'123 Main Street',area:'North Vancouver'}))!.query,/North Vancouver/);
 assert.equal(quickAddressQuery(listing({address:'1200 W Georgia St\n   google map'}))!.label,'1200 W Georgia St, Vancouver');
 assert.equal(matchQuickAddress(response(),quickAddressQuery(listing({address:'1200 W Georgia St Vancouver BC'}))!).status,'verified');
 assert.equal(quickAddressQuery(listing({address:'',title:'Lovely condo',area:'Downtown Vancouver'})),null);
});

test('exact geocoding classifies the neighbourhood; weak, wrong-city and ambiguous matches stay unverified',()=>{
 const query=quickAddressQuery(listing())!,good=matchQuickAddress(response(),query);
 assert.equal(good.status,'verified');assert.equal(good.distance,'downtown');assert.ok(good.area);
 for(const patch of [{score:94},{matchPrecision:'STREET'},{civicNumber:1201},{streetDirection:'E'},{localityName:'North Vancouver'},{provinceCode:'AB'},{faults:[{element:'STREET_NAME',fault:'spelledWrong',penalty:1}]}])assert.equal(matchQuickAddress(response(patch),query).status,'unavailable');
 assert.equal(matchQuickAddress(response({},[-123.123,48]),query).status,'unavailable');
 const ambiguous={features:[...response().features,...response({},[-123.13,49.28]).features]};assert.equal(matchQuickAddress(ambiguous,query).status,'unavailable');
 const burnaby=matchQuickAddress(response({localityName:'Burnaby'},[-122.99,49.26]),quickAddressQuery(listing({address:'1200 W Georgia St, Burnaby, BC'}))!);
 assert.equal(burnaby.area,'Burnaby');assert.equal(burnaby.distance,'far');
});

test('full address queries use explicit rental address lines and provincial API syntax',()=>{
 const q=quickAddressQuery(listing({address:'612 Elmwood St',description:'Address: 8**-612 Elmwood St, Coquitlam, BC\nQuick access to downtown Vancouver.'}))!;
 assert.equal(q.city,'Coquitlam');assert.equal(bcAddressString(q),'612 Elmwood St, Coquitlam, BC');
 assert.equal(bcAddressString(quickAddressQuery(listing({address:'8433 Ash St\n google map'}))!),'8433 Ash St, Vancouver, BC');
 assert.match(quickAddressQuery(listing({address:'Gilbert Rd near River Rd',description:'Property Details:\nLocation: #1610-5233 Gilbert Rd, Richmond BC'}))!.query,/5233 Gilbert Rd, Richmond/);
 assert.match(quickAddressQuery(listing({address:'138 EAST ESPLANADE',description:'1401-138 East Esplanade Ave, North Vancouver, BC'}))!.query,/North Vancouver/);
 assert.match(quickAddressQuery(listing({address:'D Plan-1668 Davie Street'}))!.query,/^1668 Davie Street/);
 assert.match(quickAddressQuery(listing({address:'602 Citadel Parade near Dunsmuir Viaduct'}))!.query,/^602 Citadel Parade, Vancouver/);
 assert.equal(quickAddressQuery(listing({address:'',title:'Apartment',description:'Managed by Example Realty at 100 Office St, Richmond BC'})),null);
});

test('bounded lookups are counted, cached and reused; exhaustion and old approvals make no request',async()=>{
 const {store,budget}=setup();let calls=0;
 const fetcher:typeof fetch=async(input,init)=>{calls++;assert.match(String(input),/^https:\/\/geocoder.api.gov.bc.ca\/addresses.geojson/);assert.equal(init?.redirect,'error');return new Response(JSON.stringify(response()));};
 try{
  const l=listing();await resolveQuickLocation(store,budget,l,1,fetcher);assert.equal(l.evidence.addressLookupStatus,'verified');assert.equal(l.downtownDistance,'downtown');assert.notEqual(l.area,'Unknown');assert.equal(calls,1);
  await resolveQuickLocation(store,budget,listing(),2,fetcher);assert.equal(calls,1);assert.equal(getPlan(store,budget.id).addressLookups,1);assert.equal(getPlan(store,budget.id).usage.requests,1);
  const different=listing({address:'1201 W Georgia St, Vancouver, BC'});await resolveQuickLocation(store,budget,different,3,fetcher);assert.equal(calls,1);assert.match(different.evidence.addressLookupDetail,/allowance exhausted/);
  const old=new Budget(store,budget.id,{...budget.caps,maxAddressLookups:undefined});await resolveQuickLocation(store,old,listing({address:'1202 W Georgia St'}),4,fetcher);assert.equal(calls,1);
  store.db.prepare("UPDATE plans SET state='cancelled' WHERE id=?").run(budget.id);await assert.rejects(resolveQuickLocation(store,budget,listing(),5,fetcher),/Scan stopped/);
 }finally{store.close();}
});

test('warnings persist a service pause and missing addresses or preserved homes never trigger requests',async()=>{
 const {store,budget}=setup();let calls=0;
 const fetcher:typeof fetch=async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'90000'}});};
 try{
  store.set('preservedQuickRank:1',{grade:'S'});await resolveQuickLocation(store,budget,listing(),1,fetcher);assert.equal(calls,0);
  await resolveQuickLocation(store,budget,listing({address:'',title:'Apartment'}),2,fetcher);assert.equal(calls,0);
  const l=listing();await resolveQuickLocation(store,budget,l,3,fetcher);assert.equal(l.evidence.addressLookupStatus,'unavailable');assert.equal(calls,1);assert.ok(store.get<number>('quickAddressPauseUntil')!>Date.now()+86400000);
  const different=listing({address:'1201 W Georgia St'});await resolveQuickLocation(store,budget,different,4,fetcher);assert.equal(calls,1);assert.match(different.evidence.addressLookupDetail,/paused/);
 }finally{store.close();}
});

test('new quick plans disclose the address cap, full/inventory plans cannot add it',()=>{
 const store=new Store(':memory:');try{
  assert.equal(createPlan(store,{...caps,maxAddressLookups:undefined}).caps.maxAddressLookups,2);
  for(const patch of [{assessmentMode:'full'},{phase:'inventory'},{maxAddressLookups:3}])assert.throws(()=>createPlan(store,{...caps,...patch}),/Address lookups/);
  assert.equal(createPlan(store,{...caps,phase:'inventory',maxAddressLookups:0}).caps.maxAddressLookups,0);
 }finally{store.close();}
});
