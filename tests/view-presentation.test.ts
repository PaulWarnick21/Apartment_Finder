import test from 'node:test';
import assert from 'node:assert/strict';
import {photoSchema,listingSchema,criteriaSchema} from '../src/domain.ts';
import {photosForDisplay} from '../src/photo-order.ts';
import {scoreListing} from '../server/scoring.ts';
import {scoringFacts} from '../server/scoring-facts.ts';
import {deskCategory} from '../src/desk-category.ts';
const photo=(id:string,kind='interior',scenery='unknown',unitCertain=true)=>photoSchema.parse({id,url:`https://example.com/${id}.jpg`,local:`${id}.jpg`,status:'reviewed',kind,scenery,unitCertain,quality:scenery==='nature'?4:scenery==='buildings'?2:null});
test('window outlooks lead cards and galleries without changing stored photo order',()=>{
 const photos=[photo('kitchen'),photo('rooftop','amenity','nature'),photo('building-window','interior','buildings'),photo('display-window','interior','nature',false)];
 const sorted=photosForDisplay(photos);assert.equal(sorted[0].id,'building-window');assert.equal(photos[0].id,'kitchen');
 assert.equal(photosForDisplay([...photos,photo('nature-window','interior','nature')])[0].id,'nature-window');
 assert.equal(photosForDisplay([]).length,0);
});
test('clean windows and ordinary interiors precede promotional overlays',()=>{
 const promo={...photo('promo','interior','nature'),note:'A promotional overlay obscures most windows.'};
 const room=photo('room');const window=photo('window','interior','buildings',false);
 assert.equal(photosForDisplay([promo,room,window])[0].id,'window');
 assert.equal(photosForDisplay([promo,room])[0].id,'room');
 assert.equal(photosForDisplay([promo])[0].id,'promo');
});

test('weak representative window views cannot earn a high score from cheap rent alone',()=>{
 const criteria=criteriaSchema.parse({priceAnchor:3500,priceSlope:.0006428571428571429});
 const l=listingSchema.parse({source:'fixture',sourceId:'37',url:'https://example.com/37',title:'Representative unit',address:'Example',rent:2075,beds:1,location:'downtown',furnished:true,photos:[photo('window','interior','buildings',false)],expectedPhotos:1,galleryComplete:true,allOutlooksCovered:true});
 const score=scoreListing(l,criteria);assert.equal(score.value,2.9);assert.equal(score.eligible,false);assert.equal(score.view,'Unverified');assert.deepEqual(score.reasons,['Score below 3.0']);assert.ok(score.low<=score.value);assert.ok(score.high>=score.value);
 const expensive=scoreListing({...l,rent:3500,furnished:false,parking:'none'},criteria);assert.ok(expensive.value<3.3);
 const attributed=scoreListing({...l,allOutlooksCovered:false,photos:[photo('window','interior','buildings')]},criteria);assert.ok(attributed.value<3);assert.equal(attributed.eligible,false);
 const nature=scoreListing({...l,photos:[...l.photos,photo('nature','interior','nature',false)]},criteria);assert.equal(nature.view,'Unverified');assert.ok(!nature.adjustments.some(a=>a.label.startsWith('Weak representative')));
});

test('a tiny nature glimpse cannot overcome building-dominated views, especially with dated interiors',()=>{
 const criteria=criteriaSchema.parse({priceAnchor:3500,priceSlope:.0006428571428571429});
 const l=listingSchema.parse({source:'fixture',sourceId:'45',url:'https://example.com/45',title:'Example',address:'Example',rent:2400,beds:1,location:'downtown',workspace:true,modern:false,photos:[{...photo('glimpse','interior','nature'),quality:2}],galleryComplete:true,expectedPhotos:1});
 const score=scoreListing(l,criteria);assert.equal(score.value,3.1);assert.equal(score.eligible,true);assert.equal(score.view,'Partial nature');assert.ok(score.low<=score.value);
 // The glimpse ceiling cannot exceed the partial-view ceiling immediately above quality 2.
 assert.equal(scoreListing({...l,modern:null},criteria).value,3.2);
 assert.ok(scoreListing({...l,photos:[photo('good','interior','nature')]},criteria).value>3.3);
});

test('building-facing evidence receives a substantial penalty while uncertainty remains explicit',()=>{
 const criteria=criteriaSchema.parse({priceAnchor:3500,priceSlope:.0006428571428571429});
 const l=listingSchema.parse({source:'fixture',sourceId:'1',url:'https://example.com/1',title:'Example',address:'Example',rent:2290,beds:1,location:'downtown',workspace:true,openPlan:true,furnished:false,photos:[photo('window','interior','buildings')],expectedPhotos:1,galleryComplete:true,allOutlooksCovered:false});
 const score=scoreListing(l,criteria);assert.equal(score.value,1.3);assert.equal(score.eligible,false);assert.equal(score.view,'Unverified');assert.deepEqual(score.reasons,['Score below 3.0']);assert.ok(score.adjustments.some(a=>a.value<0));
 const certain=scoreListing({...l,allOutlooksCovered:true},criteria);assert.equal(certain.eligible,false);assert.ok(certain.high<3);
 const nature=scoreListing({...l,photos:[photo('nature','interior','nature')]},criteria);assert.ok(nature.value>3);assert.ok(!nature.adjustments.some(a=>a.label.includes('Building-facing')));
});

test('poor-view calibration matches the 18 and 20 examples and excludes all sub-3 headlines',()=>{
 const criteria=criteriaSchema.parse({priceAnchor:3500,priceSlope:.0006428571428571429});
 const l=listingSchema.parse({source:'fixture',sourceId:'18',url:'https://example.com/18',title:'Example',address:'Example',rent:2300,beds:1,location:'downtown',workspace:null,openPlan:true,gas:true,photos:[photo('window','interior','buildings')],expectedPhotos:1,galleryComplete:true});
 assert.equal(scoreListing(l,criteria).value,1);
 assert.equal(scoreListing({...l,rent:2400,openPlan:null,gas:null,furnished:true},criteria).value,.9);
 const uncertain=scoreListing({...l,photos:[photo('unknown')],rent:4600},criteria);
 assert.ok(uncertain.value<3);assert.ok(uncertain.high>=3);assert.equal(uncertain.eligible,false);
 for(const stage of ['Unreviewed','Interested','Applied','Closed'] as const)for(const rescued of [false,true])assert.equal(deskCategory({score:uncertain,stage,rescued}),'Excluded');
 const atThreshold={...uncertain,value:3,eligible:true};assert.equal(deskCategory({score:atThreshold,stage:'Unreviewed',rescued:false}),'Unreviewed');
});

test('dated interiors calibrate example 26 without penalizing unknown condition',()=>{
 const criteria=criteriaSchema.parse({priceAnchor:3500,priceSlope:.0006428571428571429});
 const l=listingSchema.parse({source:'fixture',sourceId:'26',url:'https://example.com/26',title:'Example',address:'Example',rent:3150,beds:1,location:'downtown',furnished:true,modern:false,shortLease:true,north:true,photos:[{...photo('partial','interior','nature',false),quality:3}],expectedPhotos:1,galleryComplete:true});
 const score=scoreListing(l,criteria);assert.equal(score.value,3.4);assert.equal(score.view,'Unverified');assert.equal(score.eligible,true);assert.ok(!score.adjustments.some(a=>a.label==='Modern interiors'));assert.ok(score.adjustments.some(a=>a.label==='Dated interiors'));
 const unknown=scoreListing({...l,modern:null},criteria);assert.ok(!unknown.adjustments.some(a=>/interiors/i.test(a.label)));
 const modern=scoreListing({...l,modern:true},criteria);assert.ok(modern.value>score.value);assert.ok(!modern.adjustments.some(a=>a.label==='Dated interiors'));
});

test('moderate partial views limit example 14 despite rent and interior bonuses',()=>{
 const criteria=criteriaSchema.parse({priceAnchor:3500,priceSlope:.0006428571428571429});
 const l=listingSchema.parse({source:'fixture',sourceId:'14',url:'https://example.com/14',title:'Example',address:'Example',rent:2400,beds:1,location:'downtown',workspace:true,modern:true,openPlan:true,furnished:false,shortLease:false,lease:'Minimum one year',photos:[{...photo('partial','interior','nature'),quality:3}],expectedPhotos:1,galleryComplete:true});
 const score=scoreListing(l,criteria);assert.equal(score.value,3.5);assert.equal(score.high,3.5);assert.ok(score.low<=score.value);assert.equal(score.eligible,true);
 assert.equal(scoreListing({...l,furnished:null,shortLease:null},criteria).value,3.5);
 // A stale short-lease flag conflicts with the saved one-year minimum and earns no lease bonus.
 const conflictingLease={...l,furnished:true,shortLease:true};
 assert.equal(scoringFacts(conflictingLease).shortLease,null);
 assert.ok(scoringFacts(conflictingLease).conflicts.includes('Conflicting short-term lease statements'));
 assert.equal(scoreListing(conflictingLease,criteria).value,3.7);
 assert.equal(scoreListing({...conflictingLease,lease:'Month-to-month lease'},criteria).value,3.9);
 assert.ok(scoreListing({...l,photos:[photo('nature','interior','nature')]},criteria).value>3.5);
 assert.ok(scoreListing({...l,rent:3500,workspace:false,modern:null,openPlan:null},criteria).value<3.5);
 assert.equal(scoreListing({...l,laundry:'shared-only'},{...criteria,requireLaundry:true}).eligible,false);
});

test('better partial views and gas distinguish example 16; second bedroom remains conditional',()=>{
 const criteria=criteriaSchema.parse({priceAnchor:3500,priceSlope:.0006428571428571429});
 const l=listingSchema.parse({source:'fixture',sourceId:'16',url:'https://example.com/16',title:'Example',address:'Example',rent:3180,beds:1,location:'downtown',workspace:true,modern:true,gas:true,shortLease:false,photos:[{...photo('mountains','interior','nature'),quality:3.5}],expectedPhotos:1,galleryComplete:true});
 const one=scoreListing(l,criteria),two=scoreListing({...l,beds:2},criteria);
 // The second bedroom still helps, but partial nature cannot cross the new 4.0 gate.
 assert.equal(one.value,3.8);assert.equal(two.value,3.9);assert.ok(!two.adjustments.some(a=>a.label==='Usable workspace'));
 assert.ok(scoreListing({...l,gas:null},criteria).value<one.value);
 assert.ok(scoreListing({...l,rent:3500},criteria).value<=one.value);
 assert.ok(scoreListing({...l,photos:[{...l.photos[0],quality:3}]},criteria).value<one.value);
});

test('expensive weak partial views rank below the better panorama calibration',()=>{
 const criteria=criteriaSchema.parse({priceAnchor:3500,priceSlope:.0006428571428571429});
 const l=listingSchema.parse({source:'fixture',sourceId:'46',url:'https://example.com/46',title:'Example',address:'Example',rent:3100,beds:2,location:'downtown',workspace:true,photos:[{...photo('water','interior','nature'),quality:2.5}],expectedPhotos:1,galleryComplete:true});
 assert.equal(scoreListing(l,criteria).value,3.2);
 assert.equal(scoreListing({...l,rent:3190,beds:1},criteria).value,3);
 assert.ok(scoreListing({...l,rent:2400,beds:1},criteria).value>scoreListing({...l,rent:3190,beds:1},criteria).value);
 assert.ok(scoreListing({...l,rent:3500,beds:1},criteria).value<3);
});

test('a representative mountain photo cannot turn an unverified rental into a strong match',()=>{const l=listingSchema.parse({source:'fixture',sourceId:'unknown',url:'https://example.com/unknown',title:'Example',address:'Example',rent:2100,beds:2,modern:true,furnished:true,workspace:true,photos:[photo('nature','interior','nature',false)],galleryComplete:true,expectedPhotos:1});const s=scoreListing(l,criteriaSchema.parse({}));assert.equal(s.view,'Unverified');assert.ok(s.value<=3.5);assert.ok(s.adjustments.some(a=>a.label==='Unverified nature view ceiling'));});
