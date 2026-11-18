import test from 'node:test';
import assert from 'node:assert/strict';
import {listingSchema,criteriaSchema,type Listing} from '../src/domain.ts';
import {scoreBase,scoreListing} from '../server/scoring.ts';
import {learningFromRows} from '../server/feedback-learning.ts';
import {unitFloor} from '../server/scoring-facts.ts';
const fixture=(extra:Partial<Listing>={})=>listingSchema.parse({source:'fixture',sourceId:'view',url:'https://example.test/view',title:'Apartment',address:'',rent:2000,beds:1,location:'downtown',floorLevel:5,parking:'included',modern:true,furnished:true,workspace:true,openPlan:true,gas:true,shortLease:true,photos:[{id:'one',url:'https://example.test/photo',status:'reviewed',kind:'interior',scenery:'nature',quality:4,unitCertain:true}],expectedPhotos:1,galleryComplete:true,...extra});
const criteria=criteriaSchema.parse({interiorTradeoff:{enabled:true,ceiling:3.5,viewPenalty:0},partialNatureCeiling:5,unverifiedViewCeiling:5,goodUnverifiedViewCeiling:5});
test('4.0+ requires a good actual-unit nature view and a supported floor of at least three',()=>{
 assert.ok(scoreBase(fixture({floorLevel:3}),criteria).value>=4);
 for(const floorLevel of [null,0,1,2]){const s=scoreBase(fixture({floorLevel}),criteria);assert.equal(s.value,3.9);assert.ok(s.high<=3.9);assert.ok(s.ceiling!<=3.9);}
 const l=fixture();for(const changes of [{quality:3.9},{unitCertain:false},{kind:'balcony'},{kind:'amenity'},{status:'pending'},{scenery:'unknown'},{attributionPending:true}] as const){const s=scoreBase({...l,photos:[{...l.photos[0],...changes}]},criteria);assert.ok(s.value<=3.9,JSON.stringify(changes));}
});
test('incomplete galleries and contradictory floor/view facts cannot earn a strong-match score',()=>{
 for(const change of [{galleryComplete:false},{expectedPhotos:2},{conflicts:['Conflicting unit floor statements: 2 / 10']},{conflicts:['View differs across postings.']}]){
  const s=scoreBase(fixture(change),criteria);assert.ok(s.value<=3.9);assert.ok(s.high<=3.9);
 }
});
test('positive personal calibration cannot bypass the strong-match ceiling',()=>{
 const l=fixture({floorLevel:null}),base=scoreBase(l,criteria);
 const learned=learningFromRows([{id:1,home_id:1,user_score:5,reason:'This apartment looks wonderful.',listing_json:JSON.stringify(l),score_json:JSON.stringify(base)}],criteria).criteria;
 const s=scoreListing({...l,homeId:1},learned);assert.equal(s.value,3.9);assert.ok(s.high<=3.9);
});
test('the new ceiling preserves stricter evidence limits and applies parking afterward',()=>{
 const l=fixture({floorLevel:null,parking:'none',description:'No parking available.'});assert.equal(scoreBase(l,criteria).value,2.9);
 const s=scoreBase(fixture({floorLevel:null}),{...criteria,requireLaundry:true});assert.ok(s.value<=3.9);
 const noView=fixture();noView.photos[0].unitCertain=false;assert.ok(scoreBase(noView,criteriaSchema.parse({goodUnverifiedViewCeiling:3.3})).value<=3.3);
});
test('explicit unit floor wording qualifies without borrowing shared-amenity floors',()=>{
 assert.equal(unitFloor('6th-floor condo','').value,6);
 assert.ok(scoreBase(fixture({floorLevel:null,title:'Bright 7th-floor studio'}),criteria).value>=4);
 for(const title of ['9th Floor Garden Deck with water views','Other 6th-floor suites available','Guest 6th-floor apartment','Building amenities: 6th-floor suite'])assert.equal(unitFloor(title,'').value,null,title);
 assert.equal(unitFloor('6th-floor condo','This apartment is on the second floor. Floor: 2').value,null);
});
