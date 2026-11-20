import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {extractHollyburnOfferings} from '../server/hollyburn-extraction.ts';
import {extractSourceOfferings,runRegularPlan} from '../server/regular-worker.ts';
import {sourceById} from '../server/sources.ts';
import {listingUrl} from '../server/source-discovery.ts';
import {mergeDiscovery,readQueue,inventoryCheckKey} from '../server/discovery-queue.ts';
import {duplicateEvidence,deduplicateHome} from '../server/automatic-duplicates.ts';
import {createPlan,approvePlan,getPlan} from '../server/plans.ts';
import {criteriaSchema} from '../src/domain.ts';
const html=readFileSync('tests/fixtures/hollyburn-building-vacancies.html','utf8');
const url='https://www.hollyburn.com/building/example-house/';

test('building vacancy cards yield distinct stable offers without borrowing building or recommendation facts',()=>{
 const offers=extractHollyburnOfferings(html,url);assert.equal(offers.length,2);
 assert.deepEqual(offers.map(l=>l.sourceId),['vacancy:1001','vacancy:1002']);
 assert.deepEqual(offers.map(l=>l.rent),[2400,3000]);assert.deepEqual(offers.map(l=>l.beds),[1,2]);
 for(const l of offers){assert.equal(l.address,'100 Example Street, Vancouver, BC');assert.equal(l.unit,'');assert.equal(l.offeringKind,'unit');assert.equal(l.parentListingUrl,url);assert.equal(l.furnished,null);assert.equal(l.laundry,'unknown');assert.match(l.conflicts.join(' '),/physical suite number is not published/);assert.ok(l.photos.every(p=>!p.unitCertain&&!p.url.includes('unrelated')));}
 assert.equal(offers[0].photos.length,2);assert.equal(offers[0].expectedPhotos,2);assert.equal(offers[0].galleryComplete,true);assert.match(offers[0].description,/display suites/);
 assert.equal(offers[1].photos.length,1);assert.equal(offers[1].expectedPhotos,2);assert.equal(offers[1].galleryComplete,false);
});

test('missing or ambiguous vacancy identity is never invented and contradictory rent stays unresolved',()=>{
 const noVacancies=html.replaceAll('vacancy_id=','other=');const generic=extractHollyburnOfferings(noVacancies,url);assert.equal(generic.length,1);assert.equal(generic[0].offeringKind,'building');
 const changed=extractHollyburnOfferings(html.replace('<span class="suite-popup__price">$2,400','<span class="suite-popup__price">$2,600'),url);assert.equal(changed[0].rent,null);assert.match(changed[0].conflicts.join(' '),/rent conflicts/);
 const ambiguous=html.replace('href="#suite-popup-1"','href="#unknown-popup"');assert.deepEqual(extractHollyburnOfferings(ambiguous,url).map(l=>l.sourceId),['vacancy:1002']);
});

test('repeated vacancy IDs preserve saved decisions and distinct vacancies do not collapse by building address',()=>{
 const store=new Store(':memory:');try{
  const offers=extractHollyburnOfferings(html,url);const ids=offers.map(l=>store.ingest(l).id);assert.notEqual(ids[0],ids[1]);
  store.db.prepare("UPDATE homes SET notes='Keep this note',stage='Not Interested' WHERE id=?").run(ids[0]);
  assert.deepEqual(extractHollyburnOfferings(html,url).map(l=>store.ingest(l).id),ids);
  assert.equal(store.home(ids[0])!.notes,'Keep this note');assert.equal(store.home(ids[0])!.stage,'Not Interested');
 }finally{store.close();}
});

test('ordinary worker extracts all vacancies and saved building URLs can advertise fresh vacancies in later cycles',()=>{
 const source=sourceById('hollyburn');assert.equal(listingUrl(url,source),url);
 const offers=extractSourceOfferings(source,html,url);assert.equal(offers.length,2);
 const store=new Store(':memory:');try{
  offers.forEach(l=>store.ingest(l));let queue=readQueue(store,'hollyburn');
  mergeDiscovery(store,'hollyburn',queue,[{url}],source.search);assert.deepEqual(queue.urls,[url]);
  store.set(inventoryCheckKey('hollyburn',url),new Date().toISOString());queue={urls:[],next:null};
  mergeDiscovery(store,'hollyburn',queue,[{url}],source.search);assert.deepEqual(queue.urls,[]);
  store.set(inventoryCheckKey('hollyburn',url),new Date(Date.now()-86400001).toISOString());
  mergeDiscovery(store,'hollyburn',queue,[{url}],source.search);assert.deepEqual(queue.urls,[url]);
 }finally{store.close();}
});

test('representative galleries shared across different advertised vacancies cannot trigger automatic merging',()=>{
 const [a,b]=extractHollyburnOfferings(html,url);
 // Even stronger old photo metadata on one side cannot turn a representative
 // building gallery into proof that two vacancy IDs refer to the same suite.
 const shared=[0,1,2,3].map(i=>({...a.photos[0],id:String(i),url:`https://portal.hollyburn.com/img/suite-images/shared-${i}.jpg`,hash:`shared-${i}`,kind:'interior' as const,unitCertain:true,note:''}));
 a.photos=shared;b.photos=shared;b.beds=a.beds;b.rent=a.rent;
 assert.equal(duplicateEvidence(a,b),undefined);
 const store=new Store(':memory:');try{const first=store.ingest(a).id,second=store.ingest(b).id;assert.equal(deduplicateHome(store,second),undefined);assert.notEqual(first,second);assert.equal(store.homes().length,2);}finally{store.close();}
});

test('new-only worker revisits a due building, imports its unseen vacancy and leaves the saved vacancy unchanged',async()=>{
 const store=new Store(':memory:'),source=sourceById('hollyburn'),search='https://www.hollyburn.com/find-an-apartment/?city=Vancouver',visits:string[]=[];
 try{
  store.set('reviewWorkflow',{mode:'quick-first'});store.set('criteria',criteriaSchema.parse({requireLaundry:false,quickIntake:{minRent:1000,maxRent:3500,minPhotos:0,allowedBeds:[1,2]}}));
  store.set('searchAreaPolicy',{mode:'source-filters',regions:['downtown-vancouver'],existingHomeIds:[],configuredAt:'test',sourceRoutes:{hollyburn:[{url:search,region:'downtown-vancouver',scope:'vancouver-approximate'}]}});
  const old=store.ingest(extractHollyburnOfferings(html,url)[0]).id;
  store.db.prepare("UPDATE homes SET stage='Not Interested',notes='Keep decision' WHERE id=?").run(old);
  const before=store.db.prepare('SELECT listing,notes,stage FROM homes WHERE id=?').get(old);
  store.set(inventoryCheckKey(source.id,url),new Date(Date.now()-25*3600000).toISOString());
  const plan=createPlan(store,{sources:[source.id],assessmentMode:'quick',newListingsOnly:true,unitListingsOnly:true,targetNewListingsPerSource:1,maxPages:2,maxListings:1,maxPhotos:0,maxAiCalls:0,maxAddressLookups:0,maxReservedUsd:0});approvePlan(store,plan.id,'APPROVE ONE SCAN');
  await runRegularPlan(store,plan.id,mkdtempSync(join(tmpdir(),'hollyburn-new-')),undefined,{session:(_source,b)=>({stopped:false,start:async()=>{},close:async()=>{},html:async u=>{b.reserve('pages');visits.push(u);assert.ok([search,url].includes(u));return u===search?`<a href="${url}">Example House</a>`:html;},resource:async()=>{throw Error('Unexpected resource');},image:async()=>{throw Error('No image allowance');}}),review:async()=>{throw Error('No AI allowance');}});
  assert.deepEqual(visits,[search,url]);assert.equal(store.homes().length,2);
  assert.equal(store.homes().find(h=>h.id!==old)!.listing.sourceId,'vacancy:1002');
  assert.deepEqual(store.db.prepare('SELECT listing,notes,stage FROM homes WHERE id=?').get(old),before);
  assert.equal(getPlan(store,plan.id).sources[0].newListings,1);
 }finally{store.close();}
});
