import test from 'node:test';
import assert from 'node:assert/strict';
import {extractZumper} from '../server/zumper-extraction.ts';
import {scoreListing} from '../server/scoring.ts';
import {criteriaSchema,listingSchema} from '../src/domain.ts';
const html=(floorplan_listings:unknown[])=>`<script>window.__PRELOADED_STATE__ = ${JSON.stringify({detail:{entity:{data:{name:'Example',floorplan_listings}}}})};</script>`;
test('Zumper skips a $1 placeholder when another priced one-bedroom is advertised',()=>{const l=extractZumper(html([{listing_id:1,title:'Junior one bedroom',bedrooms:1,min_price:1},{listing_id:2,title:'One bedroom',bedrooms:1,min_price:2147}]),'https://www.zumper.com/apartment-buildings/p1/example');assert.equal(l.rent,2147);assert.equal(l.sourceId,'2');assert.throws(()=>extractZumper(html([{listing_id:1,bedrooms:1,min_price:1}]),'https://www.zumper.com/apartment-buildings/p1/example'),/No priced/);});
test('a captured placeholder price can never promote a listing as affordable',()=>{const l=listingSchema.parse({source:'zumper',sourceId:'1',url:'https://www.zumper.com/apartment-buildings/p1/example',title:'Example',address:'123 Example',beds:1,rent:1,photos:[]});const s=scoreListing(l,criteriaSchema.parse({}));assert.ok(s.value<3);assert.ok(s.reasons.some(r=>r.startsWith('Placeholder price')));l.rent=null;l.evidence.rentPlaceholder='true';assert.ok(scoreListing(l,criteriaSchema.parse({})).value<3);});


test('non-rental records are excluded even when their numeric price looks desirable',()=>{const l=listingSchema.parse({source:'craigslist',sourceId:'bad',url:'https://www.craigslist.org/view/d/appliance/abc',title:'Washer',address:'',beds:null,rent:500,evidence:{nonRental:'true'}});const s=scoreListing(l,criteriaSchema.parse({}));assert.equal(s.eligible,false);assert.ok(s.value<3);assert.ok(s.reasons.includes('Not an apartment rental'));});
