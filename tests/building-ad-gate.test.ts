import test from 'node:test';
import assert from 'node:assert/strict';
import {listingSchema,criteriaSchema} from '../src/domain.ts';
import {scoreListing} from '../server/scoring.ts';
import {hardFailure} from '../server/regular-worker.ts';
import {Store} from '../server/db.ts';
import {Budget,createPlan,approvePlan,claimPlan} from '../server/plans.ts';
import {ingestNewCandidate,validationSummary} from '../server/new-listing-validation.ts';

test('building galleries cannot promote a generic building ad into the apartment desk or paid review',()=>{
 const criteria=criteriaSchema.parse({maxRent:3600,requireLaundry:false});
 const building=listingSchema.parse({source:'fixture',sourceId:'building',url:'https://example.test/building',title:'Generic rental community',address:'100 Example Street',rent:2500,beds:1,offeringKind:'building',galleryComplete:true,photos:[{id:'p1',url:'https://example.test/photo.jpg',status:'reviewed',kind:'interior',scenery:'nature',quality:4,unitCertain:true}]});
 assert.equal(scoreListing(building,criteria).eligible,false);
 assert.ok(scoreListing(building,criteria).reasons.some(reason=>reason.startsWith('Building advertisement')));
 assert.equal(hardFailure(building,criteria),true);
 for(const offeringKind of ['unit','floorplan'] as const){const offering={...building,offeringKind};assert.equal(hardFailure(offering,criteria),false);assert.equal(scoreListing(offering,criteria).eligible,true);}
});

test('explicit rented status prevents scoring eligibility, photo work and a new-apartment count',()=>{
 const store=new Store(':memory:');try{
  const listing=listingSchema.parse({source:'easyrent',sourceId:'rented',url:'https://www.easyrent.ca/listings/rented',title:'Previously available suite',address:'100 Example Street',rent:2400,beds:1,available:'Rented',laundry:'in-unit',photos:[{id:'p1',url:'https://www.easyrent.ca/image.jpg',status:'reviewed',kind:'interior',scenery:'nature',quality:4,unitCertain:true}],galleryComplete:true});
  assert.equal(hardFailure(listing,store.criteria),true);assert.equal(scoreListing(listing,store.criteria).eligible,false);
  const plan=createPlan(store,{sources:['easyrent'],billingMode:'chatgpt',maxPages:1,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0,newListingsOnly:true,targetNewListingsPerSource:1});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);
  const budget=new Budget(store,plan.id,plan.caps);assert.equal(ingestNewCandidate(store,budget,'easyrent',listing),null);assert.equal(store.homes().length,0);assert.equal(validationSummary(budget,'easyrent').newListings,0);
  const uncertain={...listing,available:'Unknown',description:'Other suites have already been rented.'};assert.equal(hardFailure(uncertain,store.criteria),false);assert.equal(scoreListing(uncertain,store.criteria).eligible,true);
 }finally{store.close();}
});
