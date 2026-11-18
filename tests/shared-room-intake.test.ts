import test from 'node:test';
import assert from 'node:assert/strict';
import {listingSchema} from '../src/domain.ts';
import {Store} from '../server/db.ts';
import {createPlan,Budget} from '../server/plans.ts';
import {sharedRoomEvidence,isApartmentUnit} from '../server/listing-rental-scope.ts';
import {ingestNewCandidate,validationAttempt,validationSummary,validationTargetReached} from '../server/new-listing-validation.ts';
import {hardFailure} from '../server/regular-worker.ts';
const listing=(title:string,description='')=>listingSchema.parse({source:'craigslist',sourceId:title,url:'https://example.com/rental',title,address:'',description,rent:2400,beds:2});

test('explicit private-room offers are distinct from whole apartments and shared amenities',()=>{
 for(const l of [listing('Roomate for luxury condo'),listing('Private bedroom for rent'),listing('Suite','Share a 975 sq.ft. furnished suite with the tenant/owner. You get a private bedroom and shared use of the living room and kitchen.')]){assert.ok(sharedRoomEvidence(l));assert.equal(isApartmentUnit(l),false);}
 for(const l of [listing('Two-bedroom apartment','Perfect for two neat roommates looking for a home. Shared pool and gym.'),listing('Private furnished apartment','No roommates. Private in-unit laundry.'),listing('Whole apartment','You do not share the apartment with the owner.'),listing('Roommate-friendly two-bedroom apartment')]){assert.equal(sharedRoomEvidence(l),null);assert.equal(isApartmentUnit(l),true);}
});

test('a shared-room attempt cannot satisfy an apartment target or trigger photo assessment',()=>{const store=new Store(':memory:');try{
 const p=createPlan(store,{sources:['craigslist'],newListingsOnly:true,unitListingsOnly:true,targetNewListingsPerSource:1,maxPages:3,maxListings:3,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0}),budget=new Budget(store,p.id,p.caps),room=listing('Roomate for luxury condo');
 validationAttempt(budget,'craigslist');assert.equal(ingestNewCandidate(store,budget,'craigslist',room),null);assert.equal(validationTargetReached(budget,'craigslist'),false);assert.equal(hardFailure(room,store.criteria),true);assert.equal(store.homes().length,0);
 validationAttempt(budget,'craigslist');assert.ok(ingestNewCandidate(store,budget,'craigslist',listing('Two-bedroom whole apartment')));assert.equal(validationTargetReached(budget,'craigslist'),true);
 const result=validationSummary(budget,'craigslist');assert.equal(result.attemptedListings,2);assert.equal(result.newListings,1);assert.equal(result.skippedRooms,1);
 const prior=store.ingest(room);assert.match(store.home(prior.id)!.score.reasons.join(' '),/Shared accommodation/);
}finally{store.close();}});
