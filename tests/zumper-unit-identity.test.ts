import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractZumperOfferings,zumperState} from '../server/zumper-extraction.ts';

const url='https://www.zumper.com/listings/29823489p/1-bedroom-riley-park-little-mountain-vancouver-bc';
const fixture=readFileSync(new URL('./fixtures/zumper-address-unit-identity.html',import.meta.url),'utf8');
const html=(state:unknown)=>'<script>window.__PRELOADED_STATE__ = '+JSON.stringify(state)+';</script>';

test('Zumper selects the requested address-page unit and its entire own gallery',()=>{
 const rows=extractZumperOfferings(fixture,url);assert.equal(rows.length,1);
 const unit=rows[0];assert.equal(unit.sourceId,'65552318');assert.equal(unit.url,url);assert.equal(unit.beds,1);assert.equal(unit.baths,1);assert.equal(unit.rent,1950);assert.equal(unit.sqft,1200);
 assert.match(unit.description,/One-bedroom rental/);assert.doesNotMatch(unit.description,/Four-bedroom|private garage/);
 assert.deepEqual(unit.photos.map(p=>p.id),Array.from({length:10},(_,i)=>String(9101+i)));
 assert.equal(unit.expectedPhotos,10);assert.equal(unit.galleryComplete,true);assert.equal(unit.offeringKind,'unit');
 assert.ok(unit.photos.every(p=>!p.url.includes('/940')&&!p.url.includes('/999999/')));
});

test('Zumper refuses a missing or ambiguous requested unit instead of using its sibling',()=>{
 const missing=zumperState(fixture);missing.permanentAddress.activeListings.pop();
 assert.throws(()=>extractZumperOfferings(html(missing),url),/requested unit was not found.*sibling facts were not imported/);
 const ambiguous=zumperState(fixture);ambiguous.permanentAddress.activeListings.push({...ambiguous.permanentAddress.activeListings[1],listing_id:777777});
 assert.throws(()=>extractZumperOfferings(html(ambiguous),url),/identity is ambiguous/);
});

test('Zumper never fills a selected unit gallery from another unit',()=>{
 const state=zumperState(fixture);delete state.permanentAddress.activeListings[1].image_ids;
 const unit=extractZumperOfferings(html(state),url)[0];assert.equal(unit.sourceId,'65552318');assert.equal(unit.photos.length,0);assert.equal(unit.galleryComplete,false);
});

test('Zumper merges own exact-unit representations and respects unavailable media',()=>{
 const state=zumperState(fixture),own=state.permanentAddress.activeListings[1];
 state.detail.entity.data={...own,media:[{media_id:9101,media_type:2},{media_id:9102,is_available:false},{media_id:9111,media_type:1}]};
 const unit=extractZumperOfferings(html(state),url)[0];assert.equal(unit.photos.length,10);assert.equal(unit.photos.find(p=>p.id==='9101')?.kind,'floorplan');assert.ok(!unit.photos.some(p=>p.id==='9102'));assert.ok(unit.photos.some(p=>p.id==='9111'));
});

test('Zumper direct listing IDs cannot be replaced by a mismatched advertised unit URL',()=>{
 const direct='https://www.zumper.com/listings/65552318/one-bedroom-vancouver-bc',state={detail:{entity:{data:{listing_id:65552318,bedrooms:1,price:1950,address:'100 Example Street',media:[]}}}};
 assert.equal(extractZumperOfferings(html(state),direct)[0].sourceId,'65552318');
 Object.assign(state.detail.entity.data,{url:'/listings/999999/other-unit'});
 assert.throws(()=>extractZumperOfferings(html(state),direct),/requested unit was not found/);
});

test('Zumper accepts an explicit direct/permanent URL alias for the same unit',()=>{
 const direct='https://www.zumper.com/listings/65552318/one-bedroom-vancouver-bc';
 assert.equal(extractZumperOfferings(fixture,direct)[0].sourceId,'65552318');
 const state=zumperState(fixture);state.permanentAddress.activeListings[1].url='/listings/65552318/one-bedroom-vancouver-bc';
 assert.equal(extractZumperOfferings(html(state),url)[0].sourceId,'65552318');
 delete state.permanentAddress.activeListings[1].pl_id;
 assert.throws(()=>extractZumperOfferings(html(state),url),/requested unit was not found/);
});
