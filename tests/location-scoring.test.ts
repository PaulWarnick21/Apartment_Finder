import test from 'node:test';
import assert from 'node:assert/strict';
import {criteriaSchema,listingSchema} from '../src/domain.ts';
import {scoreListing} from '../server/scoring.ts';
import {scoringFacts} from '../server/scoring-facts.ts';

const listing=(extra:Record<string,unknown>={})=>listingSchema.parse({source:'fixture',sourceId:'location',url:'https://example.com/location',title:'Apartment',address:'Example Street',rent:3000,beds:1,laundry:'in-unit',modern:true,gas:true,photos:[{id:'p',url:'https://example.com/p.jpg',status:'reviewed',kind:'interior',scenery:'unknown',unitCertain:true}],galleryComplete:true,expectedPhotos:1,...extra});
const locationAdjustment=(l:ReturnType<typeof listing>,c=criteriaSchema.parse({}))=>scoreListing(l,c).adjustments.filter(a=>a.label==='Outside Downtown Core');

test('Riley Park and Oakridge receive one visible distance deduction, lowering an unverified-view score',()=>{
 const c=criteriaSchema.parse({priceAnchor:3500,priceSlope:.0006428571428571429,outsidePenalty:1.6,unverifiedViewCeiling:3.1});
 for(const area of ['Riley Park','Oakridge']){
  const l=listing({area});assert.equal(scoringFacts(l).downtownDistance,'far');
  const result=scoreListing(l,c);assert.deepEqual(locationAdjustment(l,c),[{label:'Outside Downtown Core',value:-1.6}]);
  assert.equal(result.value,2.4);assert.ok(!result.flags.includes('Location Unsure'));assert.equal(result.eligible,false);
 }
});

test('nearby and transit-accessible homes retain at least the configured outside-core minimum',()=>{
 const c=criteriaSchema.parse({outsidePenalty:0,transitPenalty:.2,outsideDowntownMinPenalty:.5});
 for(const extra of [{area:'Kitsilano'},{location:'outside'},{location:'near-transit'},{downtownDistance:'far'},{downtownDistance:'nearby'}])assert.equal(locationAdjustment(listing(extra),c)[0].value,-.5);
 assert.equal(locationAdjustment(listing({location:'outside',downtownDistance:'far'}),criteriaSchema.parse({outsidePenalty:1.6})).length,1);
});

test('downtown and unconfirmed locations are never assigned a guessed outside-core deduction',()=>{
 for(const extra of [{location:'downtown'},{area:'Coal Harbour'},{area:'City Gate'},{area:'Citygate'},{location:'near-transit',downtownDistance:'downtown'},{}])assert.equal(locationAdjustment(listing(extra)).length,0);
 assert.ok(scoreListing(listing(),criteriaSchema.parse({})).flags.includes('Location Unsure'));
});
