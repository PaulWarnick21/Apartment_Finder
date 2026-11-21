import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractTrial} from '../server/trial-extraction.ts';
import {extractSource} from '../server/regular-worker.ts';
import {sourceById} from '../server/sources.ts';
import {Store} from '../server/db.ts';
import {cardSummary} from '../server/desk-state.ts';
const fixture=(name:string)=>readFileSync('tests/fixtures/'+name+'.html','utf8');
test('EasyRent labeled rows preserve unavailable status and exact unit facts despite adjacent HTML',()=>{
 const html=fixture('easyrent-labeled-status'),source=sourceById('easyrent'),url='https://www.easyrent.ca/listings/example/';
 const l=extractTrial(html,url,source);assert.equal(l.available,'Rented');assert.equal(l.evidence.availability,'Availability: Rented');assert.equal(l.unit,'3707');assert.equal(l.address,'928 Example St. Vancouver, British Columbia');assert.equal(l.beds,1);assert.equal(l.baths,1);assert.equal(l.sqft,515);assert.equal(l.floorLevel,37);assert.equal(l.lease,'1 year lease');assert.equal(l.parkingCount,1);assert.equal(l.photos.length,1);assert.match(l.description,/Bedrooms: 1\nBathrooms: 1/);
 const second=extractTrial(html.replaceAll('3707','1308').replace('37th floor','13th floor').replace('515','505'),url,source);assert.equal(second.unit,'1308');assert.equal(second.floorLevel,13);assert.equal(second.sqft,505);
 const noFloor=extractSource(source,html.replace('37th floor','Not specified'),url);assert.equal(noFloor.floorLevel,null);assert.equal(noFloor.unit,'3707');
 const available=extractTrial(html.replace('Rented','Available December 1'),url,source);assert.equal(available.available,'Available December 1');
});
test('Austeville geography comes from the actual unit header and civic address, not navigation',()=>{
 const html=fixture('austeville-unit-header'),source=sourceById('austeville'),url='https://www.austeville.com/property/example/suite-405/';
 const l=extractSource(source,html,url);assert.equal(l.area,'West Vancouver');assert.equal(l.address,'2020 Example Avenue, West Vancouver, BC V7V 1B8');assert.equal(l.unit,'405');assert.equal(l.location,'outside');assert.equal(l.downtownDistance,'far');assert.equal(l.floorLevel,null);assert.equal(l.rent,2400);assert.equal(l.available,'now');
 const downtown=extractSource(source,html.replaceAll('West Vancouver','Coal Harbour, Vancouver'),url);assert.equal(downtown.location,'downtown');assert.equal(downtown.downtownDistance,'downtown');
});
test('Kijiji displays the advertised price while retaining conflicting monthly prose',()=>{
 const l=extractTrial(fixture('kijiji-monthly-rent-conflict'),'https://www.kijiji.ca/v-apartments-condos/vancouver/example/12345678',sourceById('kijiji'));
 assert.equal(l.rent,2450);assert.match(l.conflicts.join(' '),/\$2450 \/ \$2650/);assert.match(l.evidence.rent,/explicit description monthly rent: \$2650/);assert.equal(l.parkingCount,1);assert.equal(l.parking,'included');assert.equal(l.photos.length,1);
 const store=new Store(':memory:');try{
  const {id}=store.ingest({...l,rent:null,photos:l.photos.map(p=>({...p,local:'saved.jpg',status:'reviewed' as const}))});
  const before=store.update(id,store.home(id)!.revision,{stage:'Interested',notes:'Keep my notes',followUp:'',viewing:'',rescued:false});
  store.ingest(l,{preservePhotos:true});const home=store.home(id)!;
  assert.equal(home.listing.rent,2450);assert.equal(cardSummary(home).listing.rent,2450);
  assert.deepEqual(home.listing.conflicts,l.conflicts);assert.equal(home.stage,before!.stage);assert.equal(home.notes,'Keep my notes');
  assert.equal(store.postingDetails(id)[0].listing.rent,2450);
 }finally{store.close();}
});

test('Kijiji offer fallback retains price, while competing prose-only rates remain unresolved',()=>{
 const html=fixture('kijiji-monthly-rent-conflict'),source=sourceById('kijiji'),url='https://www.kijiji.ca/v-apartments-condos/vancouver/example/12345678';
 const noHeader=html.replace('<span class="price">$2,450</span>','');
 assert.equal(extractSource(source,noHeader,url).rent,2450);
 const proseOnly=noHeader.replace('"offers":{"price":2450},','').replace('$100 CAD per night','$2,450 CAD per month');
 const ambiguous=extractSource(source,proseOnly,url);assert.equal(ambiguous.rent,null);assert.match(ambiguous.conflicts.join(' '),/Monthly rent conflicts/);
});
test('Kijiji zero parking and studio labels survive zero values, while fees do not become rent conflicts',()=>{
 const l=extractTrial(fixture('kijiji-studio-zero-parking'),'https://www.kijiji.ca/v-apartments-condos/vancouver/example/12345679',sourceById('kijiji'));
 assert.equal(l.beds,0);assert.equal(l.parking,'unknown');assert.equal(l.parkingCount,0);assert.equal(l.parkingCost,null);assert.match(l.evidence.parking,/0 parking spaces are included; paid parking availability.*unconfirmed/);assert.equal(l.rent,2000);assert.deepEqual(l.conflicts,[]);
});
