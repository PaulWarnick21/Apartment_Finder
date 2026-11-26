import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {createPlan,approvePlan,getPlan,type Budget} from '../server/plans.ts';
import {recoverKijijiSource} from '../server/kijiji-recovery.ts';
import {SourceSession} from '../server/transport.ts';
import {sourceById} from '../server/sources.ts';
const caps={purpose:'access-check',sources:['kijiji'],billingMode:'chatgpt',maxPages:1,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0,maxAddressLookups:0};

test('recovery respects active cooldown and zero-address allowance',()=>{
 const store=new Store(':memory:');try{
  store.pause('kijiji','HTTP 429',true);
  assert.throws(()=>createPlan(store,caps,{accessRecovery:true}),/cooldown/);
  assert.throws(()=>createPlan(store,{...caps,maxAddressLookups:1},{accessRecovery:true}));
  assert.equal(store.db.prepare('SELECT count(*) n FROM plans').get()!.n,0);
 }finally{store.close();}
});

for(const outcome of ['success','empty','warning','cancelled','renewed-cooldown'] as const)test(`Kijiji recovery preserves queue and decisions: ${outcome}`,async()=>{
 const store=new Store(':memory:'),dir=await mkdtemp(join(tmpdir(),'af-kijiji-'));
 try{
  store.pause('kijiji','Previous HTTP 429',true,Date.now()-1);
  store.pause('apartments','Separate access warning',true);
  const queue={urls:['https://www.kijiji.ca/v-apartments-condos/vancouver/saved/1744558383']};store.set('discoveryQueue:kijiji',queue);
  const plan=createPlan(store,caps,{accessRecovery:true});let opened=0;
  const makeSession=(budget:Budget)=>{
   const session=new SourceSession(sourceById('kijiji'),budget,dir,{accessRecovery:true});
   session.start=async()=>{opened++;budget.check();};session.close=async()=>{};
   session.html=async()=>{
    budget.reserve('pages');budget.reserve('requests');
    if(outcome==='warning'){session.warn('HTTP 429',false,'172800');throw Error('HTTP 429');}
    if(outcome==='cancelled')store.db.prepare("UPDATE plans SET state='cancelled' WHERE id=?").run(plan.id);
    return outcome==='empty'?'<main>No results</main>':'<a href="https://www.kijiji.ca/v-apartments-condos/vancouver/apartment/1744558384">Apartment</a>';
   };return session;
  };
  await assert.rejects(recoverKijijiSource(store,plan.id,dir,makeSession),/approved/);assert.equal(opened,0);
  approvePlan(store,plan.id,'APPROVE ONE SCAN');
  if(outcome==='renewed-cooldown'){
   store.pause('kijiji','New HTTP 429',true);
   await assert.rejects(recoverKijijiSource(store,plan.id,dir,makeSession),/cooldown/);assert.equal(opened,0);return;
  }
  await recoverKijijiSource(store,plan.id,dir,makeSession);
  assert.equal(opened,1);assert.deepEqual(store.get('discoveryQueue:kijiji'),queue);assert.equal(store.homes().length,0);
  assert.equal(getPlan(store,plan.id).usage.pages,1);assert.equal(getPlan(store,plan.id).usage.photos,0);assert.equal(getPlan(store,plan.id).usage.aiCalls,0);
  if(outcome==='success')assert.doesNotThrow(()=>store.checkSource('kijiji'));else assert.throws(()=>store.checkSource('kijiji'),/paused/);
  assert.throws(()=>store.checkSource('apartments'),/paused/);
  assert.equal(store.db.prepare('SELECT count(*) n FROM scan_lock').get()!.n,0);
  if(outcome==='warning')assert.ok(Date.parse(store.health().find(h=>h.source==='kijiji')!.paused_until)>Date.now()+47*3600000);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
