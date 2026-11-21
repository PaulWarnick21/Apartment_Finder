import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Store} from '../server/db.ts';
import {listingSchema} from '../src/domain.ts';
import {sameRentalEvidence,savedCrossPosts,mergeLiveCrossPost} from '../server/availability-crossposts.ts';
import {availabilityRedirectMatches,inspectAvailability} from '../server/availability-parser.ts';
import {sourceById} from '../server/sources.ts';
import {extractZumperOfferings} from '../server/zumper-extraction.ts';
import {runAvailabilityCheck,dailyAvailabilityLimits} from '../server/availability-monitor.ts';

const words=Array.from({length:110},(_,i)=>`specific${i}`).join(' ');
const listing=(source='craigslist',sourceId='one')=>listingSchema.parse({source,sourceId,url:`https://${source==='craigslist'?'www.craigslist.org/view/d/example':'www.zumper.com/listings'}/${sourceId}`,title:'Example rental',address:'100 Example Street',unit:'12',rent:2150,beds:1,baths:1,sqft:428,description:words});
test('cross-post search includes separately rejected records and rejects different units/explicit decisions',()=>{
 const store=new Store(':memory:');try{
  const a=listing();a.address='google map';a.unit='';a.evidence.researchedAddress='100 Example Street';
  const b=listing('zumper','two'),id=store.ingest(a).id,peer=store.ingest(b).id;
  store.db.prepare("UPDATE homes SET stage='Not Interested' WHERE id=?").run(peer);
  assert.ok(sameRentalEvidence(a,b));assert.equal(savedCrossPosts(store,id)[0].homeId,peer);
  assert.equal(sameRentalEvidence({...a,unit:'13'},b),undefined);
  assert.equal(sameRentalEvidence({...a,description:'Great building'},b),undefined);
  assert.equal(sameRentalEvidence({...a,sqft:800},b),undefined);
  store.db.prepare('INSERT INTO duplicate_decisions VALUES (?,?,?)').run(Math.min(id,peer),Math.max(id,peer),'different');
  assert.deepEqual(savedCrossPosts(store,id),[]);
 }finally{store.close();}
});
test('live cross-post merge keeps the requested apartment, photos, decisions, tags, research and rating history',()=>{
 const store=new Store(':memory:');try{
  const a=listing(),b=listing('zumper','two');b.rent=2200;
  a.photos=listingSchema.parse({...a,photos:[{id:'saved',url:'https://example.test/photo',status:'reviewed',kind:'interior',unitCertain:true,note:'Saved assessment'}]}).photos;
  a.evidence.galleryReview='Saved gallery review';a.evidence.locationSource='Verified location';a.evidence.location='Downtown';a.modern=true;
  const id=store.ingest(a).id,peer=store.ingest({...b,address:'Initially missing address'}).id;
  store.db.prepare('UPDATE homes SET listing=? WHERE id=?').run(JSON.stringify(b),peer);
  store.db.prepare("UPDATE homes SET stage='Serious Candidates',notes='Keep',tag_unfurnished=1,revisit_later=1 WHERE id=?").run(id);
  store.db.prepare("UPDATE homes SET stage='Not Interested',notes='Other note' WHERE id=?").run(peer);
  const before=store.home(id)!;
  const at=new Date().toISOString();
  mergeLiveCrossPost(store,id,peer,b,{source:b.source,sourceId:b.sourceId,url:b.url,status:'available',checkedAt:at,runId:'test',evidence:'Same unit is advertised'},true);
  const after=store.home(id)!;
  assert.equal(store.resolveHomeId(peer),id);assert.equal(after.stage,before.stage);assert.equal(after.revisitLater,true);assert.equal(after.tagUnfurnished,true);
  assert.match(after.notes,/Keep/);assert.match(after.notes,/Other note/);assert.equal(after.listing.source,'zumper');assert.equal(after.listing.rent,2200);
  assert.deepEqual(after.listing.photos,before.listing.photos);assert.equal(after.listing.modern,true);assert.equal(after.listing.evidence.galleryReview,'Saved gallery review');assert.equal(after.listing.evidence.locationSource,'Verified location');
  assert.equal(after.availability?.status,'available');assert.equal(after.postings.length,2);
 }finally{store.close();}
});
test('Zumper unit-specific address redirects retain identity; sibling redirects and missing active units do not',()=>{
 const html=readFileSync('tests/fixtures/zumper-address-unit-identity.html','utf8'),url='https://www.zumper.com/listings/29823489p/1-bedroom-riley-park-little-mountain-vancouver-bc';
 const saved=extractZumperOfferings(html,url)[0],source=sourceById('zumper');
 const final='https://www.zumper.com/address/100-example-st-vancouver-bc-can?listing_id=l-29823489p';
 assert.equal(availabilityRedirectMatches(html,source,saved,final),true);
 assert.equal(availabilityRedirectMatches(html,source,saved,final.replace('29823489p','29823488p')),false);
 assert.equal(availabilityRedirectMatches(html,source,saved,final.split('?')[0]),false);
 assert.equal(inspectAvailability(html,source,saved).status,'available');
 assert.equal(inspectAvailability(html.replaceAll('65552318','65552319'),source,saved).status,'unknown');
});

test('a live cross-post merge can be undone immediately while later user edits still prevent a split',()=>{
 for(const edited of [false,true]){
  const store=new Store(':memory:');try{
   const a=listing(),b=listing('zumper','two'),id=store.ingest(a).id;
   const peer=store.ingest({...b,address:'Initially missing address'}).id;
   store.db.prepare('UPDATE homes SET listing=? WHERE id=?').run(JSON.stringify(b),peer);
   store.db.prepare("UPDATE homes SET stage='Interested',notes='Original note' WHERE id=?").run(id);
   const before=store.home(id)!;
   mergeLiveCrossPost(store,id,peer,b,{source:b.source,sourceId:b.sourceId,url:b.url,status:'available',checkedAt:new Date().toISOString(),runId:'test',evidence:'Same unit advertised'});
   const mergeId=Number((store.mergeHistory(id)[0] as {id:number}).id);
   if(edited){
    const home=store.home(id)!;store.update(id,home.revision,{stage:home.stage,notes:'New user note',followUp:home.followUp,viewing:home.viewing,rescued:home.rescued});
    assert.throws(()=>store.splitMerge(mergeId),/changed after merge/);
    assert.equal(store.home(id)!.notes,'New user note');
   }else{
    store.splitMerge(mergeId);
    assert.equal(store.resolveHomeId(peer),peer);
    assert.deepEqual(store.home(id)!.listing,before.listing);
    assert.equal(store.home(id)!.notes,before.notes);
    assert.equal(store.home(id)!.stage,before.stage);
    assert.equal(store.home(id)!.postings.length,1);
   }
  }finally{store.close();}
 }
});

const liveUrl='https://www.zumper.com/listings/42p/1-bedroom-downtown-vancouver-vancouver-bc';
const liveHtml=`<html><body><script>window.__PRELOADED_STATE__ = ${JSON.stringify({detail:{entity:{data:{listing_id:4242,pl_id:42,url:'/listings/42p/1-bedroom-downtown-vancouver-vancouver-bc',address:'100 Example Street #12',bedrooms:1,bathrooms:1,price:2150,min_price:2150,square_feet:428,description:words,listing_status:1}}}})};</script></body></html>`;
const expiredHtml='<div class="removed">This posting has expired.</div>';
function scheduled(store:Store){store.set('availabilitySchedule',{enabled:true,timeZone:'America/Toronto',hour:12,authorizedAt:'2026-11-19T15:00:00Z',notBefore:'2026-11-19T17:00:00Z'});}
function seedExpired(store:Store){const a=listing();a.address='google map';a.unit='';a.evidence.researchedAddress='100 Example Street';const id=store.ingest(a).id;store.db.prepare("UPDATE homes SET stage='Serious Candidates',notes='Keep decision' WHERE id=?").run(id);scheduled(store);return id;}
test('expiry monitor finds a separately rejected live cross-post and merges it without discovery or AI',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-20T17:00:00Z')});const store=new Store(':memory:');
 try{
  const id=seedExpired(store),live=extractZumperOfferings(liveHtml,liveUrl)[0],peer=store.ingest(live).id;
  store.db.prepare("UPDATE homes SET stage='Not Interested' WHERE id=?").run(peer);const visits:string[]=[];
  const result=await runAvailabilityCheck(store,'unused',undefined,{searchRoutes:()=>{throw Error('Saved matching live ad should avoid discovery');},session:(_s,b)=>({start:async()=>{},html:async url=>{b.reserve('pages');visits.push(url);return url===liveUrl?liveHtml:expiredHtml;},close:async()=>{}})});
  assert.equal(result?.state,'complete');assert.equal(visits.length,2);assert.equal(store.resolveHomeId(peer),id);
  const home=store.home(id)!;assert.equal(home.availability?.status,'available');assert.equal(home.listing.source,'zumper');assert.equal(home.listing.unit,'12');assert.equal(home.stage,'Serious Candidates');assert.equal(home.notes,'Keep decision');
  const plan=store.db.prepare('SELECT usage FROM plans WHERE id=?').get(result!.planId!) as {usage:string};assert.equal(JSON.parse(plan.usage).aiCalls,0);assert.equal(JSON.parse(plan.usage).photos,0);
 }finally{store.close();}
});
test('expiry monitor checks another source search and attaches only a verified matching live unit',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-20T17:00:00Z')});const store=new Store(':memory:');
 try{
  const id=seedExpired(store),search='https://www.zumper.com/apartments-for-rent/vancouver-bc';const visits:string[]=[];
  const result=await runAvailabilityCheck(store,'unused',undefined,{searchRoutes:()=>[{source:'zumper',url:search}],session:(_s,b)=>({start:async()=>{},html:async url=>{b.reserve('pages');visits.push(url);return url===search?`<a href="${liveUrl}">100 Example Street 1 bedroom $2150</a>`:url===liveUrl?liveHtml:expiredHtml;},close:async()=>{}})});
  assert.equal(result?.state,'complete');assert.equal(visits.length,3);assert.equal(result?.searchPages,1);
  const home=store.home(id)!;assert.equal(home.availability?.status,'available');assert.equal(home.listing.url,liveUrl);assert.equal(home.postings.length,2);assert.equal(store.homes().length,1);
 }finally{store.close();}
});
test('expired listings stay unverified when cross-source recovery exhausts the shared page allowance',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-20T17:00:00Z')});const store=new Store(':memory:'),limit=dailyAvailabilityLimits.maxPages;
 try{
  const id=seedExpired(store);store.ingest(extractZumperOfferings(liveHtml,liveUrl)[0]);dailyAvailabilityLimits.maxPages=1;let visits=0;
  const result=await runAvailabilityCheck(store,'unused',undefined,{session:(_s,b)=>({start:async()=>{},html:async()=>{b.reserve('pages');visits++;return expiredHtml;},close:async()=>{}})});
  assert.equal(visits,1);assert.equal(result?.state,'partial');assert.equal(store.home(id)!.availability?.status,'unknown');assert.equal(store.homes().length,2);
 }finally{dailyAvailabilityLimits.maxPages=limit;store.close();}
});
test('explicit closure on all linked sources permits an unavailable conclusion after cross-source checks',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-20T17:00:00Z')});const store=new Store(':memory:');
 try{
  const id=seedExpired(store),live=extractZumperOfferings(liveHtml,liveUrl)[0],peer=store.ingest(live).id;
  store.mergeHomes(id,peer,undefined,{preserveCanonical:true});
  const result=await runAvailabilityCheck(store,'unused',undefined,{session:(_s,b)=>({start:async()=>{},html:async()=>{b.reserve('pages');return '<h1>This listing has expired.</h1>';},close:async()=>{}})});
  assert.equal(result?.state,'complete');assert.equal(store.home(id)!.availability?.status,'unavailable');
 }finally{store.close();}
});
