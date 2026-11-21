import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {listingSchema} from '../src/domain.ts';
import {BuildingResearchService} from '../server/building-research.ts';
import {LocationMaps} from '../server/location-map.ts';
import {searchAreaExclusion} from '../server/search-area.ts';

const listing=()=>listingSchema.parse({source:'fixture',sourceId:'ash',url:'https://example.test/ash',title:'Downtown access',address:'8433 Ash St, Vancouver, BC',area:'Downtown Vancouver',location:'downtown',downtownDistance:'downtown',rent:2400,beds:1,photos:[{id:'p',url:'https://example.test/photo.jpg',local:'fixture.jpg'}],evidence:{searchAreaBasis:'Website geographic search filter'}});
const response=()=>({features:[{geometry:{type:'Point',coordinates:[-123.117,49.209]},properties:{score:100,matchPrecision:'CIVIC_NUMBER',civicNumber:8433,streetName:'Ash',streetType:'St',localityName:'Vancouver',provinceCode:'BC'}}]});
const missingMaps={get:async()=>({status:'unavailable',label:'8433 Ash St'})} as unknown as LocationMaps;

test('8433 Ash Street fallback overrides downtown provenance, preserves decisions and stays within two requests',async()=>{
 const store=new Store(':memory:');try{
  const id=store.ingest(listing()).id;store.update(id,store.home(id)!.revision,{stage:'Interested',notes:'Keep this',followUp:'',viewing:'',rescued:false});let calls=0;
  let mapCalls=0;const maps=new LocationMaps(store,false,async()=>{mapCalls++;return new Response('[]');});
  const service=new BuildingResearchService(store,maps,false,async url=>{calls++;assert.match(String(url),/^https:\/\/geocoder.api.gov.bc.ca/);return new Response(JSON.stringify(response()));});
  const result=await service.run(id,'APPROVE TWO PUBLIC RESEARCH REQUESTS'),home=store.home(id)!;
  assert.equal(calls,1);assert.equal(result.requestCount,2);assert.equal(result.addressStatus,'verified');assert.equal(home.listing.area,'Marpole');assert.equal(home.listing.downtownDistance,'far');assert.match(home.listing.evidence.location,/outside the downtown/);assert.ok(home.score.adjustments.some(a=>a.label==='Outside Downtown Core'));assert.equal(home.stage,'Interested');assert.equal(home.notes,'Keep this');
  await service.run(id,'APPROVE TWO PUBLIC RESEARCH REQUESTS');assert.equal(calls,1);
  const detailMap=await maps.get(home.listing);assert.equal(detailMap.status,'ready');assert.equal(detailMap.lat,49.209);assert.equal(detailMap.lon,-123.117);assert.equal(mapCalls,1);
 }finally{store.close();}
});

test('failed verification leaves downtown uncertain and access warnings suppress fallback',async()=>{
 const store=new Store(':memory:');try{
  const id=store.ingest(listing()).id;store.set('mapPauseUntil',Date.now()+86400000);
  const service=new BuildingResearchService(store,missingMaps,false,async()=>assert.fail('No requests during warning pause'));
  const result=await service.run(id,'APPROVE TWO PUBLIC RESEARCH REQUESTS');assert.equal(result.addressStatus,'unavailable');assert.ok(store.home(id)!.score.flags.includes('Location Unsure'));assert.ok(!store.home(id)!.score.adjustments.some(a=>a.label==='Outside Downtown Core'));
 }finally{store.close();}
});

test('verified address survives a paused permit service',async()=>{
 const store=new Store(':memory:');try{
  const id=store.ingest(listing()).id;store.set('buildingResearchPausedUntil',Date.now()+86400000);
  const maps={get:async()=>({status:'ready',lat:49.209,lon:-123.117,approximate:false})} as unknown as LocationMaps;
  const service=new BuildingResearchService(store,maps,false,async()=>assert.fail('Permit pause must be respected'));
  await service.run(id,'APPROVE TWO PUBLIC RESEARCH REQUESTS');assert.equal(store.home(id)!.listing.area,'Marpole');assert.equal(store.home(id)!.listing.evidence.addressLookupStatus,'verified');
 }finally{store.close();}
});

test('a cached failed address refresh cannot restore an older verified result',async()=>{
 const store=new Store(':memory:');try{
  const id=store.ingest(listing()).id;let available=true;
  const maps={get:async()=>available?{status:'ready',lat:49.2827,lon:-123.1207,approximate:false}:{status:'unavailable',label:'8433 Ash St'}} as unknown as LocationMaps;
  const service=new BuildingResearchService(store,maps,false,async()=>new Response(JSON.stringify({results:[],total_count:0})));
  await service.run(id,'APPROVE TWO PUBLIC RESEARCH REQUESTS');
  assert.equal(store.home(id)!.listing.evidence.addressLookupStatus,'verified');
  available=false;store.set('quickAddressPauseUntil',Date.now()+86400000);
  await service.run(id,'APPROVE TWO PUBLIC RESEARCH REQUESTS',true);
  assert.equal(store.home(id)!.listing.evidence.addressLookupStatus,'unavailable');
  await service.run(id,'APPROVE TWO PUBLIC RESEARCH REQUESTS');
  assert.equal(store.home(id)!.listing.evidence.addressLookupStatus,'unavailable');
  assert.ok(store.home(id)!.score.flags.includes('Location Unsure'));
 }finally{store.close();}
});

test('verified outside-downtown addresses override historical admission without guessing unresolved locations',()=>{
 const store=new Store(':memory:');try{
  store.set('searchAreaPolicy',{regions:['downtown-vancouver'],existingHomeIds:[1],configuredAt:new Date().toISOString()});
  const l={...listing(),homeId:1,area:'Marpole',downtownDistance:'far' as const,evidence:{addressLookupStatus:'verified'}};
  assert.match(searchAreaExclusion(store,l)!,/Verified address is outside/);
  assert.equal(searchAreaExclusion(store,{...l,evidence:{addressLookupStatus:'unavailable'}}),undefined);
 }finally{store.close();}
});
