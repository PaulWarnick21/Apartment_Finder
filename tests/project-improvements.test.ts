import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {listingSchema,criteriaSchema} from '../src/domain.ts';
import {patchPreferences,preferencesRevision} from '../server/preferences.ts';
import {editedPreferences} from '../src/preferences-patch.ts';
import {PublicConnectionStatus} from '../server/public-connection.ts';
import {cardSummary} from '../server/desk-state.ts';
import {enrichListingContext} from '../server/listing-context.ts';
import {recurringCosts} from '../src/listing-costs.ts';
import {neighbourhoodAt} from '../server/geography.ts';
import {BuildingResearchService,matchingPermits} from '../server/building-research.ts';
import type {LocationMaps} from '../server/location-map.ts';
const listing=()=>listingSchema.parse({source:'fixture',sourceId:'1',url:'https://example.test/unit',title:'Fixture',address:'100 Example Street, Vancouver',unit:'2',rent:2500,beds:1,description:'Private listing description',photos:[{id:'p',url:'https://example.test/image.jpg',local:'fixture.jpg',status:'reviewed',kind:'interior',scenery:'nature',unitCertain:true,quality:4}],galleryComplete:true});

test('preference edits preserve unrelated learning and stale revisions cannot overwrite it',()=>{
 const store=new Store(':memory:');try{const before=store.criteria,revision=preferencesRevision(before),edited=criteriaSchema.parse({...before,maxRent:3500});assert.deepEqual(editedPreferences(before,edited),{maxRent:3500});
 store.set('criteria',{...before,priceSlope:.0006});assert.throws(()=>patchPreferences(store,{revision,changes:editedPreferences(before,edited)}),/changed/);
 patchPreferences(store,{revision:preferencesRevision(store.criteria),changes:{maxRent:3500}});assert.equal(store.criteria.priceSlope,.0006);assert.equal(store.criteria.maxRent,3500);
 assert.throws(()=>patchPreferences(store,{revision:preferencesRevision(store.criteria),changes:{learnedExamples:[]}}));
 }finally{store.close();}
});
test('public connection status coalesces reads, invalidates, and isolates vault failure',async()=>{
 let calls=0;const status={connected:false,sharing:false,model:'',models:[],active:'',profiles:[],pending:false,message:''};const cache=new PublicConnectionStatus(async()=>{calls++;return status;});
 await Promise.all([cache.get(),cache.get(),cache.get()]);assert.equal(calls,1);cache.invalidate();await cache.get();assert.equal(calls,2);
 const unavailable=await new PublicConnectionStatus(async()=>{throw new Error('Do not leak private failure details');}).get();assert.match(unavailable.message,/Saved apartments/);assert.ok(!unavailable.message.includes('private failure'));assert.equal(unavailable.sharing,false);
});
test('compact cards retain decision facts and lead image but omit full evidence',()=>{
 const store=new Store(':memory:');try{const input=listing();input.photos[0].local='saved.jpg';const id=store.ingest(input).id,home=store.home(id)!,card=cardSummary(home);assert.equal(card.summaryOnly,true);assert.equal(card.listing.description,'');assert.equal(card.listing.photos.length,1);assert.equal(card.score.value,home.score.value);assert.equal(card.revision,home.revision);assert.equal(store.home(id)!.listing.description,'Private listing description');}finally{store.close();}
});
test('known monthly costs keep explicit fees separate from optional fees, deposits, and ceiling basis',()=>{
 const input={...listing(),parking:'extra' as const,parkingCost:100,description:'Mandatory monthly utilities fee: $80 per month. Optional storage fee $50 monthly. Required refundable deposit $500. Available December 1, 2026.'};
 const enriched=enrichListingContext(input),cost=recurringCosts(enriched);assert.equal(cost.knownMonthlyTotal,2680);assert.equal(enriched.monthlyCharges?.length,1);assert.equal(enriched.available,'December 1, 2026');assert.ok(cost.unknown.length);assert.equal(enriched.rent,2500);
});
test('official neighbourhood polygons classify known downtown and west-side points without inventing out-of-city matches',()=>{
 assert.equal(neighbourhoodAt(49.2827,-123.1207),'Downtown');assert.equal(neighbourhoodAt(49.285,-123.135),'West End');assert.equal(neighbourhoodAt(49.266,-123.165),'Kitsilano');assert.equal(neighbourhoodAt(51.05,-114.07),null);
});
test('public records require exact civic address and retain historical meaning',()=>{
 const records=matchingPermits({total_count:2,results:[{permitnumber:'TEST1',address:'100 EXAMPLE ST, Vancouver',issuedate:'2025-01-01',projectdescription:'Repair'},{permitnumber:'TEST2',address:'1000 Example St, Vancouver',issuedate:'2025-01-01'}]},'100 Example Street, Vancouver');assert.equal(records.rows.length,1);assert.equal(records.rows[0].number,'TEST1');
});
test('building research is explicit, bounded, cached, and preserves user decisions',async()=>{
 const store=new Store(':memory:');try{const id=store.ingest(listing()).id;store.update(id,store.home(id)!.revision,{stage:'Interested',notes:'Keep these notes',followUp:'',viewing:'',rescued:false});
 let maps=0,requests=0;const service=new BuildingResearchService(store,{get:async()=>{maps++;return {status:'ready',label:'100 Example Street',lat:49.2827,lon:-123.1207,approximate:false};}} as unknown as LocationMaps,false,async url=>{requests++;assert.match(String(url),/^https:\/\/opendata.vancouver.ca/);assert.ok(!String(url).includes('Keep these notes'));return new Response(JSON.stringify({total_count:1,results:[{permitnumber:'TEST',address:'100 Example Street, Vancouver',issuedate:'2025-01-01',projectdescription:'Historical repair'}]}));});
 assert.equal(service.saved(store.home(id)!.listing).research,null);assert.equal(requests,0);await assert.rejects(service.run(id,'yes'),/Approve/);assert.equal(maps,0);
 const result=await service.run(id,'APPROVE TWO PUBLIC RESEARCH REQUESTS');assert.equal(result.requestCount,2);assert.equal(result.permits.length,1);assert.match(result.notes.join(' '),/not proof/);assert.equal(store.home(id)!.notes,'Keep these notes');assert.equal(store.home(id)!.stage,'Interested');assert.equal(store.home(id)!.listing.area,'Downtown');
 await service.run(id,'APPROVE TWO PUBLIC RESEARCH REQUESTS');assert.equal(requests,1);assert.equal(maps,1);
 }finally{store.close();}
});
test('building research never requests records for an approximate address and demo remains offline',async()=>{
 const store=new Store(':memory:');try{const id=store.ingest(listing()).id;let calls=0;const maps={get:async()=>({status:'ready',approximate:true,lat:49.2827,lon:-123.1207})} as unknown as LocationMaps;
 const service=new BuildingResearchService(store,maps,false,async url=>{calls++;assert.match(String(url),/geocoder.api.gov.bc.ca/);return new Response(JSON.stringify({features:[]}));});assert.equal((await service.run(id,'APPROVE TWO PUBLIC RESEARCH REQUESTS')).status,'unavailable');assert.equal(calls,1);
 await assert.rejects(new BuildingResearchService(store,maps,true).run(id,'APPROVE TWO PUBLIC RESEARCH REQUESTS'),/offline/);
 }finally{store.close();}
});
