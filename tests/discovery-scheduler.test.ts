import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {criteriaSchema,listingSchema} from '../src/domain.ts';
import {DiscoveryScheduler,ensureDiscoverySchedule,scheduledUsage,seedScheduledYield} from '../server/discovery-scheduler.ts';
import {discoveryWindowOpen,discoveryWindowEnd,sourceCadence,pauseLowYield,discoveryLimits} from '../server/discovery-schedule-policy.ts';
import {createPlan,getPlan,Budget} from '../server/plans.ts';
import {readQueue,mergeDiscovery,saveQueue,retryCandidate} from '../server/discovery-queue.ts';
import {rememberIntakeRejection,intakeRejected,buildingRecentlyChecked} from '../server/intake-memory.ts';
import {quickRank} from '../server/quick-rank.ts';
import {hash} from '../server/db.ts';

const root='https://vancouver.craigslist.org/search/van/apa',url='https://vancouver.craigslist.org/van/apa/d/example/1234567890.html';
function setup(){const s=new Store(':memory:');s.set('criteria',criteriaSchema.parse({...s.criteria,quickIntake:{minRent:1500,maxRent:3500,minPhotos:0,allowedBeds:[1,2]}}));s.set('reviewWorkflow',{mode:'quick-first'});s.set('searchAreaPolicy',{regions:['downtown-vancouver'],mode:'source-filters',sourceRoutes:{craigslist:[{url:root,region:'downtown-vancouver'}]},existingHomeIds:[],configuredAt:'2026-11-20T12:00:00Z'});ensureDiscoverySchedule(s);return s;}
const saved=()=>listingSchema.parse({source:'craigslist',sourceId:'1234567890',url,title:'Apartment',address:'123 Example Street',rent:2500,beds:1,area:'Downtown',laundry:'in-unit',evidence:{searchAreaSourceUrl:root,searchAreaRegion:'downtown-vancouver'},photos:[{id:'photo',url:'https://images.craigslist.org/a.jpg',local:'a.jpg',status:'downloaded'}]});

test('Toronto windows cross midnight, include all daily nights, exclude Friday mornings, and follow DST',()=>{
 const cases:Record<string,boolean>={'2026-11-21T01:59:00Z':false,'2026-11-21T02:00:00Z':true,'2026-11-21T07:59:00Z':true,'2026-11-21T08:00:00Z':false,'2026-11-20T10:00:00Z':false,'2026-11-23T10:00:00Z':true,'2026-11-23T17:59:00Z':true,'2026-11-23T18:00:00Z':false,'2026-07-20T09:00:00Z':true,'2026-07-20T17:00:00Z':false};
 for(const [at,allowed] of Object.entries(cases))assert.equal(discoveryWindowOpen(new Date(at)),allowed,at);
 assert.equal(discoveryWindowEnd(new Date('2026-11-01T01:00:00Z'))?.toISOString(),'2026-11-01T08:00:00.000Z');
 assert.equal(discoveryWindowEnd(new Date('2027-03-14T02:00:00Z'))?.toISOString(),'2027-03-14T07:00:00.000Z');
});
test('source yield slows independently and requires several days plus sufficient checks before pausing',()=>{
 assert.equal(sourceCadence(12,30,0),30);assert.equal(sourceCadence(2,100,0),120);assert.equal(sourceCadence(1,60,0),360);assert.equal(sourceCadence(0,80,6),1440);
 assert.equal(pauseLowYield(0,2,'2026-11-16T00:00:00Z',new Date('2026-11-20')),false);
 assert.equal(pauseLowYield(1,3,'2026-11-16T00:00:00Z',new Date('2026-11-20')),true);
 assert.equal(pauseLowYield(2,9,'2026-11-16T00:00:00Z',new Date('2026-11-20')),false);
});
test('rejected URLs stay out of rediscovery and saved queues; changed criteria, expiry and explicit retry can reconsider',()=>{
 const s=setup();try{rememberIntakeRejection(s,'craigslist',url,'outside-area');const q={urls:[url],next:null,cards:{[url]:{url,searchUrl:root,searchRegion:'downtown-vancouver'}}};saveQueue(s,'craigslist',q);assert.equal(readQueue(s,'craigslist').urls.length,0);mergeDiscovery(s,'craigslist',q,[{url,rent:2500,beds:1}],root);assert.equal(q.urls.length,0);assert.equal(intakeRejected(s,'craigslist',url,undefined,Date.now()+8*86400000),false);retryCandidate(s,'craigslist',url);assert.equal(intakeRejected(s,'craigslist',url),false);rememberIntakeRejection(s,'craigslist',url,'outside-area');s.set('criteria',{...s.criteria,quickIntake:{...s.criteria.quickIntake,minRent:1600}});assert.equal(intakeRejected(s,'craigslist',url),false);rememberIntakeRejection(s,'craigslist',url,'parse-failure');assert.equal(intakeRejected(s,'craigslist',url),false);}finally{s.close();}
});
test('building inventory cooldown works without saved homes and one rejected suite does not suppress siblings',()=>{
 const s=setup(),building='https://www.hollyburn.com/building/example/';try{s.set('inventoryChecked:hollyburn:'+hash(building),new Date().toISOString());assert.equal(buildingRecentlyChecked(s,'hollyburn',building),true);rememberIntakeRejection(s,'hollyburn',building,'outside-area','unit1');assert.equal(intakeRejected(s,'hollyburn',building,'unit1'),true);assert.equal(intakeRejected(s,'hollyburn',building,'unit2'),false);assert.equal(intakeRejected(s,'hollyburn',building),false);}finally{s.close();}
});
test('quick ranking rewards advertised amenities, retains uncertainty and enforces rent and bedroom boundaries',()=>{
 const s=setup();try{const c={...s.criteria,quickAmenityBonuses:true},l=saved();const unknown=quickRank({...l,laundry:'unknown',parking:'unknown'},c);const known=quickRank({...l,laundry:'in-unit',parking:'included'},c);assert.equal(known.rankValue,unknown.rankValue+8);for(const rent of [1499,3501])assert.equal(quickRank({...l,rent},c).eligible,false);for(const rent of [1500,3500])assert.equal(quickRank({...l,rent},c).eligible,true);for(const beds of [0,3])assert.equal(quickRank({...l,beds},c).eligible,false);assert.equal(quickRank({...l,laundry:'unknown'},c).eligible,true);}finally{s.close();}
});
test('scheduler is offline on construction/outside windows, claims once, preserves reservations across instances and honors disable',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-21T02:00:00Z')});const s=setup();let launches=0;
 const runner={hasActive:false,assertCanStart:()=>{},start:()=>{launches++;}};const engine=new DiscoveryScheduler(s,runner,{timer:false});
 try{s.set('browserExtensionRuntime',{lastSeenAt:new Date().toISOString()});s.set('scanSchedule',{version:1,enabled:true,timeZone:'America/Toronto',authorizedAt:'2026-11-20T12:00:00Z',notBefore:'2026-11-21T02:00:00Z'});assert.equal(launches,0);engine.tick(new Date('2026-11-20T20:00:00Z'));assert.equal(launches,0);const id=engine.tick()!;assert.equal(launches,1);new DiscoveryScheduler(s,runner,{timer:false}).tick();assert.equal(launches,1);const p=getPlan(s,id);assert.equal(p.caps.maxAiCalls,0);assert.equal(p.caps.maxAddressLookups,0);assert.equal(scheduledUsage(s,new Date()).pages,p.caps.maxPages);assert.ok(Date.parse(p.caps.stopAt!)<=Date.now()+8*60000);s.db.prepare("UPDATE plans SET state='running' WHERE id=?").run(id);s.set('scanSchedule',{...s.get<object>('scanSchedule'),enabled:false});assert.throws(()=>new Budget(s,id,p.caps).reserve('pages'),/disabled/);}finally{engine.close();s.close();}
});
test('rolling budget includes yesterday usage and cannot be reset by constructing another scheduler',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-21T02:00:00Z')});const s=setup();try{const p=createPlan(s,{sources:['craigslist'],maxPages:150,maxListings:100,maxPhotos:1800,maxAiCalls:0,maxReservedUsd:0});s.db.prepare("UPDATE plans SET state='complete',usage=? WHERE id=?").run(JSON.stringify({pages:150,listings:100,photos:1800,aiCalls:0,requests:1950,reservedUsd:0}),p.id);s.db.prepare('INSERT INTO scheduled_discovery_runs VALUES (?,?,?,?,1)').run(p.id,'craigslist','2026-11-20T22:00:00Z','2026-11-20T22:08:00Z');assert.equal(scheduledUsage(s,new Date(),'craigslist').pages,discoveryLimits.source.pages);assert.equal(scheduledUsage(s,new Date('2026-11-22T00:00:00Z')).pages,0);}finally{s.close();}
});

test('only valid distinct photo-collected homes count; settlement survives restarts without double credit',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-21T02:00:00Z')});const s=setup(),runner={hasActive:false,assertCanStart:()=>{},start:()=>{}};const engine=new DiscoveryScheduler(s,runner,{timer:false});
 try{s.set('browserExtensionRuntime',{lastSeenAt:new Date().toISOString()});s.set('scanSchedule',{version:1,enabled:true,timeZone:'America/Toronto',authorizedAt:'2026-11-20T12:00:00Z',notBefore:'2026-11-21T02:00:00Z'});saveQueue(s,'craigslist',{urls:[url],next:null,cards:{[url]:{url,searchUrl:root,searchRegion:'downtown-vancouver'}}});const plan=engine.tick()!;const good=s.ingest(saved()).id;const bad=s.ingest({...saved(),sourceId:'bad',url:url+'?bad',rent:4500,address:'456 Other Street'}).id;s.set('newListingValidation:'+plan,{sources:{craigslist:{newHomeIds:[good,good,bad]}}});s.db.prepare("UPDATE plans SET state='complete' WHERE id=?").run(plan);saveQueue(s,'craigslist',{urls:[],next:null});engine.tick();assert.equal((s.db.prepare('SELECT count(*) AS n FROM scheduled_discovery_yield').get() as {n:number}).n,1);new DiscoveryScheduler(s,runner,{timer:false}).tick();assert.equal((s.db.prepare('SELECT count(*) AS n FROM scheduled_discovery_yield').get() as {n:number}).n,1);assert.equal(s.get<any>('scheduledSource:craigslist').checks,1);}finally{s.close();}
});

test('access warnings and exhausted source budgets prevent admission even with queued candidates',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-21T02:00:00Z')});const s=setup();let launches=0;const engine=new DiscoveryScheduler(s,{hasActive:false,assertCanStart:()=>{},start:()=>{launches++;}},{timer:false});
 try{s.set('scanSchedule',{version:1,enabled:true,timeZone:'America/Toronto',authorizedAt:'2026-11-20T12:00:00Z',notBefore:'2026-11-21T02:00:00Z'});s.set('browserExtensionRuntime',{lastSeenAt:new Date().toISOString()});s.db.prepare('INSERT INTO source_health(source,needs_attention,reason) VALUES (?,1,?)').run('craigslist','Access warning');engine.tick();assert.equal(launches,0);s.db.prepare('DELETE FROM source_health').run();const p=createPlan(s,{sources:['craigslist'],maxPages:150,maxListings:100,maxPhotos:1800,maxAiCalls:0,maxReservedUsd:0});s.db.prepare("UPDATE plans SET state='complete',usage=? WHERE id=?").run(JSON.stringify({pages:150,listings:100,photos:1800,requests:1950,aiCalls:0,reservedUsd:0}),p.id);s.db.prepare('INSERT INTO scheduled_discovery_runs VALUES (?,?,?,?,1)').run(p.id,'craigslist',new Date().toISOString(),new Date().toISOString());engine.tick();assert.equal(launches,0);}finally{s.close();}
});

test('three independent sources overlap while reservations stay bounded and the shared Chrome lane stays serial',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-21T02:00:00Z')});const s=setup();const ids:string[]=[];const engine=new DiscoveryScheduler(s,{hasActive:false,assertCanStart:()=>{},start:id=>{ids.push(id);}},{timer:false});
 try{s.set('scanSchedule',{version:1,enabled:true,timeZone:'America/Toronto',authorizedAt:'2026-11-20T12:00:00Z',notBefore:'2026-11-21T02:00:00Z'});s.set('browserExtension',{});s.set('browserExtensionRuntime',{lastSeenAt:new Date().toISOString()});s.set('searchAreaPolicy',{regions:['downtown-vancouver'],existingHomeIds:[],configuredAt:'2026-11-20',mode:'source-filters',sourceRoutes:{craigslist:[{url:root,region:'downtown-vancouver'}],vada:[{url:'https://vadapm.com/search/for-rent/vancouver',region:'downtown-vancouver'}],apartments:[{url:'https://www.apartments.com/vancouver-bc/',region:'downtown-vancouver'}],zillow:[{url:'https://www.zillow.com/vancouver-bc/rentals/',region:'downtown-vancouver'}]}});engine.tick();assert.equal(ids.length,3);assert.equal(new Set(ids.map(id=>getPlan(s,id).caps.parallelGroup)).size,1);assert.ok(ids.filter(id=>['apartments','zillow'].includes(getPlan(s,id).caps.sources[0])).length<=1);assert.ok(scheduledUsage(s,new Date()).pages<=60);}finally{s.close();}
});
