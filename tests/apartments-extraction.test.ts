import test from 'node:test';
import assert from 'node:assert/strict';
import {extractApartments} from '../server/apartments-extraction.ts';
const image='https://images1.apartments.com/i2/fixture-key/111/example.jpg';
const capture={url:'https://www.apartments.com/example-vancouver-bc/abcdefg/',title:'Example Unit Sample Tower - Condo for Rent',warning:null,truncated:false,advertisedPhotos:20,images:[{url:image+'?p=1'},{url:image},{url:'https://www.apartments.com/logo.png'}],html:`
 <section id="profileHeaderWrapper">Bedrooms 1 Bathrooms 1 Square Feet 650 sq ft</section>
 <section id="descriptionSection"><span class="leaseDepositLabel">12 Month Lease, $1,200 deposit, Available Nov 29</span>
 <p>Fully furnished 1-bedroom, 1-bathroom, 2-den apartment, 690 square feet. Optional one secured parking spot at $150/month. Kitchen with gas stove. Utilities included: internet, cable. Location: 100 Example St, Vancouver Schools nearby: Sample School. Available from December 1st, 2026. Minimum 3-month lease.</p>
 <div id="unitDetailInfoWrapper"><p class="propertyBlurbContent">This listing has rentals from $2400</p></div></section>
 <section id="amenitiesSection">Condo Features Washer/Dryer Dishwasher</section>
 <section id="subMarketSection">Nearby studios from $1000. Ocean, mountains, forests.</section>`};
test('Apartments extraction scopes listing facts, deduplicates media and preserves conflicts',()=>{
 const l=extractApartments(capture);assert.equal(l.rent,2400);assert.equal(l.beds,1);assert.equal(l.baths,1);assert.equal(l.sqft,null);
 assert.equal(l.parkingCost,150);assert.equal(l.parking,'extra');assert.equal(l.parkingCount,1);assert.equal(l.gas,true);assert.equal(l.furnished,true);assert.equal(l.laundry,'in-unit');
 assert.equal(l.shortLease,null);assert.equal(l.conflicts.length,3);assert.equal(l.unit,'');assert.equal(l.address,'100 Example St, Vancouver');
 assert.equal(l.photos.length,1);assert.equal(l.expectedPhotos,20);assert.equal(l.galleryComplete,false);assert.equal(l.allOutlooksCovered,false);assert.equal(l.photos[0].unitCertain,false);
 assert.equal(l.photos[0].scenery,'unknown');assert.equal(l.photos[0].status,'pending');assert.equal(l.modern,null);
 assert.ok(!l.description.includes('Ocean'));assert.equal(l.location,'unknown');
});
test('missing header is recorded, negative amenities do not earn bonuses, invalid captures fail',()=>{
 const l=extractApartments({...capture,html:capture.html.replace(/<section id="profileHeaderWrapper">.*?<\/section>/,'').replace('Fully furnished','Unfurnished').replace('with gas stove','without a gas stove').replace('Condo Features Washer/Dryer Dishwasher','Condo Features Dishwasher')});
 assert.equal(l.sqft,690);assert.match(l.evidence.capture,/header absent/);assert.equal(l.furnished,false);assert.equal(l.gas,false);assert.equal(l.laundry,'unknown');
 assert.throws(()=>extractApartments({...capture,warning:'Access denied'}),/warning/);
 assert.throws(()=>extractApartments({...capture,truncated:true}),/truncated/);
 assert.throws(()=>extractApartments({...capture,html:'<main>Login</main>'}),/description missing/);
 assert.throws(()=>extractApartments({...capture,url:'https://evil.example/'}),/Not an Apartments/);
});
test('explicit no parking and a six-month header are reflected without inferring free parking',()=>{
 const html=capture.html.replace('12 Month Lease','6 Month Lease').replace('Minimum 3-month lease.','').replace('Optional one secured parking spot at $150/month.','No parking.');
 const l=extractApartments({...capture,html});assert.equal(l.parking,'none');assert.equal(l.shortLease,true);
 const optional=extractApartments({...capture,html:html.replace('No parking.','Parking: One parking spot available if desired. (Optional)')});assert.equal(optional.parking,'extra');assert.equal(optional.parkingCost,null);
 const unknown=extractApartments({...capture,html:html.replace('No parking.','Parking not included.')});assert.equal(unknown.parking,'unknown');
});
