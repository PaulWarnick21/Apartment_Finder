import test from 'node:test';
import assert from 'node:assert/strict';
import {listingSchema} from '../src/domain.ts';
import {enrichListingContext} from '../server/listing-context.ts';
const listing=(description:string,other:Record<string,unknown>={})=>listingSchema.parse({source:'example',sourceId:'1',url:'https://example.test/apartment',title:'One bedroom apartment',address:'100 Example Street',rent:2400,beds:1,description,...other});
test('clear unit-specific parking inclusion and included bundles retain their evidence',()=>{
 const first=enrichListingContext(listing('Comes with 1 spacious secure underground parking'));
 assert.equal(first.parking,'included');assert.equal(first.parkingCount,1);assert.equal(first.parkingCost,null);assert.match(first.evidence.parking,/Comes with/);
 const bundle=enrichListingContext(listing('Suite is fully furnished with all utilities, internet and parking.'));
 assert.equal(bundle.parking,'included');assert.equal(bundle.parkingCount,null);
});
test('only explicit monthly cadence establishes monthly parking cost',()=>{
 const monthly=enrichListingContext(listing('One storage locker is included, and parking is available for an additional $150 per month.'));
 assert.equal(monthly.parking,'extra');assert.equal(monthly.parkingCost,150);
 const ambiguous=enrichListingContext(listing('The building is located near shops, garage parking for $100'));
 assert.equal(ambiguous.parking,'extra');assert.equal(ambiguous.parkingCost,null);assert.match(ambiguous.evidence.parking,/no stated billing frequency/);
 assert.equal(enrichListingContext(listing('Parking: $175/month.')).parkingCost,175);
});
test('optional, street, shared, other-unit and building claims do not establish included private parking',()=>{
 for(const description of ['Optional parking included if requested.','Street parking is included.','Shared parking included.','Other units come with 1 underground parking.','Building amenities include parking.','The building includes underground parking.','All suites include parking.','A parking deposit of $150 per month is required.','Parking not included.','No parking fees are charged.']){
  const result=enrichListingContext(listing(description));assert.equal(result.parking,'unknown',description);assert.equal(result.parkingCost,null,description);
 }
});
test('contradictory and existing disputed parking terms stay unknown',()=>{
 for(const input of [listing('Parking included. Parking is available for $150 per month.'),listing('Parking for $100 per month. Parking for $150 per month.'),listing('Comes with 1 underground parking.',{parking:'extra',parkingCost:100}),listing('Parking included.',{conflicts:['Parking differs across postings.']})]){
  const result=enrichListingContext(input);assert.equal(result.parking,'unknown');assert.equal(result.parkingCost,null);assert.match(result.conflicts.join(' '),/Parking/);
 }
});
test('building/floorplan advertisements cannot enrich parking as an actual unit fact',()=>{
 for(const offeringKind of ['building','floorplan'])assert.equal(enrichListingContext(listing('Comes with 1 underground parking.',{offeringKind})).parking,'unknown');
});
test('studio plus mini-bedroom adds a layout conflict without inventing a bedroom count',()=>{
 const result=enrichListingContext(listing('Gorgeous studio + mini-bedroom + den/office space.'));
 assert.equal(result.beds,1);assert.match(result.conflicts.join(' '),/studio \+ mini-bedroom/);
 assert.deepEqual(enrichListingContext(result).conflicts,result.conflicts);
});
