import test from 'node:test';
import assert from 'node:assert/strict';
import {criteriaSchema,listingSchema,type Listing} from '../src/domain.ts';
import {scoreListing} from '../server/scoring.ts';

const criteria=criteriaSchema.parse({baseScore:4.3,priceSlope:0,maxRent:3200,requireLaundry:true,requireNiceViewForDesk:true,quickIntake:{minRent:1200,maxRent:3200,minPhotos:2,allowedBeds:[1,2]}});
const listing=(extra:Partial<Listing>={})=>listingSchema.parse({source:'fixture',sourceId:'full',url:'https://example.com/full',title:'Apartment',address:'Example',area:'Downtown Vancouver',rent:2400,beds:1,laundry:'in-unit',floorLevel:6,parking:'included',galleryComplete:true,expectedPhotos:2,photos:[1,2].map(id=>({id:String(id),url:`https://example.com/${id}.jpg`,status:'reviewed',kind:'interior',scenery:'nature',quality:4,unitCertain:true})),...extra});

test('full scores honor inclusive quick rent bounds and reject below-range prices',()=>{
 for(const rent of [1200,3200]){const score=scoreListing(listing({rent}),criteria);assert.equal(score.eligible,true);assert.ok(!score.reasons.some(r=>/rent|price/i.test(r)));}
 for(const rent of [1199,3201]){const score=scoreListing(listing({rent}),criteria);assert.equal(score.eligible,false);assert.ok(score.value<3);assert.match(score.reasons.join(' '),/outside the intake range/);}
});

test('full numeric benefits cannot undo the configured bedroom or attached-photo hard gates',()=>{
 for(const beds of [0,3]){const score=scoreListing(listing({beds,modern:true,furnished:true,workspace:true,gas:true}),criteria);assert.equal(score.eligible,false);assert.match(score.reasons.join(' '),/Studio apartment|Bedroom count/);}
 const one=listing();one.photos=one.photos.slice(0,1);one.expectedPhotos=1;const score=scoreListing(one,criteria);assert.equal(score.eligible,false);assert.match(score.reasons.join(' '),/Too few photos/);
});

test('full score preserves unknown/conflicting intake facts as uncertainty',()=>{
 const unknown=scoreListing(listing({rent:null,beds:null,laundry:'unknown'}),criteria);assert.ok(!unknown.reasons.some(r=>/intake range|required/.test(r)));assert.match(unknown.flags.join(' '),/Monthly rent not confirmed/);
 const conflicting=scoreListing(listing({rent:4000,beds:3,laundry:'shared-only',conflicts:['rent: conflicting statements','bedrooms: conflicting statements','laundry: conflicting statements']}),criteria);
 assert.ok(!conflicting.reasons.some(r=>/intake range|required|configured ceiling/.test(r)));assert.match(conflicting.flags.join(' '),/Conflicting rent/);
});

test('quick-first full-score explanations do not falsely direct Interested homes to Excluded',()=>{
 const l=listing();l.photos.forEach(p=>{p.scenery='buildings';p.quality=1;});
 const score=scoreListing(l,criteria);assert.ok(score.value<3);assert.ok(!score.reasons.some(r=>r.includes('review manually in Excluded')));assert.ok(score.reasons.some(r=>r.includes('full-score preference not met')));
});
