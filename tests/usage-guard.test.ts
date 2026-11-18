import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {createPlan,approvePlan,claimPlan,Budget,getPlan} from '../server/plans.ts';
import {usageCheckpoint,effectiveUsagePolicy} from '../server/usage-guard.ts';
test('supervised scans require fresh usage below reserve and a new permit per AI call',async()=>{
 const store=new Store(':memory:');try{
  const plan=createPlan(store,{sources:['vada'],billingMode:'chatgpt',maxPages:5,maxListings:4,maxPhotos:100,maxAiCalls:10,maxReservedUsd:0});
  approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);const budget=new Budget(store,plan.id,plan.caps);
  const key=`usageGuard:${plan.id}`,checkpoint={checkedAt:Date.now(),usedPercent:70,stopAt:88,allowAiThrough:1};store.set(key,checkpoint);
  await budget.waitForAi();budget.reserveAi();assert.equal(getPlan(store,plan.id).usage.aiCalls,1);
  assert.throws(()=>budget.reserveAi(),/Awaiting account usage/);
  const wait=budget.waitForAi();setTimeout(()=>store.set(key,{...checkpoint,allowAiThrough:2}),20);await wait;budget.reserveAi();
  store.set(key,{...checkpoint,usedPercent:88});assert.throws(()=>budget.reserve('pages'),/reserve reached/);
  store.set(key,{...checkpoint,checkedAt:Date.now()-91000});assert.throws(()=>budget.check(),/stale/);
  store.set(key,{...checkpoint,usedPercent:null});assert.throws(()=>budget.check(),/unavailable/);
  store.set(key,checkpoint);assert.throws(()=>usageCheckpoint(store,plan.id,checkpoint.checkedAt-6000),/unavailable/);
  assert.equal(getPlan(store,plan.id).usage.aiCalls,2);assert.equal(getPlan(store,plan.id).usage.pages,0);
 }finally{store.close();}
});
test('ordinary offline budgets do not need a usage monitor',()=>{const s=new Store(':memory:');try{assert.equal(usageCheckpoint(s,'unmonitored'),null);}finally{s.close();}});

test('explicit temporary 100 percent authorization expires and still stops at exhaustion',()=>{
 const s=new Store(':memory:'),now=Date.parse('2026-11-16T18:00:00Z');try{
  const p={stopAt:88,usageOverride:{stopAt:100,authorizedAt:'2026-11-16T17:00:00Z',expiresAt:'2026-11-17T05:00:00Z',reason:'User authorized the remaining allowance today'}};
  const limit=effectiveUsagePolicy(p,now);assert.equal(limit.stopAt,100);
  assert.equal(effectiveUsagePolicy(p,Date.parse(p.usageOverride.expiresAt)).stopAt,88);
  s.set('usageGuard:today',{checkedAt:now,usedPercent:99.9,...limit,allowAiThrough:1});assert.equal(usageCheckpoint(s,'today',now)?.stopAt,100);
  s.set('usageGuard:today',{checkedAt:now,usedPercent:100,...limit,allowAiThrough:1});assert.throws(()=>usageCheckpoint(s,'today',now),/reserve reached/);
  s.set('usageGuard:today',{checkedAt:limit.expiresAt!,usedPercent:89,...limit,allowAiThrough:1});assert.throws(()=>usageCheckpoint(s,'today',limit.expiresAt),/stale/);
  s.set('usageGuard:today',{checkedAt:now,usedPercent:99,stopAt:101,allowAiThrough:1});assert.throws(()=>usageCheckpoint(s,'today',now),/unavailable/);
 }finally{s.close();}
});

test('the 95 percent policy begins at Wednesday reset without changing today or the pre-reset reserve',()=>{
 const reset='2026-11-18T12:36:11Z',p={stopAt:88,scheduledLimit:{stopAt:95,effectiveAt:reset,reason:'User requested 95 percent after reset'},usageOverride:{stopAt:100,authorizedAt:'2026-11-16T17:00:00Z',expiresAt:'2026-11-17T05:00:00Z',reason:'Today only'}};
 assert.equal(effectiveUsagePolicy(p,Date.parse('2026-11-16T19:00:00Z')).stopAt,100);
 assert.equal(effectiveUsagePolicy(p,Date.parse(reset)-1).stopAt,88);
 assert.equal(effectiveUsagePolicy(p,Date.parse(reset)).stopAt,95);
 assert.equal(effectiveUsagePolicy(p,Date.parse('2026-11-25T13:00:00Z')).stopAt,95);
 const store=new Store(':memory:');try{const now=Date.parse(reset);store.set('usageGuard:reset',{checkedAt:now,usedPercent:94.9,...effectiveUsagePolicy(p,now),allowAiThrough:1});assert.equal(usageCheckpoint(store,'reset',now)?.stopAt,95);store.set('usageGuard:reset',{checkedAt:now,usedPercent:95,stopAt:95,allowAiThrough:1});assert.throws(()=>usageCheckpoint(store,'reset',now),/reserve reached/);}finally{store.close();}
 assert.throws(()=>effectiveUsagePolicy({...p,usageOverride:undefined,scheduledLimit:{...p.scheduledLimit,effectiveAt:'invalid'}}),/Invalid scheduled/);
});
