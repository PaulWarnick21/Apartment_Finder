import test from 'node:test';
import assert from 'node:assert/strict';
import {criteriaSchema,listingSchema,photoSchema} from '../src/domain.ts';
import {scoreBase,scoreListing} from '../server/scoring.ts';
import {feedbackFeatures,assessedFacts} from '../server/scoring-facts.ts';
import {quickRank} from '../server/quick-rank.ts';

const c=criteriaSchema.parse({fullViewPenaltyCap:1,requireNiceViewForDesk:true,buildingViewPenalty:3.3,baseScore:4.5,priceSlope:0,preferredMinFloor:3,expensiveWeakViewRent:3000,expensiveWeakViewCeiling:2.5});
const fixture=(scenery='unknown',quality:number|null=null)=>listingSchema.parse({source:'fixture',sourceId:'relaxed',url:'https://example.test/relaxed',title:'Apartment',address:'123 Example Street',rent:2500,beds:1,location:'downtown',floorLevel:10,parking:'included',laundry:'in-unit',galleryComplete:true,expectedPhotos:1,allOutlooksCovered:true,photos:[photoSchema.parse({id:'window',url:'https://example.test/window.jpg',status:'reviewed',kind:'interior',unitCertain:true,scenery,quality})]});

test('one bounded view deduction replaces stacked penalties, caps and nature exclusions',()=>{
 for(const rent of [1500,2500,3100,3500])for(const baseScore of [3,4,5]){
  const criteria={...c,baseScore},neutral=scoreBase({...fixture(),rent},criteria);
  for(const l of [fixture('buildings',1),...[1,2,2.5,3,3.5].map(q=>fixture('nature',q))]){
   const score=scoreBase({...l,rent},criteria);
   assert.ok(neutral.value-score.value<=1.000001,JSON.stringify({rent,baseScore,neutral:neutral.value,score}));
   const penalties=score.adjustments.filter(a=>/outlook.*deduction/.test(a.label));
   assert.equal(penalties.length,1);assert.ok(penalties[0].value>=-1);
   assert.ok(!score.reasons.some(r=>/nature|view/i.test(r)));
   assert.ok(!score.adjustments.some(a=>/view ceiling|nature.*standard/i.test(a.label)));
  }
 }
 const poor=scoreBase(fixture('buildings',1),c);assert.equal(poor.value,3.5);assert.equal(poor.eligible,true);
 assert.equal(scoreBase(fixture('buildings',1),{...c,fullViewPenaltyCap:.5}).value,4);
});

test('unknown, representative, pending and conflicting outlooks do not establish a bad view',()=>{
 const unknown=scoreBase(fixture(),c);assert.equal(unknown.value,4.5);assert.ok(unknown.flags.includes('View Unverified'));
 for(const change of [{unitCertain:false},{attributionPending:true}]){
  const l=fixture('buildings',1);l.photos[0]={...l.photos[0],...change};
  assert.equal(scoreBase(l,c).value,unknown.value);
 }
 const conflicting=fixture('buildings',1);conflicting.conflicts=['Conflicting outlook evidence'];
 assert.equal(scoreBase(conflicting,c).value,unknown.value);
});

test('parking, laundry and photo review protections remain independent; quick grades are unchanged',()=>{
 const l=fixture('buildings',1),score=scoreBase(l,c);
 assert.equal(scoreBase({...l,parking:'none'},c).value,score.value-1);
 assert.equal(scoreBase({...l,laundry:'shared-only'},{...c,requireLaundry:true}).eligible,false);
 assert.ok(scoreBase({...fixture(),galleryComplete:false},c).value<=3.9);
 assert.deepEqual(quickRank(l,c),quickRank(l,{...c,fullViewPenaltyCap:null}));
 assert.throws(()=>criteriaSchema.parse({...c,fullViewPenaltyCap:1.1}));
});

test('superseded poor-view calibration cannot restore the large penalty; ratings remain intact',()=>{
 const l=fixture('buildings',1),example={feedbackId:7,homeId:7,key:'fixture:relaxed',scope:'general' as const,originalScore:4.5,target:1,baseline:3.5,features:feedbackFeatures(assessedFacts(l,c))};
 const criteria={...c,legacyViewFeedbackThrough:7,learnedExamples:[example]};
 assert.equal(scoreListing(l,criteria).value,scoreBase(l,c).value);
 assert.equal(criteria.learnedExamples[0].target,1);
 assert.ok(scoreListing(l,{...criteria,legacyViewFeedbackThrough:6}).value<scoreBase(l,c).value,'new explicit ratings can still calibrate');
});
