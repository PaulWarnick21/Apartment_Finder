import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {monthsBefore,postingAgeRank,parsePostingDate,detailPostingDate,sourcePostingDates} from '../server/listing-age.ts';
import {discoveryCards,prioritizeCards} from '../server/source-discovery.ts';
import {balanceQueue,mergeDiscovery,readQueue,saveQueue} from '../server/discovery-queue.ts';
import {sourceById} from '../server/sources.ts';
import {Store} from '../server/db.ts';
import {listingSchema} from '../src/domain.ts';
import {createPlan,approvePlan,getPlan} from '../server/plans.ts';
import {runRegularPlan,pendingHomes,type ScanDependencies} from '../server/regular-worker.ts';
import {runApartmentsSource} from '../server/apartments-worker.ts';
import type {ChromeJobClient,ChromeSnapshot} from '../server/chrome-jobs.ts';

const now=Date.parse('2026-11-16T12:00:00Z'),cutoff='2026-08-16T12:00:00.000Z';
const source=sourceById('craigslist'),oldUrl='https://vancouver.craigslist.org/van/apa/d/old/1234567890.html',freshUrl='https://vancouver.craigslist.org/van/apa/d/fresh/1234567891.html';
const fixture=readFileSync('tests/fixtures/craigslist.html','utf8');
test('posting age uses three calendar months with an exclusive cutoff and neutral unknowns',()=>{
 assert.equal(new Date(monthsBefore(now,3)).toISOString(),cutoff);
 assert.equal(postingAgeRank(cutoff,3,now),0);assert.equal(postingAgeRank('2026-08-16T11:59:59Z',3,now),1);
 for(const date of [undefined,'invalid','2027-01-01','2026-02-30'])assert.equal(postingAgeRank(date,3,now),0);
 assert.equal(new Date(monthsBefore(Date.parse('2026-05-31T12:00:00Z'),3)).toISOString(),'2026-02-28T12:00:00.000Z');
 assert.equal(parsePostingDate('Listed 8 months ago',now),'2026-03-16T12:00:00.000Z');
 assert.equal(parsePostingDate('Listed over a week ago',now),undefined);
 assert.equal(parsePostingDate('2026-02-30',now),undefined);
 assert.equal(parsePostingDate('2026-03-16T23:00:00-07:00',now),'2026-03-17T06:00:00.000Z');
 assert.equal(parsePostingDate('Available December 1',now),undefined);
});
test('old ads stay behind recent and undated ads even with view claims, location, and long queue waits',()=>{
 const cards=[{url:'old',postedAt:'2026-03-16',discoveredAt:'2020',area:'Downtown',title:'Mountain panorama'}, {url:'unknown',discoveredAt:'2021'}, {url:'fresh',postedAt:'2026-11-01',discoveredAt:'2026',city:'Surrey'}];
 assert.equal(prioritizeCards(cards,3,now).at(-1)!.url,'old');
 const q=balanceQueue({urls:cards.map(c=>c.url),cards:Object.fromEntries(cards.map(c=>[c.url,c])),next:null},3,now);
 assert.deepEqual(q.urls,['unknown','fresh','old']);assert.equal(q.urls.length,cards.length);
});
test('search dates are scoped to one ad and do not come from an updated or availability label',()=>{
 const html=`<li><a href="${oldUrl}">Old</a><time datetime="2026-03-01">Posted</time></li><li><a href="${freshUrl}">Unknown</a><span>Updated <time datetime="2026-03-01"></time></span></li>`;
 const cards=discoveryCards(html,source,source.search,now);assert.equal(cards[0].postedAt,'2026-03-01T00:00:00.000Z');assert.equal(cards[1].postedAt,undefined);
 const group=`<li><a href="${oldUrl}">A</a><a href="${freshUrl}">B</a><time datetime="2026-03-01"></time></li>`;
 assert.ok(discoveryCards(group,source,source.search,now).every(c=>!c.postedAt));
 assert.equal(detailPostingDate('<p class="postinginfo">updated: <time datetime="2026-01-01"></time></p>','craigslist',oldUrl,now),undefined);
 assert.equal(discoveryCards(`<li><a href="${oldUrl}">Rental</a><time itemprop="dateModified" datetime="2026-03-01"></time></li>`,source,source.search,now)[0].postedAt,undefined);
 assert.equal(detailPostingDate('<p class="postinginfo">posted: <time datetime="2026-03-01"></time></p>','craigslist',oldUrl,now),'2026-03-01T00:00:00.000Z');
});
test('Facebook dates match the actual listing ID and ignore account or recommendation timestamps',()=>{
 const url='https://www.facebook.com/marketplace/item/123/';
 const html=`<script type="application/json">${JSON.stringify({account:{id:'123',creation_time:1e9},listing:{id:'123',marketplace_listing_title:'Rental',pdp_display_sections:[{pdp_fields:[{display_label:'Listed 8 months ago · Available now'}]}]},recommendation:{id:'999',marketplace_listing_title:'Other',creation_time:1e9}})}</script>`;
 assert.equal(sourcePostingDates(html,'facebook',[url],now).get(url),'2026-03-16T12:00:00.000Z');
});
test('Kijiji activation and Zumper listing dates beat sorting and modification dates',()=>{
 const k=sourceById('kijiji'),url='https://www.kijiji.ca/v-apartments-condos/vancouver/example/1234567890';
 const html=`<a href="${url}">Rental</a><script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{__APOLLO_STATE__:{'RealEstateListing:1234567890':{id:'1234567890',activationDate:'2026-03-01T00:00:00.000Z',sortingDate:'2026-11-16T00:00:00.000Z'}}}}})}</script>`;
 assert.equal(discoveryCards(html,k,k.search,now)[0].postedAt,'2026-03-01T00:00:00.000Z');
 const z=sourceById('zumper'),state={currentSearch:{listables:{listables:[{url:'/listings/123p/example',listed_on:Date.parse('2026-03-01')/1000,modified_on:now/1000,created_on:1e9}]}}};
 assert.equal(discoveryCards(`<script>window.__PRELOADED_STATE__ = ${JSON.stringify(state)};</script>`,z,z.search,now)[0].postedAt,'2026-03-01T00:00:00.000Z');
});
test('rediscovery without a date preserves known posting age and keeps old ads queued',()=>{
 const db=new Store(':memory:');try{db.set('criteria',{...db.criteria,listingAgePriorityMonths:3});const q={urls:[],next:null};
  mergeDiscovery(db,'craigslist',q,[{url:oldUrl,postedAt:'2020-01-01T00:00:00.000Z'}]);mergeDiscovery(db,'craigslist',q,[{url:oldUrl,postedAt:undefined},{url:freshUrl}]);
  const saved=readQueue(db,'craigslist');assert.deepEqual(saved.urls,[freshUrl,oldUrl]);assert.equal(saved.cards?.[oldUrl].postedAt,'2020-01-01T00:00:00.000Z');
  assert.equal(db.get('candidateFailures:craigslist'),undefined);
 }finally{db.close();}
});
test('posting dates survive refreshes without leaking between cross-posts or changing decisions',()=>{
 const db=new Store(':memory:');try{
  const l=listingSchema.parse({source:'craigslist',sourceId:'one',url:oldUrl,title:'Unit',address:'1 Example Street',unit:'1',rent:2400,beds:1,photos:[{id:'saved',url:'https://example.test/saved.jpg',local:'saved.jpg',status:'downloaded'}],postedAt:'2020-01-01T00:00:00.000Z',evidence:{postedAt:'Original posted date'}});
  const {id}=db.ingest(l),h=db.home(id)!;db.update(id,h.revision,{stage:'Interested',notes:'Keep',followUp:'',viewing:'',rescued:false});db.ingest({...l,postedAt:undefined,evidence:{}});
  assert.equal(db.home(id)!.listing.postedAt,l.postedAt);db.ingest({...l,source:'facebook',sourceId:'two',url:'https://www.facebook.com/marketplace/item/123/',postedAt:'2026-11-01T00:00:00.000Z',evidence:{postedAt:'New separate ad'}});
  assert.equal(db.home(id)!.listing.postedAt,l.postedAt);assert.equal(db.postingDetails(id).find(p=>p.source==='facebook')!.listing.postedAt,'2026-11-01T00:00:00.000Z');assert.equal(db.home(id)!.notes,'Keep');assert.equal(db.home(id)!.stage,'Interested');
 }finally{db.close();}
});
test('an old date discovered in details defers every photo and AI call, then resumes after newer work',async()=>{
 const db=new Store(':memory:'),directory=mkdtempSync(join(tmpdir(),'af-age-')),reviewed:string[]=[],visited:string[]=[];
 const oldDate=new Date(monthsBefore(Date.now(),8)).toISOString(),old=fixture.replace('</body>',`<p class="postinginfo">posted: <time datetime="${oldDate}"></time></p></body>`),fresh=fixture.replaceAll('100 Example','200 Example');
 const bytes=await sharp({create:{width:4,height:4,channels:3,background:'white'}}).jpeg().toBuffer();let downloads=0;
 const deps:ScanDependencies={session:(_s,b)=>({stopped:false,start:async()=>{},close:async()=>{},html:async url=>{b.reserve('pages');visited.push(url);return url===oldUrl?old:fresh;},resource:async()=>'',image:async()=>{b.reserve('photos');downloads++;return bytes;}}),review:async(l,b)=>{b.reserveAi();reviewed.push(l.url);for(const p of l.photos)p.status='reviewed';}};
 const run=async(resumeHomeIds?:number[])=>{const p=createPlan(db,{phase:'assessment',sources:['craigslist'],billingMode:'chatgpt',maxPages:5,maxListings:2,maxPhotos:6,maxAiCalls:2,maxReservedUsd:0,newListingsOnly:true,targetNewListingsPerSource:2,resumeHomeIds});approvePlan(db,p.id,'APPROVE ONE SCAN');await runRegularPlan(db,p.id,directory,undefined,deps);return getPlan(db,p.id);};
 try{db.set('criteria',{...db.criteria,listingAgePriorityMonths:3});saveQueue(db,'craigslist',{urls:[oldUrl,freshUrl],next:null});
  const first=await run();assert.deepEqual(reviewed,[freshUrl]);assert.equal(downloads,3);assert.equal(first.usage.aiCalls,1);
  const waiting=pendingHomes(db,'craigslist');assert.equal(waiting.length,1);assert.equal(waiting[0].listing.postedAt,oldDate);assert.ok(waiting[0].listing.photos.every(p=>p.status==='pending'));
  await run([waiting[0].id]);assert.deepEqual(reviewed,[freshUrl,oldUrl]);assert.equal(visited.filter(u=>u===oldUrl).length,1);assert.equal(pendingHomes(db,'craigslist').length,0);
 }finally{db.close();}
});
test('an old queued offering cannot jump ahead of an undated URL',async()=>{
 const db=new Store(':memory:'),directory=mkdtempSync(join(tmpdir(),'af-age-offer-')),visits:string[]=[];try{
  db.set('criteria',{...db.criteria,listingAgePriorityMonths:3});const old=listingSchema.parse({source:'craigslist',sourceId:'old',url:oldUrl,title:'Old',address:'',rent:2400,beds:1,postedAt:'2020-01-01T00:00:00.000Z'});saveQueue(db,'craigslist',{urls:[freshUrl],next:null,offerings:[old]});
  const p=createPlan(db,{phase:'assessment',sources:['craigslist'],billingMode:'chatgpt',maxPages:1,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});approvePlan(db,p.id,'APPROVE ONE SCAN');
  await runRegularPlan(db,p.id,directory,undefined,{session:(_s,b)=>({stopped:false,start:async()=>{},close:async()=>{},html:async url=>{b.reserve('pages');visits.push(url);return fixture;},resource:async()=>'',image:async()=>{throw Error('No photos')}})});
  assert.deepEqual(visits,[freshUrl]);assert.equal(readQueue(db,'craigslist').offerings?.[0].sourceId,'old');
 }finally{db.close();}
});
test('Apartments defers an old ad before expanding its gallery',async()=>{
 const db=new Store(':memory:'),directory=mkdtempSync(join(tmpdir(),'af-age-apartments-')),a='https://www.apartments.com/older/abcdefg/',b='https://www.apartments.com/newer/hijklmn/',calls:{url:string;photos:number}[]=[];
 const snapshot=(url:string):ChromeSnapshot=>({url,title:'Example Unit 2',text:'',html:`<header id="profileHeaderWrapper">${url===a?'$2400':'$4000'} Total Monthly Price Bedrooms 1 Bathrooms 1</header><section id="descriptionSection"><p>One apartment available.</p></section>${url===a?'<time itemprop="datePosted" datetime="2020-01-01T00:00:00.000Z"></time>':''}`,images:[],advertisedPhotos:3,warning:null,truncated:false,galleryComplete:false,links:[]});
 const jobs:ChromeJobClient={request:async(budget,url,_kind,_rent,photos)=>{budget.reserve('pages');calls.push({url,photos});return snapshot(url);},fail:()=>{}};
 try{db.set('criteria',{...db.criteria,listingAgePriorityMonths:3,maxRent:3600});db.set('browserExtension',{});saveQueue(db,'apartments',{urls:[a,b],next:null});const p=createPlan(db,{phase:'assessment',sources:['apartments'],billingMode:'chatgpt',maxPages:5,maxListings:2,maxPhotos:10,maxAiCalls:2,maxReservedUsd:0,newListingsOnly:true,targetNewListingsPerSource:2});approvePlan(db,p.id,'APPROVE ONE SCAN');
  await runRegularPlan(db,p.id,directory,jobs,{apartments:(s,b,d)=>runApartmentsSource(s,b,d,jobs,{image:async()=>{throw Error('No old-ad images expected')},review:async()=>{throw Error('No old-ad AI expected')}})});
  assert.deepEqual(calls,[{url:a,photos:0},{url:b,photos:0}]);assert.equal(getPlan(db,p.id).usage.aiCalls,0);assert.equal(pendingHomes(db,'apartments').length,1);
 }finally{db.close();}
});
