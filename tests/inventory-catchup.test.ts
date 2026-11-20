import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../server/db.ts';
import {createPlan,approvePlan,Budget,claimPlan,getPlan} from '../server/plans.ts';
import {sourceById} from '../server/sources.ts';
import {runInventorySource,inventoryRoutes,resetInventoryCycle,regionalRoutes,directorySearchRoutes} from '../server/inventory-discovery.ts';
import {readQueue,saveQueue,balanceQueue} from '../server/discovery-queue.ts';
import {listingSchema,criteriaSchema} from '../src/domain.ts';
import {scoreBase} from '../server/scoring.ts';
import {conditionCorrections} from '../server/feedback-learning.ts';
import {checkedInventoryCaughtUp,chooseQuickCatchupPhase,chooseCatchupPhase,phaseSourceVisits,effectiveRunPolicy} from '../server/catchup-policy.ts';
import type {SourceYieldStat} from '../server/source-yield.ts';
import {SourceSession} from '../server/transport.ts';
import {hardFailure} from '../server/regular-worker.ts';
import {discoveryEnd} from '../server/source-discovery.ts';
const caps={phase:'inventory',sources:['easyrent'],trafficPolicy:'session',maxPages:2,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0};
const priorityStats:SourceYieldStat[]=[{source:'leader',weight:.9,strongMatches:9},{source:'other',weight:.2,strongMatches:2}].map(value=>({...value,basis:'confirmed',uniqueUnits:10,fullyReviewed:10,factualExclusions:0,incomplete:0,provisionalMatches:value.strongMatches,userInterested:0,userReviewed:0,recentInterested:0,recentReviewed:0,positiveSignals:value.strongMatches,signalSample:10}));
test('quick catch-up gives remaining inventory all effort after the leading source drains',()=>{
 const state={selectionCount:0,lastSelected:{}};
 assert.equal(chooseQuickCatchupPhase(['leader','other'],['leader','other'],priorityStats,state)?.source,'leader');
 const remaining=chooseQuickCatchupPhase(['other'],[],priorityStats,state);assert.equal(remaining?.source,'other');assert.equal(remaining?.phase,'inventory');
 assert.equal(chooseQuickCatchupPhase([],['other'],priorityStats,state)?.phase,'assessment');
 assert.equal(chooseQuickCatchupPhase([],[],priorityStats,state),null);
});
test('after catch-up, fresh checks reach every available source before favoring new backlog',()=>{
 const state={selectionCount:0,lastSelected:{}};
 const first=chooseQuickCatchupPhase(['other','leader'],['leader'],priorityStats,state,true,[]);
 assert.equal(first?.source,'other');assert.equal(first?.phase,'inventory');assert.equal(first?.mode,'exploration');
 const next=chooseQuickCatchupPhase(['other','leader'],['leader'],priorityStats,state,true,['other']);
 assert.equal(next?.source,'leader');assert.equal(next?.phase,'inventory');
 const surveyed=chooseQuickCatchupPhase(['other','leader'],['leader'],priorityStats,state,true,['other','leader']);
 assert.equal(surveyed?.source,'leader');assert.equal(surveyed?.phase,'assessment');assert.equal(surveyed?.mode,'priority');
});
test('coverage and collection gaps never count as caught up',()=>{
 const complete={queued:0,pendingEvidence:0,extractionIssues:0,routes:[{status:'exhausted'}]};
 assert.equal(checkedInventoryCaughtUp([complete,complete]),true);
 assert.equal(checkedInventoryCaughtUp([]),false);
 for(const change of [{queued:1},{pendingEvidence:1},{extractionIssues:1},{routes:[]},...['pending','partial','blocked','unverified'].map(status=>({routes:[{status}]}))])assert.equal(checkedInventoryCaughtUp([complete,{...complete,...change}]),false);
});
test('a large inventory cannot prevent scoring after every available source has a first pass',()=>{
 assert.deepEqual(chooseCatchupPhase(['a','b'],['a','b'],['a','b'],['a'],'inventory'),{phase:'inventory',source:'a'});
 assert.deepEqual(chooseCatchupPhase(['a'],['b','a'],['a','b'],['a','b'],'inventory'),{phase:'assessment',source:'b'});
 assert.deepEqual(chooseCatchupPhase(['a'],['b'],['a','b'],['a','b'],'assessment'),{phase:'inventory',source:'a'});
 assert.equal(chooseCatchupPhase([],[],['a'],['a'],'assessment'),null);
});

test('repeated inventory expansion cannot starve that source of its assessment turn',()=>{
 const history=[
  {created_at:'2026-11-16T19:00:00Z',caps:{phase:'inventory',sources:['large']}},
  {created_at:'2026-11-16T17:00:00Z',caps:{phase:'assessment',sources:['small']}},
  {created_at:'2026-11-16T16:00:00Z',caps:{phase:'inventory',sources:['large','small']}},
  {created_at:'2026-11-16T15:00:00Z',caps:{phase:'assessment',sources:['small']}},
 ];
 const visits=phaseSourceVisits(history);
 assert.equal(visits.inventory.large,'2026-11-16T19:00:00Z');assert.equal(visits.assessment.large,undefined);assert.equal(visits.assessment.small,'2026-11-16T17:00:00Z');
 const candidates=['small','large'].sort((a,b)=>(visits.assessment[a]??'').localeCompare(visits.assessment[b]??''));
 assert.deepEqual(chooseCatchupPhase(['large'],candidates,['large','small'],['large','small'],'inventory'),{phase:'assessment',source:'large'});
 history.push({created_at:'2026-11-16T19:01:00Z',caps:{phase:'assessment',sources:['large']}});
 const after=phaseSourceVisits(history);assert.equal(after.inventory.large,visits.inventory.large);assert.equal(after.assessment.large,'2026-11-16T19:01:00Z');
});

test('today-only execution allowance expires without changing the normal daily caps',()=>{
 const dailyCaps={pages:600,listings:400,photos:8000,aiCalls:1500},p={dailyCaps,runOverride:{authorizedAt:'2026-11-16T20:00:00Z',expiresAt:'2026-11-17T05:00:00Z',dailyCaps:{...dailyCaps,aiCalls:3000},reason:'Finish today within the authorized weekly allowance'}};
 assert.deepEqual(effectiveRunPolicy(p,Date.parse(p.runOverride.authorizedAt)-1),{dailyCaps});
 assert.deepEqual(effectiveRunPolicy(p,Date.parse('2026-11-16T23:30:00Z')),{dailyCaps:{...dailyCaps,aiCalls:3000},until:Date.parse(p.runOverride.expiresAt)});
 assert.deepEqual(effectiveRunPolicy(p,Date.parse(p.runOverride.expiresAt)),{dailyCaps});
 assert.deepEqual(p.dailyCaps,dailyCaps);
 assert.throws(()=>effectiveRunPolicy({...p,dailyCaps:{...dailyCaps,aiCalls:NaN}},Date.parse(p.runOverride.expiresAt)),/Invalid daily/);
});
const page=(id:string,next?:string)=>`<body><a href="/listings/${id}/">${id} $2500 Vancouver</a>${next?`<a rel="next" href="${next}">Next</a>`:''}</body>`;
test('inventory traverses pagination while a detail backlog exists, without scoring or photos',async()=>{
 const store=new Store(':memory:');try{
  saveQueue(store,'easyrent',{urls:['https://www.easyrent.ca/listings/older/'],next:null});
  const plan=createPlan(store,caps);approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);const budget=new Budget(store,plan.id,plan.caps),visits:string[]=[];
  const result=await runInventorySource(store,sourceById('easyrent'),budget,mkdtempSync(join(tmpdir(),'inventory-')),undefined,{session:()=>({stopped:false,start:async()=>{},close:async()=>{},html:async url=>{budget.reserve('pages');visits.push(url);return visits.length===1?page('new','/listings/?page=2'):page('last');},resource:async()=>{throw Error('Unexpected resource')},image:async()=>{throw Error('Inventory must never fetch photos')}})});
  assert.equal(visits.length,2);assert.equal(store.homes().length,0);assert.equal(readQueue(store,'easyrent').urls.length,3);assert.equal(result.state,'complete');assert.equal(inventoryRoutes(store,sourceById('easyrent'))[0].status,'exhausted');
  assert.equal(getPlan(store,plan.id).usage.aiCalls,0);assert.equal(getPlan(store,plan.id).usage.photos,0);
 }finally{store.close();}
});
test('dynamic results without a supported continuation remain a coverage gap',async()=>{
 const store=new Store(':memory:');try{const plan=createPlan(store,{...caps,sources:['facebook'],maxPages:1});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);const b=new Budget(store,plan.id,plan.caps);
  const result=await runInventorySource(store,sourceById('facebook'),b,mkdtempSync(join(tmpdir(),'inventory-dynamic-')),undefined,{session:()=>({stopped:false,start:async()=>{},close:async()=>{},html:async()=>{b.reserve('pages');return '<main role="main" aria-label="Collection of Marketplace items"><a href="https://www.facebook.com/marketplace/item/12345/">Apartment</a></main>';},resource:async()=>'',image:async()=>{throw Error('No photos')}})});
  assert.equal(result.state,'partial');assert.equal(inventoryRoutes(store,sourceById('facebook'))[0].status,'unverified');
 }finally{store.close();}
});
test('dynamic continuation retains its current capture and does not restart when the first scroll is unchanged',async()=>{
 const store=new Store(':memory:');try{
  const source=sourceById('craigslist'),plan=createPlan(store,{...caps,sources:[source.id],maxPages:4});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);const b=new Budget(store,plan.id,plan.caps);let navigations=0,step=0;
  const html=(id:string)=>`<a href="https://www.craigslist.org/view/d/test/${id}/">Apartment</a>`;
  class FixtureSession extends SourceSession {async start(){}async close(){}async html(){navigations++;b.reserve('pages');return html('first');}async inventoryContinuation(){step++;if(step===3)return {end:true,url:source.search+'#search=2~gallery~100',total:3};b.reserve('pages');return {end:false,url:step===1?source.search:source.search+'#search=2~gallery~100',total:3,deferred:step===1,html:html(step===1?'second':'third')};}}
  const result=await runInventorySource(store,source,b,mkdtempSync(join(tmpdir(),'inventory-cursor-')),undefined,{session:()=>new FixtureSession(source,b,'')});
  assert.equal(navigations,1);assert.equal(readQueue(store,source.id).urls.length,3);assert.equal(result.state,'complete');assert.equal(inventoryRoutes(store,source)[0].pages,3);
 }finally{store.close();}
});
test('daily newest-page refresh preserves the older pagination frontier',()=>{
 const store=new Store(':memory:');try{const source=sourceById('easyrent');store.set('inventoryCoverage:easyrent',[{url:source.search,next:source.search+'?page=12',visited:[source.search],pages:11,recognized:100,status:'partial',detail:'more'}]);resetInventoryCycle(store,source);const r=inventoryRoutes(store,source)[0];assert.equal(r.next,source.search+'?page=12');assert.equal(r.refreshNeeded,true);assert.equal(r.visited.length,1);}finally{store.close();}
});
test('an interrupted inventory frontier survives the next morning without clearing a source pause',()=>{
 const store=new Store(':memory:');try{const source=sourceById('easyrent');store.set('inventoryCoverage:easyrent',[{url:source.search,next:source.search+'?page=12',visited:[source.search],pages:11,recognized:100,status:'blocked',detail:'Interrupted at credit reserve'}]);store.pause(source.id,'Real access warning',true);resetInventoryCycle(store,source);const r=inventoryRoutes(store,source)[0];assert.equal(r.next,source.search+'?page=12');assert.equal(r.refreshNeeded,true);assert.equal(r.status,'partial');assert.throws(()=>store.checkSource(source.id));}finally{store.close();}
});
test('old queued listings receive half the positions even with attractive new arrivals',()=>{
 const cards=[{url:'old1',discoveredAt:'2020'},{url:'old2',discoveredAt:'2021'},{url:'new1',discoveredAt:'2026',title:'Mountain panorama'},{url:'new2',discoveredAt:'2026',title:'Ocean view'}];
 const q=balanceQueue({urls:cards.map(c=>c.url),cards:Object.fromEntries(cards.map(c=>[c.url,c])),next:null});assert.deepEqual(q.urls,['old1','new1','old2','new2']);
});
test('inventory cannot carry AI or image budget and regional routes must be advertised on source',()=>{
 const store=new Store(':memory:');try{assert.throws(()=>createPlan(store,{...caps,maxAiCalls:1}),/zero photo and AI/);}finally{store.close();}
 assert.deepEqual(regionalRoutes('<a href="/property_vancouver.htm">Vancouver</a><a href="https://evil.test/property_vancouver.htm">Vancouver</a>',sourceById('sunstar'),'https://www.mybcrental.com/'),['https://www.mybcrental.com/property_vancouver.htm']);
});

test('numbered catalogue pages stay on one frontier instead of becoming overlapping regional routes',async()=>{
 const source=sourceById('zumper'),root=source.search,second=root+'?page=2',third=root+'?page=3';
 assert.deepEqual(regionalRoutes(`<a href="${second}">2</a><a href="/apartments-for-rent/burnaby-bc">Burnaby</a>`,source,root),['https://www.zumper.com/apartments-for-rent/burnaby-bc']);
 const store=new Store(':memory:');try{
  const plan=createPlan(store,{...caps,sources:[source.id],maxPages:2});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);const b=new Budget(store,plan.id,plan.caps),visits:string[]=[];
  await runInventorySource(store,source,b,mkdtempSync(join(tmpdir(),'inventory-numbered-')),undefined,{session:()=>({stopped:false,start:async()=>{},close:async()=>{},html:async url=>{b.reserve('pages');visits.push(url);return `<main><a href="/apartment-buildings/p${visits.length}/example/">Vancouver $2500</a><a rel="next" href="${url===root?second:third}">Next</a><a href="${third}">3</a></main>`;},resource:async()=>'',image:async()=>{throw Error('No photos');}})});
  assert.deepEqual(visits,[root,second]);const routes=inventoryRoutes(store,source);assert.equal(routes.length,1);assert.deepEqual(routes[0].visited,[root,second]);assert.equal(routes[0].next,third);assert.equal(routes[0].status,'partial');assert.equal(readQueue(store,source.id).urls.length,2);
 }finally{store.close();}
});

test('Hollyburn neighbourhood guides lead to their advertised Vancouver search without claiming empty inventory',async()=>{
 const source=sourceById('hollyburn'),guide='https://www.hollyburn.com/vancouver/downtown-vancouver/west-end/',search='https://www.hollyburn.com/find-an-apartment?lat=49.28&lng=-123.13&city=Vancouver';
 const html=`<body><nav><a href="/find-an-apartment/?city=Vancouver">Vancouver</a></nav><main><h1>Downtown West End Apartment Rentals</h1><a href="${search}">Search Downtown West End Apartment Rentals</a><a href="https://evil.test/find-an-apartment?city=Vancouver">Vancouver</a><a href="/find-an-apartment?city=Toronto">Toronto</a></main></body>`;
 assert.deepEqual(directorySearchRoutes(html,source,guide),[search]);
 assert.deepEqual(directorySearchRoutes(html,source,source.expandedSearches![0]),[]);
 assert.deepEqual(directorySearchRoutes('<nav><a href="/find-an-apartment/?city=Vancouver">Vancouver</a></nav><main>Broken search</main>',source,guide),[]);
 const store=new Store(':memory:');try{
  store.set('inventoryCoverage:hollyburn',[{url:guide,next:guide,visited:[],pages:0,recognized:0,status:'pending',detail:'Guide'},...[source.search,...source.expandedSearches!].map(url=>({url,next:null,visited:[url],pages:1,recognized:1,status:'unverified',detail:'Already checked'}))]);
  const plan=createPlan(store,{...caps,sources:[source.id],maxPages:2});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);const b=new Budget(store,plan.id,plan.caps),visits:string[]=[];
  await runInventorySource(store,source,b,mkdtempSync(join(tmpdir(),'inventory-guide-')),undefined,{session:()=>({stopped:false,start:async()=>{},close:async()=>{},html:async url=>{b.reserve('pages');visits.push(url);return url===guide?html:'<main><a href="/building/example/">Example Apartments Vancouver</a></main>';},resource:async()=>'',image:async()=>{throw Error('No image request allowed');}})});
  assert.deepEqual(visits,[guide,search]);assert.deepEqual(readQueue(store,source.id).urls,['https://www.hollyburn.com/building/example/']);
  const route=inventoryRoutes(store,source).find(r=>r.url===guide)!;assert.equal(route.status,'unverified');assert.equal(route.next,null);assert.equal(route.pages,1);assert.match(route.detail,/Neighbourhood guide/);assert.equal(getPlan(store,plan.id).usage.aiCalls,0);
 }finally{store.close();}
});
test('mountain preference needs confirmed good unit-window evidence; saved typo retains its meaning',()=>{
 const l=listingSchema.parse({source:'fixture',sourceId:'mountain',url:'https://example.test/a',title:'A',address:'',rent:2600,beds:1,location:'downtown',floorLevel:10,parking:'included',galleryComplete:true,expectedPhotos:1,photos:[{id:'one',url:'https://example.test/p',status:'reviewed',kind:'interior',unitCertain:true,scenery:'nature',quality:4,natureTypes:['mountains']}]});const c=criteriaSchema.parse({});
 assert.ok(scoreBase(l,c).adjustments.some(a=>a.label==='Confirmed mountain outlook'));
 l.photos[0].unitCertain=false;assert.ok(!scoreBase(l,c).adjustments.some(a=>a.label==='Confirmed mountain outlook'));
 assert.equal(conditionCorrections('The price is too high for the bad views and dates kitchen').modern,false);
});
test('known street-level exclusion saves photo credits while unknown or conflicting floor stays reviewable',()=>{
 const c=criteriaSchema.parse({streetLevelCeiling:2.9}),l=listingSchema.parse({source:'fixture',sourceId:'floor',url:'https://example.test/f',title:'Unit',address:'',rent:null,beds:null,floorLevel:0});
 assert.equal(hardFailure(l,c),true);assert.equal(hardFailure({...l,floorLevel:null},c),false);assert.equal(hardFailure({...l,conflicts:['Floor evidence conflicts']},c),false);
});
test('search exhaustion requires current-search pagination evidence, not unrelated embedded totals',()=>{
 const source=sourceById('kijiji'),url=source.search,path=new URL(url).pathname;
 const page=(offset:number)=>`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{__APOLLO_STATE__:{ROOT_QUERY:{['searchResultsPageByUrl:'+path]:{pagination:{offset,limit:40,totalCount:209}}}}}}})}</script>`;
 assert.deepEqual(discoveryEnd(page(0),source,url),{total:209,exhausted:false});assert.deepEqual(discoveryEnd(page(200),source,url),{total:209,exhausted:true});assert.equal(discoveryEnd(page(200),source,url+'?different=1'),null);
});
test('an expired HTTP 410 listing does not impose a site-wide cooldown',async()=>{
 const store=new Store(':memory:');try{
  const source=sourceById('craigslist'),plan=createPlan(store,{...caps,sources:[source.id],maxPages:1});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);const b=new Budget(store,plan.id,plan.caps),session=new SourceSession(source,b,'');
  session.page={goto:async()=>({status:()=>410})} as any;
  assert.equal(await session.html('https://www.craigslist.org/view/d/expired/oldad/'),null);assert.equal(session.stopped,false);assert.doesNotThrow(()=>store.checkSource(source.id));assert.equal(b.remaining('pages'),0);
 }finally{store.close();}
});
