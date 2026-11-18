import test from 'node:test';
import assert from 'node:assert/strict';
import {listingSchema,criteriaSchema,type Listing} from '../src/domain.ts';
import {scoreBase,scoreListing} from '../server/scoring.ts';
import {parkingAssessment} from '../server/parking-assessment.ts';
import {learningFromRows} from '../server/feedback-learning.ts';
const fixture=(extra:Partial<Listing>={})=>listingSchema.parse({source:'fixture',sourceId:'parking',url:'https://example.test/parking',title:'Apartment',address:'',rent:2500,beds:1,location:'downtown',parking:'included',photos:[{id:'one',url:'https://example.test/photo',status:'reviewed',kind:'interior',scenery:'nature',quality:3,unitCertain:true}],expectedPhotos:1,galleryComplete:true,...extra});
const criteria=criteriaSchema.parse({});
test('confirmed parking absence reduces capped and uncapped scores by a full point',()=>{
 for(const quality of [2,3,5]){
  const l=fixture();l.photos[0].quality=quality;
  const available=scoreBase(l,criteria),absent=scoreBase({...l,parking:'none',description:'No parking available.'},criteria);
  assert.equal(absent.value,Math.round((available.value-1)*10)/10);
  assert.ok(absent.adjustments.some(a=>a.value===-1&&/Parking/.test(a.label)));
 }
});
test('absence evidence distinguishes waitlists, no inclusion and unknown information',()=>{
 for(const [description,penalty] of [['Parking waitlist only.',.75],['Parking: no parking included',.5],['Parking not included.',.5],['Parking subject to availability.',0],['',0],['No bicycle parking.',0],['Other units have no parking available.',0]] as const){
  assert.equal(parkingAssessment(fixture({parking:'unknown',description})).penalty,penalty,description);
 }
 assert.equal(parkingAssessment(fixture({parking:'none',description:'No parking included.'})).penalty,.5);
});
test('available paid parking and conflicting or building claims do not establish absence',()=>{
 for(const l of [fixture({parking:'extra',parkingCost:100,description:'Parking not included. Parking available for $100 per month.'}),fixture({parking:'unknown',description:'No parking available.',conflicts:['Parking terms conflict']}),fixture({offeringKind:'building',parking:'none',description:'No parking available.'})])assert.equal(parkingAssessment(l).penalty,0);
});
test('positive historical ratings cannot undo the parking deduction',()=>{
 const l=fixture({parking:'none',description:'No parking available.'});
 const base=scoreBase(l,criteria);
 const learned=learningFromRows([{id:1,home_id:1,user_score:5,reason:'I like this apartment.',listing_json:JSON.stringify(l),score_json:JSON.stringify(base)}],criteria).criteria;
 assert.equal(scoreListing({...l,homeId:1},learned).value,base.value);
});
test('the score floor and ordinary below-three exclusion survive parking deductions',()=>{
 const excluded=scoreListing(fixture({parking:'none',description:'No parking available.'}),criteria);
 assert.ok(excluded.value<3);assert.equal(excluded.eligible,false);assert.ok(excluded.reasons.includes('Score below 3.0'));
 assert.equal(scoreListing(fixture({parking:'none',rent:50000}),criteria).value,.1);
});
