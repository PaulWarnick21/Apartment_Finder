import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {Store} from '../server/db.ts';
import {parseListing} from '../server/parsers.ts';
import {sourceById} from '../server/sources.ts';
import {inspectAvailability} from '../server/availability-parser.ts';
import {runAvailabilityCheck,availabilityDue,localAvailabilityDay,availabilityTargets,dailyAvailabilityLimits,type AvailabilitySchedule} from '../server/availability-monitor.ts';
import {homeAvailability,observationKey} from '../server/availability-store.ts';
import {summarizeAvailability,type AvailabilityObservation} from '../src/availability.ts';
import {AvailabilityStatus} from '../src/availability-status.tsx';
import {cardSummary} from '../server/desk-state.ts';

const html=readFileSync('tests/fixtures/craigslist.html','utf8');
const source=sourceById('craigslist');
const listing=(id='1234567890')=>parseListing(html,`https://vancouver.craigslist.org/van/apa/d/example/${id}.html`,source);
const closed='<html><body><div class="removed">This posting has been deleted by its author.</div></body></html>';
const schedule:AvailabilitySchedule={enabled:true,timeZone:'America/Toronto',hour:12,authorizedAt:'2026-11-19T15:00:00Z',notBefore:'2026-11-19T17:00:00Z'};
const noon='2026-11-19T17:00:00Z';
function seed(store:Store){const {id}=store.ingest(listing());store.ingest(listing('1234567891'));store.db.prepare("UPDATE homes SET stage='Interested',notes='Keep notes',follow_up='2026-12-01' WHERE id=?").run(id);store.set('availabilitySchedule',schedule);return id;}

test('noon uses Toronto winter/summer time; missed checks catch up once and disabled schedules stay offline',()=>{
 assert.deepEqual(localAvailabilityDay(new Date('2026-07-15T16:00:00Z')),{day:'2026-07-15',hour:12});
 assert.equal(availabilityDue(schedule,undefined,new Date('2026-11-19T16:59:00Z')),false);
 assert.equal(availabilityDue(schedule,undefined,new Date(noon)),true);
 assert.equal(availabilityDue({...schedule,enabled:false},undefined,new Date(noon)),false);
 const last={day:'2026-11-19',state:'partial' as const,startedAt:noon,homes:1,postings:2,checked:1,unknown:1,detail:''};
 assert.equal(availabilityDue(schedule,last,new Date('2026-11-19T23:00:00Z')),false);
 assert.equal(availabilityDue(schedule,{...last,state:'deferred'},new Date('2026-11-19T23:00:00Z')),true);
 assert.equal(availabilityDue(schedule,last,new Date('2026-11-20T17:00:00Z')),true);
});

test('scoped removal and live pages work; failed fetches, recommendations and changed units cannot close a home',()=>{
 const saved=listing();
 assert.equal(inspectAvailability(html,source,saved).status,'available');
 assert.equal(inspectAvailability(closed,source,saved).status,'unavailable');
 assert.equal(inspectAvailability(null,source,saved).status,'unknown');
 assert.equal(inspectAvailability('<h1>Temporarily unavailable</h1>',source,saved).status,'unknown');
 assert.equal(inspectAvailability(html+'<aside><h1>This listing is no longer available.</h1></aside>',source,saved).status,'available');
 assert.equal(inspectAvailability(html.replace('Suite #1204','Suite #1205'),source,saved).status,'unknown');
});

test('Zillow and Facebook closure data must match the saved source identity',()=>{
 const z=sourceById('zillow'),saved={...listing(),source:'zillow',sourceId:'42'};
 const page=(id:number)=>`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{componentProps:{gdpClientCache:JSON.stringify({property:{property:{zpid:id,homeStatus:'OFF_MARKET'}}})}}}})}</script>`;
 assert.equal(inspectAvailability(page(42),z,saved).status,'unavailable');
 assert.equal(inspectAvailability(page(43),z,saved).status,'unknown');
 const f=sourceById('facebook'),fb={...saved,source:'facebook'};
 assert.equal(inspectAvailability('<script type="application/json">{"id":"42","is_sold":true}</script>',f,fb).status,'unavailable');
 assert.equal(inspectAvailability('<script type="application/json">{"id":"43","is_sold":true}</script>',f,fb).status,'unknown');
});

test('all duplicates must close; an active duplicate wins; missing, stale or unconfirmed duplicates remain uncertain',()=>{
 const at=new Date().toISOString();
 const a:AvailabilityObservation={source:'craigslist',sourceId:'1',url:listing().url,status:'unavailable',checkedAt:at,runId:'x',evidence:'Removed'};
 assert.equal(summarizeAvailability([a,{...a,sourceId:'2'}])?.status,'unavailable');
 assert.equal(summarizeAvailability([a,{...a,sourceId:'2',status:'available'}])?.status,'available');
 assert.equal(summarizeAvailability([a,{...a,sourceId:'2',checkedAt:''}])?.status,'unknown');
 assert.equal(summarizeAvailability([a],true)?.status,'unknown');
 assert.equal(summarizeAvailability([a],false,Date.now()+37*3600000)?.status,'unknown');
});

test('daily run checks every confirmed posting, preserves decisions/ranks and does not repeat after reopening the database',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date(noon)});
 const path=join(mkdtempSync(join(tmpdir(),'af-availability-')),'db.sqlite');let store=new Store(path);
 try{
  const id=seed(store),before=store.home(id)!;let calls=0;
  const deps={session:(_s:any,b:any)=>({start:async()=>{},html:async(url:string)=>{calls++;b.reserve('pages');return url.includes('1234567890')?closed:html;},close:async()=>{}})};
  const result=await runAvailabilityCheck(store,'unused',undefined,deps);
  assert.equal(result?.checked,2);assert.equal(calls,2);assert.equal(store.home(id)!.availability?.status,'available');
  assert.equal(store.home(id)!.stage,before.stage);assert.equal(store.home(id)!.revision,before.revision);assert.equal(store.home(id)!.notes,'Keep notes');assert.equal(store.home(id)!.followUp,'2026-12-01');assert.deepEqual(store.home(id)!.score,before.score);assert.deepEqual(store.home(id)!.listing,before.listing);
  const usage=JSON.parse((store.db.prepare('SELECT usage FROM plans WHERE id=?').get(result!.planId!) as any).usage);assert.equal(usage.aiCalls,0);assert.equal(usage.photos,0);assert.equal(usage.pages,2);
  store.close();store=new Store(path);await runAvailabilityCheck(store,'unused',undefined,deps);assert.equal(calls,2);
  assert.equal(cardSummary(store.home(id)!).availability?.status,'available');
 }finally{store.close();}
});

test('paused sources and active scan locks are respected; an access failure is never a closure',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date(noon)});const store=new Store(':memory:');
 try{
  const id=seed(store);let calls=0;const deps={session:()=>({start:async()=>{calls++;},html:async()=>closed,close:async()=>{}})};
  store.db.prepare('INSERT INTO scan_lock VALUES (1,?,?)').run('busy',noon);
  await runAvailabilityCheck(store,'unused',undefined,deps);assert.equal(calls,0);assert.equal(store.get<any>('availabilityRun').state,'deferred');
  store.db.prepare('DELETE FROM scan_lock').run();store.pause('craigslist','Human verification',true);
  await runAvailabilityCheck(store,'unused',undefined,deps);assert.equal(calls,0);assert.equal(store.home(id)!.availability?.status,'unknown');assert.equal(store.get<any>('availabilityRun').state,'partial');
  assert.equal(store.db.prepare('SELECT * FROM scan_lock').get(),undefined);
 }finally{store.close();}
});

test('only active Interested and later stages are selected; unavailable markup uses words and escaped source evidence',()=>{
 const store=new Store(':memory:');try{
  const id=seed(store);for(const stage of ['Unreviewed','Not Interested','Closed','Leased']){store.db.prepare('UPDATE homes SET stage=? WHERE id=?').run(stage,id);assert.equal(availabilityTargets(store).length,0);}
  for(const stage of ['Interested','Serious Candidates','Ready to Apply','In Progress','Inquiry Sent','Viewing Booked','Applied']){store.db.prepare('UPDATE homes SET stage=? WHERE id=?').run(stage,id);assert.equal(availabilityTargets(store).length,2);}
  for(const p of availabilityTargets(store))store.set(observationKey(p),{...p,status:'unavailable',checkedAt:new Date().toISOString(),runId:'x',evidence:'<script>bad()</script>'});
  const home=store.home(id)!;assert.equal(homeAvailability(store,id,false)?.status,'unavailable');
  const markup=renderToStaticMarkup(createElement(AvailabilityStatus,{home,details:true}));assert.match(markup,/Unavailable/);assert.match(markup,/availability-unavailable/);assert.ok(!markup.includes('<script>bad'));
 }finally{store.close();}
});

test('all closed ads produce unavailable and the next daily check can restore availability',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date(noon)});const store=new Store(':memory:');
 try{
  const id=seed(store);let content=closed;
  const deps={session:(_s:any,b:any)=>({start:async()=>{},html:async()=>{b.reserve('pages');return content;},close:async()=>{}})};
  await Promise.all([runAvailabilityCheck(store,'unused',undefined,deps),runAvailabilityCheck(store,'unused',undefined,deps)]);
  assert.equal(store.home(id)!.availability?.status,'unavailable');assert.equal((store.db.prepare('SELECT count(*) AS n FROM plans').get() as any).n,1);
  t.mock.timers.setTime(new Date('2026-11-20T17:00:00Z').getTime());content=html;
  await runAvailabilityCheck(store,'unused',undefined,deps);assert.equal(store.home(id)!.availability?.status,'available');assert.equal(store.home(id)!.stage,'Interested');
 }finally{store.close();}
});

test('page cap makes duplicate coverage incomplete and gives unvisited postings priority next day',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date(noon)});const store=new Store(':memory:');const original=dailyAvailabilityLimits.maxPages;
 try{
  const id=seed(store);dailyAvailabilityLimits.maxPages=1;const visited:string[]=[];
  const deps={session:(_s:any,b:any)=>({start:async()=>{},html:async(url:string)=>{b.reserve('pages');visited.push(url);return closed;},close:async()=>{}})};
  await runAvailabilityCheck(store,'unused',undefined,deps);assert.equal(visited.length,1);assert.equal(store.home(id)!.availability?.status,'unknown');assert.equal(store.get<any>('availabilityRun').state,'partial');
  assert.notEqual(availabilityTargets(store)[0].url,visited[0]);
  t.mock.timers.setTime(new Date('2026-11-20T17:00:00Z').getTime());await runAvailabilityCheck(store,'unused',undefined,deps);
  assert.equal(visited.length,2);assert.notEqual(visited[0],visited[1]);assert.equal(store.home(id)!.availability?.status,'unknown');
 }finally{dailyAvailabilityLimits.maxPages=original;store.close();}
});

test('confirmed merge and split aggregate current postings, not stale home-level closure flags',()=>{
 const store=new Store(':memory:');try{
  const first=store.ingest(listing()).id,other=store.ingest({...listing('1234567891'),address:'102 Example Street'}).id;
  store.db.prepare("UPDATE homes SET stage='Interested'").run();
  for(const p of availabilityTargets(store))store.set(observationKey(p),{...p,status:p.homeId===first?'unavailable':'available',checkedAt:new Date().toISOString(),runId:'x'});
  const a=store.home(first)!,b=store.home(other)!;
  const merge=store.mergeHomes(first,other,{keep:a.revision,duplicate:b.revision});
  assert.equal(store.home(first)!.availability?.status,'available');assert.equal(availabilityTargets(store).length,2);
  store.splitMerge(merge.mergeId);assert.equal(store.home(first)!.availability?.status,'unavailable');assert.equal(store.home(other)!.availability?.status,'available');
 }finally{store.close();}
});
