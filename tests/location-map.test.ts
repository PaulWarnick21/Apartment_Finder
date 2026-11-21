import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {listingSchema} from '../src/domain.ts';
import {LocationMaps,locationQuery,chooseLocation} from '../server/location-map.ts';
const listing=listingSchema.parse({source:'example',sourceId:'1',url:'https://example.com/1',title:'Home',rent:2500,beds:1,address:'220-3250 W Broadway, Vancouver, BC'});
const row={lat:'49.264',lon:'-123.178',address:{house_number:'3250',road:'West Broadway',city:'Vancouver',country_code:'ca'}};
test('map query removes suite numbers and never substitutes an unknown location with a city pin',()=>{
 assert.equal(locationQuery(listing)?.label,'3250 W Broadway, Vancouver, BC');
 assert.equal(locationQuery({...listing,address:'3250 Broadway W #220, Vancouver'})?.label,'3250 Broadway W, Vancouver');
 assert.equal(locationQuery({...listing,address:'',area:'Unknown'}),null);
 assert.equal(locationQuery({...listing,address:'',area:'Coal Harbour'})?.street,false);
 assert.equal(locationQuery({...listing,address:'',title:'Unit #1 in 1646 Charles Street Suite 1'})?.label,'1646 Charles Street');
});
test('map rejects wrong house numbers, streets, cities and out-of-region results',()=>{
 const input=locationQuery(listing)!;assert.equal(chooseLocation([row],input).status,'ready');
 for(const bad of [{...row,lat:0},{...row,address:{...row.address,house_number:'3000'}},{...row,address:{...row.address,road:'West 4th Avenue'}},{...row,address:{...row.address,city:'Richmond'}}])assert.equal(chooseLocation([bad],input).status,'unavailable');
 assert.equal(chooseLocation([row],locationQuery({...listing,address:'',area:'Kitsilano'})!).approximate,true);
 assert.equal(chooseLocation([{...row,address:{...row.address,house_number:'108',road:'West 1st Avenue'}}],locationQuery({...listing,address:'108 1st Av W'})!).status,'ready');
});

test('#663 uses the advertised North Vancouver municipality and accepts its official district name',async()=>{
 const home={...listing,address:'1550 Fern St',area:'North Vancouver',title:'1550 Fern St Unit Furnished 1 Bedroom Condo with Mountain Views, North Vancouver, BC V7J 0A9'};
 const input=locationQuery(home)!;
 assert.equal(input.query,'1550 Fern St, North Vancouver, British Columbia, Canada');
 const fern={lat:'49.3117796',lon:'-123.0308339',address:{house_number:'1550',road:'Fern Street',town:'District of North Vancouver',country_code:'ca'}};
 assert.equal(chooseLocation([fern],input).status,'ready');
 assert.equal(chooseLocation([{...fern,address:{...fern.address,town:'Vancouver'}}],input).status,'unavailable');
 assert.equal(chooseLocation([{...fern,address:{...fern.address,house_number:'1500'}}],input).status,'unavailable');
 assert.equal(locationQuery({...home,area:'Lynnmour'})?.query,input.query);
 assert.match(locationQuery({...home,address:'1550 Fern St, Vancouver'})!.query,/Fern St, Vancouver,/);
 const store=new Store(':memory:');let calls=0;
 try{
  const maps=new LocationMaps(store,false,async url=>{calls++;const q=new URL(String(url)).searchParams.get('q');return new Response(JSON.stringify(q===input.query?[fern]:[]));});
  assert.equal((await maps.get({...home,area:'',title:'Home'})).status,'unavailable');
  assert.equal((await maps.get(home)).status,'ready');
  assert.equal((await maps.get(home)).status,'ready');assert.equal(calls,2);
 }finally{store.close();}
});
test('map lookup coalesces simultaneous opens, persists cache and keeps demos offline',async()=>{
 const store=new Store(':memory:');let calls=0;
 const lookup=(async()=>{calls++;return new Response(JSON.stringify([row]),{status:200});}) as typeof fetch;
 try{const maps=new LocationMaps(store,false,lookup);const [a,b]=await Promise.all([maps.get(listing),maps.get(listing)]);assert.equal(calls,1);assert.equal(a.status,'ready');assert.deepEqual(a,b);
 assert.deepEqual(await new LocationMaps(store,false,lookup).get(listing),a);assert.equal(calls,1);
 assert.equal((await new LocationMaps(store,true,lookup).get(listing)).status,'unavailable');assert.equal(calls,1);
 }finally{store.close();}
});

test('exact address research rejects neighbouring municipalities, missing direction and ambiguous buildings',()=>{
 const input=locationQuery(listing)!;
 for(const city of ['North Vancouver','West Vancouver',''])assert.equal(chooseLocation([{...row,address:{...row.address,city}}],input).status,'unavailable');
 assert.equal(chooseLocation([row],locationQuery({...listing,address:'3250 Broadway, Vancouver'})!).status,'unavailable');
 assert.equal(chooseLocation([row,{...row,lat:'49.28'}],input).status,'unavailable');
 assert.equal(chooseLocation([null,row],input).status,'ready');
});
test('a map service warning is cached and pauses subsequent map requests',async()=>{
 const store=new Store(':memory:');let calls=0;const lookup=(async()=>{calls++;return new Response('',{status:429});}) as typeof fetch;
 try{const maps=new LocationMaps(store,false,lookup);assert.equal((await maps.get(listing)).status,'unavailable');await maps.get(listing);await maps.get({...listing,address:'100 Jervis Street, Vancouver'});assert.equal(calls,1);assert.ok(store.get<number>('mapPauseUntil')!>Date.now());}finally{store.close();}
});

test('a researched civic correction and verified coordinates replace a failed detail map without another request',async()=>{
 const store=new Store(':memory:');let calls=0;
 const home={...listing,address:'1102 National Avenue #189',evidence:{researchedAddress:'189 National Avenue, Vancouver, BC',researchedAddressSource:'https://example.test/property/189-national'}};
 const maps=new LocationMaps(store,false,async url=>{calls++;assert.equal(new URL(String(url)).searchParams.get('q'),'189 National Avenue, Vancouver, BC, Canada');return new Response('[]');});
 try{
  assert.equal((await maps.get(home)).status,'unavailable');
  maps.remember(home,{status:'ready',label:'189 National Avenue',lat:49.2752129,lon:-123.1004046,approximate:false});
  const saved=await new LocationMaps(store,false,async()=>assert.fail('Verified coordinates must be reused')).get(home);
  assert.equal(saved.status,'ready');assert.equal(saved.label,'189 National Avenue, Vancouver, BC');assert.equal(saved.lat,49.2752129);assert.equal(saved.lon,-123.1004046);assert.equal(calls,1);
  assert.throws(()=>maps.remember(home,{status:'ready',label:'City',lat:49.28,lon:-123.1,approximate:true}),/exact verified/);
  assert.equal((await new LocationMaps(store,true).get(home)).status,'unavailable');
 }finally{store.close();}
});
