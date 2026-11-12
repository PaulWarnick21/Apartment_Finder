import test from 'node:test';
import assert from 'node:assert/strict';
import {listingSchema,criteriaSchema} from '../src/domain.ts';
import {scoreListing} from '../server/scoring.ts';
const l=listingSchema.parse({source:'test',sourceId:'test',url:'https://example.com/a',title:'Example',address:'100 Example St',rent:2100,beds:1});
test('floor plans and missing photos cannot qualify for the active desk',()=>{
 assert.equal(scoreListing(l,criteriaSchema.parse({})).eligible,false);
 const floor=listingSchema.parse({...l,galleryComplete:true,expectedPhotos:1,photos:[{id:'p',url:'https://example.com/p.jpg',status:'reviewed',kind:'floorplan'}]});
 const s=scoreListing(floor,criteriaSchema.parse({}));assert.equal(s.eligible,false);assert.match(s.reasons.join(' '),/Floor plans only/);
});
test('pending images stay reviewable; real interior photos do not imply confirmed unit views',()=>{
 const pending=listingSchema.parse({...l,photos:[{id:'p',url:'https://example.com/p.jpg'}]});
 const s=scoreListing(pending,criteriaSchema.parse({}));assert.equal(s.eligible,false);assert.equal(s.reasons.length,0);
 pending.photos[0].status='reviewed';pending.photos[0].kind='interior';
 const ready=scoreListing(pending,criteriaSchema.parse({}));assert.equal(ready.eligible,true);assert.equal(ready.view,'Unverified');
});
