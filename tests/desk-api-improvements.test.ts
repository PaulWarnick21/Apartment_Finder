import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../server/db.ts';
import {createApp} from '../server/api.ts';
import {listingSchema} from '../src/domain.ts';
import {applyLocalUpgrades,learningVersion} from '../server/local-upgrades.ts';
import {photosForDisplay} from '../src/photo-order.ts';
const fixture=(sourceId:string)=>listingSchema.parse({source:'fixture',sourceId,url:'https://example.test/'+sourceId,title:'Fixture',address:'100 Example St',unit:'',rent:2500,beds:1,description:'Full private description',photos:[{id:'p1',url:'https://example.test/p1',local:'fixture.jpg',status:'reviewed',kind:'interior',scenery:'nature',unitCertain:true,quality:4}],galleryComplete:true});
test('compact desk API supports conditional refresh, full details and repeated protected preference saves',async()=>{
 const store=new Store(':memory:'),dir=mkdtempSync(join(tmpdir(),'af-api-improvements-')),id=store.ingest(fixture('a')).id,app=createApp(store,dir,{demo:true});
 await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}/api/`;
 try{
  const response=await fetch(base+'state?compact=1'),state=await response.json() as any,etag=response.headers.get('etag')!;
  assert.equal(state.homes[0].listing.description,'');assert.equal(state.homes[0].summaryOnly,true);
  assert.equal((await fetch(base+'state?compact=1',{headers:{'If-None-Match':etag}})).status,304);
  assert.equal((await(await fetch(base+`homes/${id}`)).json() as any).listing.description,'Full private description');
  const patch=async(revision:string,changes:unknown)=>fetch(base+'criteria',{method:'PATCH',headers:{'Content-Type':'application/json','X-AF-Token':state.csrf},body:JSON.stringify({revision,changes})});
  const first=await patch(state.criteriaRevision,{maxRent:3500});assert.equal(first.status,200);const saved=await first.json() as any;
  const second=await patch(saved.revision,{maxRent:3400});assert.equal(second.status,200);assert.equal(store.criteria.maxRent,3400);
  assert.equal((await patch(state.criteriaRevision,{maxRent:3300})).status,409);
 }finally{await app.close();store.close();}
});
test('compact desk supplies every saved card photo in display order without full assessment payloads',async()=>{
 const listing=fixture('card-gallery'),basePhoto=listing.photos[0];
 listing.photos=[
  {...basePhoto,id:'promo',url:'https://example.test/promo',local:'promo.jpg',note:'Promotional text overlay'},
  {...basePhoto,id:'kitchen',url:'https://example.test/kitchen',local:'kitchen.jpg',scenery:'unknown'},
  {...basePhoto,id:'window',url:'https://example.test/window',local:'window.jpg',note:'Detailed window assessment'},
  {...basePhoto,id:'pending',url:'https://example.test/pending',local:undefined,status:'pending'}
 ];
 const store=new Store(':memory:'),id=store.ingest(listing).id,dir=mkdtempSync(join(tmpdir(),'af-card-gallery-')),app=createApp(store,dir,{demo:true});
 await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));
 try{
  const before=store.home(id)!;
  const state=await(await fetch(`http://127.0.0.1:${(app.server.address() as {port:number}).port}/api/state?compact=1`)).json() as any;
  const card=state.homes.find((home:any)=>home.id===id);
  assert.equal(card.galleryCount,4);
  assert.deepEqual(card.listing.photos.map((photo:any)=>photo.local),['window.jpg','kitchen.jpg','promo.jpg']);
  assert.deepEqual(photosForDisplay(card.listing.photos).map(photo=>photo.local),['window.jpg','kitchen.jpg','promo.jpg']);
  assert.equal(card.listing.photos[0].note,'');
  assert.deepEqual(store.home(id),before);
 }finally{await app.close();store.close();}
});

test('duplicate merge/split API preserves aliases and can rebuild learning atomically',async()=>{
 const store=new Store(':memory:'),a=store.ingest(fixture('a')).id,b=store.ingest(fixture('b')).id,dir=mkdtempSync(join(tmpdir(),'af-merge-api-')),app=createApp(store,dir,{demo:true});
 await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}/api/`;
 try{const state=await(await fetch(base+'state')).json() as any;const post=async(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-AF-Token':state.csrf},body:JSON.stringify(body)});
 const response=await post('duplicates/merge',{keepId:a,duplicateId:b,revisions:{keep:store.home(a)!.revision,duplicate:store.home(b)!.revision},confirmation:'SAME APARTMENT'});const merged=await response.json() as any;assert.equal(response.status,200,JSON.stringify(merged));assert.deepEqual(store.home(a)!.aliases,[b]);assert.equal(store.homes().length,1);
 const split=await post('duplicates/split',{mergeId:merged.mergeId});assert.equal(split.status,200,await split.text());assert.equal(store.homes().length,2);
 }finally{await app.close();store.close();}
});
test('local learning upgrade is idempotent and preserves user-managed history',()=>{
 const store=new Store(':memory:');try{const id=store.ingest(fixture('a')).id;store.update(id,store.home(id)!.revision,{stage:'Interested',notes:'Saved notes',followUp:'2026-12-01',viewing:'',rescued:false});const decisions=store.db.prepare('SELECT * FROM history WHERE event=?').all('Decision saved');assert.equal(applyLocalUpgrades(store),true);assert.equal(store.get('learningVersion'),learningVersion);assert.equal(applyLocalUpgrades(store),false);assert.equal(store.home(id)!.notes,'Saved notes');assert.equal(store.home(id)!.stage,'Interested');assert.deepEqual(store.db.prepare('SELECT * FROM history WHERE event=?').all('Decision saved'),decisions);}finally{store.close();}
});
