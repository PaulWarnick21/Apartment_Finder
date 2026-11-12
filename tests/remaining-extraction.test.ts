import test from 'node:test';
import assert from 'node:assert/strict';
import {extractRemaining} from '../server/remaining-extraction.ts';
test('Zillow binds structured photos to the target property and excludes nearby ads',()=>{
 const property={zpid:123,streetAddress:'100 Example St #5',city:'Vancouver',state:'BC',price:2200,bedrooms:1,bathrooms:1,livingArea:600,description:'1 bedroom, 600 sq ft. In-unit laundry. Gas stove.',resoFacts:{laundryFeatures:['In Unit']},responsivePhotos:[{}],originalPhotos:[{mixedSources:{jpeg:[{width:100,url:'https://photos.zillowstatic.com/small.jpg'},{width:1024,url:'https://photos.zillowstatic.com/large.jpg'}]}}]};
 const next={props:{pageProps:{componentProps:{gdpClientCache:JSON.stringify({target:{property},nearby:{property:{...property,zpid:456,price:900}}})}}}};
 const l=extractRemaining('zillow',`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script>`,'https://www.zillow.com/homedetails/example/123_zpid/');
 assert.equal(l.rent,2200);assert.equal(l.unit,'5');assert.equal(l.photos.length,1);assert.equal(l.photos[0].url,'https://photos.zillowstatic.com/large.jpg');assert.equal(l.laundry,'in-unit');
});
test('Facebook extracts only matching listing fields, excluding account data and recommendations',()=>{
 const target={id:'123',listing_price:{amount:'2400'},marketplace_listing_title:'1 Bed Apartment',redacted_description:{text:'1 bedroom 1 bathroom. Includes 1 parking stall.'},listing_photos:[{image:{uri:'https://scontent.xx.fbcdn.net/listing.jpg'}}]};
 const data={target,other:{...target,id:'456',redacted_description:{text:'OTHER UNIT'},listing_photos:[{image:{uri:'https://scontent.xx.fbcdn.net/other.jpg'}}]},account:{message:'PRIVATE MESSAGE'}};
 const l=extractRemaining('facebook',`<script type="application/json">${JSON.stringify(data)}</script>`,'https://www.facebook.com/marketplace/item/123/');
 assert.equal(l.photos.length,1);assert.equal(l.photos[0].url,'https://scontent.xx.fbcdn.net/listing.jpg');assert.equal(l.parking,'included');assert.ok(!JSON.stringify(l).includes('PRIVATE'));assert.ok(!JSON.stringify(l).includes('OTHER UNIT'));assert.equal(l.address,'');
});
test('REW communal amenities size does not replace apartment area',()=>{
 const ld={'@type':'SingleFamilyResidence',name:'Example',address:{streetAddress:'5-100 Example St',addressLocality:'Downtown'}};
 const html=`<script type="application/ld+json">${JSON.stringify(ld)}</script><div>$2,500/month 1 Bed 1 Bath 600 Sqft</div><div class="propertydetails-description">Enjoy 30,000 sq ft amenities. In-unit laundry.</div><div id="photo-gallery-modal"><img data-src="https://assets-listings.rew.ca/photo.jpg"></div>`;
 const l=extractRemaining('rew',html,'https://www.rew.ca/rentals/123/example');assert.equal(l.sqft,600);assert.equal(l.conflicts.length,0);assert.equal(l.unit,'5');assert.equal(l.photos.length,1);assert.equal(l.laundry,'in-unit');
});
