import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseListing} from '../server/parsers.ts';
import {extractSource} from '../server/regular-worker.ts';
import {sourceById} from '../server/sources.ts';
import {enrichListingContext} from '../server/listing-context.ts';
const source=sourceById('craigslist'),url='https://www.craigslist.org/view/d/example/abcdef';
const fixture=(name:string)=>readFileSync(`tests/fixtures/${name}.html`,'utf8');
test('Craigslist posting location and first-line unit address outrank travel and amenity copy',()=>{
 const l=extractSource(source,fixture('craigslist-scoped-surrey'),url);
 assert.equal(l.address,'13350 Example Avenue');assert.equal(l.unit,'810');assert.equal(l.area,'Central Surrey');assert.equal(l.location,'outside');assert.equal(l.downtownDistance,'far');assert.equal(l.floorLevel,null);assert.equal(l.workspace,null);
 assert.match(l.evidence.address,/Property introduction/);assert.match(l.evidence.location,/Surrey/);
});
test('explicit introduction floor is retained without inventing a unit number or usable office',()=>{
 const l=extractSource(source,fixture('craigslist-scoped-floor'),url);
 assert.equal(l.address,'1277 Example Street');assert.equal(l.unit,'');assert.equal(l.area,'Yaletown');assert.equal(l.location,'downtown');assert.equal(l.floorLevel,21);assert.equal(l.workspace,null);assert.match(l.evidence.workspace,/advertised.*unverified/);
 assert.equal(l.parking,'extra');assert.equal(l.parkingCost,250);assert.match(l.conflicts.join(' '),/Parking availability conflicts/);assert.match(l.evidence.parking,/no parking.*250 Per Month/);
 const enriched=enrichListingContext(l);assert.equal(enriched.parking,'unknown');assert.equal(enriched.parkingCost,null);assert.match(enriched.evidence.parking,/no parking.*250 Per Month/);
});
test('mapaddress remains authoritative and absent headers do not borrow facts from unrelated copy',()=>{
 const html=fixture('craigslist-scoped-surrey'),mapped=parseListing(html+'<div class="mapaddress">500 Existing Road</div>',url,source);assert.equal(mapped.address,'500 Existing Road');assert.equal(mapped.evidence.address,undefined);
 const unrelated=html.replace('<span> (Central Surrey)</span>','').replace('Example Tower--810, 13350 Example Avenue Central Surrey North Surrey','Shared gym--42nd Floor, 500 Amenity Street');
 const l=extractSource(source,unrelated,url);assert.equal(l.address,'');assert.equal(l.area,'Unknown');assert.equal(l.location,'unknown');assert.equal(l.downtownDistance,'unknown');assert.equal(l.floorLevel,null);assert.equal(l.workspace,null);
});
