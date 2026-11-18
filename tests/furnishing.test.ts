import test from 'node:test';
import assert from 'node:assert/strict';
import {extractFurnishing,furnishingForListing} from '../src/furnishing.ts';
import {listingSchema} from '../src/domain.ts';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FurnishingBadge} from '../src/furnishing-badge.tsx';
import {scoringFacts} from '../server/scoring-facts.ts';
import {criteriaSchema} from '../src/domain.ts';
import {scoreBase} from '../server/scoring.ts';
test('price badges distinguish included furniture, unfurnished and unresolved terms',()=>{
 for(const [description,label] of [['Fully furnished apartment','Furnished'],['This apartment is unfurnished','Unfurnished'],['Partially furnished condo','Partly furnished'],['Unfurnished or furnished apartment','Furnishing optional'],['Furniture visible in photos','Assumed unfurnished'],['','Furnishing not confirmed']]){
  const listing=listingSchema.parse({source:'fixture',sourceId:'1',url:'https://example.test/1',title:'Apartment',address:'Example',rent:3200,beds:1,description});
  assert.match(renderToStaticMarkup(createElement(FurnishingBadge,{listing})),new RegExp(label));
 }
});
test('explicit furnishing claims retain their listing evidence',()=>{
 for(const text of ['This fully furnished condo is available.','Furnished 1 Bedroom - city view','This furnished two-bedroom apartment','Furniture is included.']){const f=extractFurnishing(text);assert.equal(f.value,true,text);assert.ok(text.includes(f.statement));}
 for(const text of ['Rent Unfurnished: $2400','FurnishedNoAppliancesLaundry','The apartment is not furnished.','Furniture is not included.'])assert.equal(extractFurnishing(text).value,false,text);
});
test('staged photos, shared guest suites, optional furniture and conflicts earn no furnishing bonus',()=>{
 for(const text of ['Photos show a fully furnished apartment.','Amenities include a fully furnished guest suite with WiFi.','A furnished guest suite is available.','Unfurnished or Furnished 1 bedroom apartment','Partially furnished condo','Furniture available at an additional cost','Fully furnished condo. Furniture is not included.','The apartment is fully furnished for photos.','Advertised floor-plan amenities: Dishwasher, Furnished, Balcony.'])assert.equal(extractFurnishing(text).value,null,text);
});
test('building-wide unfurnished lease terms do not override a specific furnished rental',()=>{
 const f=extractFurnishing('About this rental Share This furnished one-bedroom apartment includes furniture. The Building Minimum terms: one year for unfurnished units. Frequently Asked Questions');assert.equal(f.value,true);
});
test('display ignores photo-based booleans and accepts explicit structured statements',()=>{
 const l=listingSchema.parse({source:'fixture',sourceId:'1',url:'https://example.com/1',title:'Apartment',address:'Example',rent:2500,beds:1,description:'Beautiful views and a spacious kitchen.',furnished:true,evidence:{furnished:'Furniture visible in photos'}});
 assert.equal(furnishingForListing(l).value,false);assert.equal(furnishingForListing(l).assumed,true);assert.equal(furnishingForListing({...l,evidence:{furnished:'Furnished: Yes'}}).value,true);
 assert.equal(furnishingForListing({...l,description:'Unfurnished',evidence:{furnished:'Furnished: Yes'}}).value,null);
 assert.match(furnishingForListing({...l,description:'Fully furnished condo',conflicts:['Display-suite photos; exact unit unverified']}).note,/specific unit/);
});

test('description silence defaults to unfurnished in scoring without inventing an explicit claim',()=>{
 const l=listingSchema.parse({source:'fixture',sourceId:'silent',url:'https://example.test/silent',title:'Apartment',address:'Example',rent:3200,beds:1,description:'A one-bedroom apartment with laundry, parking and a balcony.',furnished:true});
 const facts=scoringFacts(l),c=criteriaSchema.parse({});
 assert.equal(facts.furnished,false);assert.match(facts.evidence.furnishingBasis,/Assumed unfurnished/);
 assert.equal(l.furnished,true,'raw saved facts remain unchanged');
 assert.ok(!scoreBase(l,c).adjustments.some(a=>a.label==='Furnished'));
 const explicit={...l,furnished:null,description:'This fully furnished apartment includes all furniture.'};
 assert.equal(scoringFacts(explicit).furnished,true);
 assert.ok(scoreBase(explicit,c).adjustments.some(a=>a.label==='Furnished'));
 for(const description of ['Partially furnished condo','Furniture available at an additional cost','Fully furnished condo. Furniture is not included.'])assert.equal(scoringFacts({...l,description}).furnished,null);
});

test('missing and visibly truncated descriptions remain unresolved rather than assumed unfurnished',()=>{
 const l=listingSchema.parse({source:'fixture',sourceId:'missing',url:'https://example.test/missing',title:'Apartment',address:'Example',rent:3200,beds:1});
 for(const description of ['', 'A bright apartment with…', 'A bright apartment...', 'x'.repeat(50000)])assert.equal(furnishingForListing({...l,description}).value,null);
});
