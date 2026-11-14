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
test('map lookup coalesces simultaneous opens, persists cache and keeps demos offline',async()=>{
 const store=new Store(':memory:');let calls=0;
 const lookup=(async()=>{calls++;return new Response(JSON.stringify([row]),{status:200});}) as typeof fetch;
 try{const maps=new LocationMaps(store,false,lookup);const [a,b]=await Promise.all([maps.get(listing),maps.get(listing)]);assert.equal(calls,1);assert.equal(a.status,'ready');assert.deepEqual(a,b);
 assert.deepEqual(await new LocationMaps(store,false,lookup).get(listing),a);assert.equal(calls,1);
 assert.equal((await new LocationMaps(store,true,lookup).get(listing)).status,'unavailable');assert.equal(calls,1);
 }finally{store.close();}
});
test('a map service warning is cached and pauses subsequent map requests',async()=>{
 const store=new Store(':memory:');let calls=0;const lookup=(async()=>{calls++;return new Response('',{status:429});}) as typeof fetch;
 try{const maps=new LocationMaps(store,false,lookup);assert.equal((await maps.get(listing)).status,'unavailable');await maps.get(listing);await maps.get({...listing,address:'100 Jervis Street, Vancouver'});assert.equal(calls,1);assert.ok(store.get<number>('mapPauseUntil')!>Date.now());}finally{store.close();}
});
