import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../server/db.ts';
import {createPlan,approvePlan,claimPlan,getPlan,Budget} from '../server/plans.ts';
import {concurrentSourceBudgets} from '../server/source-budget.ts';
import {runRegularPlan} from '../server/regular-worker.ts';

const caps={assessmentMode:'quick',billingMode:'chatgpt',trafficPolicy:'session',sources:['craigslist','vada'],maxPages:8,maxListings:8,maxPhotos:20,maxAiCalls:0,maxAddressLookups:0,maxReservedUsd:0} as const;
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
test('parallel source shares remain independent and their sum never exceeds the single approved plan',()=>{
 const store=new Store(':memory:');try{
  const p=createPlan(store,caps);approvePlan(store,p.id,'APPROVE ONE SCAN');claimPlan(store,p.id);
  const [first,second]=concurrentSourceBudgets(new Budget(store,p.id,p.caps),p.caps.sources,true);
  assert.equal(first.remaining('pages'),6);assert.equal(second.remaining('pages'),2);
  first.reserve('pages',2);second.reserve('pages',1);assert.equal(first.remaining('pages'),4);assert.equal(second.remaining('pages'),1);
  first.reserve('pages',4);assert.throws(()=>first.reserve('pages'),/Per-source/);second.reserve('pages');assert.equal(getPlan(store,p.id).usage.pages,8);
  assert.throws(()=>first.reserveAi(),/does not authorize AI/);
  assert.equal(first.limits.photos+second.limits.photos,20);
 }finally{store.close();}
});

test('future quick scans overlap independent sources by default but serialize the shared Chrome lane',async()=>{
 const store=new Store(':memory:'),dir=mkdtempSync(join(tmpdir(),'parallel-default-'));let active=0,maxActive=0,chrome=0,maxChrome=0;
 const began:string[]=[];
 try{
  store.set('browserExtension',{});
  const p=createPlan(store,{...caps,sources:['apartments','zillow','craigslist','vada'],maxPages:16,maxListings:12});approvePlan(store,p.id,'APPROVE ONE SCAN');
  const start=async(source:string)=>{began.push(source);active++;maxActive=Math.max(maxActive,active);if(['apartments','zillow'].includes(source)){chrome++;maxChrome=Math.max(maxChrome,chrome);}await pause(25);};
  const finish=(source:string)=>{active--;if(['apartments','zillow'].includes(source))chrome--;};
  await runRegularPlan(store,p.id,dir,undefined,{apartments:async(_s,b)=>{await start('apartments');b.reserve('pages');await pause(25);finish('apartments');return {source:'apartments',state:'complete',detail:'Fixture complete'};},session:(s,b)=>({stopped:false,start:()=>start(s.id),close:async()=>{finish(s.id);},html:async()=>{b.reserve('pages');await pause(25);return '<html>Unrecognized offline fixture</html>';},image:async()=>{throw Error('No live images');},resource:async()=>{throw Error('No live resources');}})});
  assert.equal(maxActive,3);assert.equal(maxChrome,1);assert.equal(active,0);assert.equal(began.length,4);
  assert.equal(getPlan(store,p.id).usage.pages,4);assert.equal(store.db.prepare('SELECT 1 FROM scan_lock').get(),undefined);
  const allocation=store.get<{selectionCount:number;lastSelected:Record<string,string>}>('sourceAllocation')!;
  assert.equal(allocation.selectionCount,1);assert.deepEqual(Object.keys(allocation.lastSelected).sort(),[...began].sort());
 }finally{store.close();}
});

test('cancellation waits for all overlapping sources to close before releasing the plan lock',async()=>{
 const store=new Store(':memory:'),dir=mkdtempSync(join(tmpdir(),'parallel-cancel-'));let started=0,closed=0;
 try{
  const p=createPlan(store,caps);approvePlan(store,p.id,'APPROVE ONE SCAN');
  await runRegularPlan(store,p.id,dir,undefined,{session:(_s,b)=>({stopped:false,start:async()=>{started++;if(started===2)store.db.prepare("UPDATE plans SET state='cancelled' WHERE id=?").run(p.id);await pause(20);},html:async()=>{b.reserve('pages');return '';},close:async()=>{await pause(20);assert.ok(store.db.prepare('SELECT 1 FROM scan_lock').get());closed++;},image:async()=>{throw Error('No live images');},resource:async()=>''})});
  assert.equal(started,2);assert.equal(closed,2);assert.equal(getPlan(store,p.id).state,'cancelled');assert.equal(getPlan(store,p.id).usage.pages,0);assert.equal(store.db.prepare('SELECT 1 FROM scan_lock').get(),undefined);
 }finally{store.close();}
});
