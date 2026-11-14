import test from 'node:test';
import assert from 'node:assert/strict';
import {extractFurnishing,furnishingForListing} from '../src/furnishing.ts';
import {listingSchema} from '../src/domain.ts';
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
 assert.equal(furnishingForListing(l).value,null);assert.equal(furnishingForListing({...l,evidence:{furnished:'Furnished: Yes'}}).value,true);
 assert.equal(furnishingForListing({...l,description:'Unfurnished',evidence:{furnished:'Furnished: Yes'}}).value,null);
 assert.match(furnishingForListing({...l,description:'Fully furnished condo',conflicts:['Display-suite photos; exact unit unverified']}).note,/specific unit/);
});
