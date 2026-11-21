import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {Budget,approvePlan,claimPlan,createPlan} from '../server/plans.ts';
import {sourceById} from '../server/sources.ts';
import {SourceSession} from '../server/transport.ts';
import {ChromeSourceSession} from '../server/chrome-source-session.ts';
import {downloadApartmentImage} from '../server/apartments-worker.ts';

function runningBudget(store:Store){
 const plan=createPlan(store,{sources:['vada','craigslist'],assessmentMode:'quick',maxPages:20,maxListings:20,maxPhotos:20,maxAiCalls:0,maxReservedUsd:0});
 approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);
 return new Budget(store,plan.id,plan.caps);
}

for(const status of [404,410])for(const availability of [false,true])test(`HTTP ${status} retains its body only for availability checks (${availability})`,async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});
 const store=new Store(':memory:');try{
  const budget=runningBudget(store),session=new SourceSession(sourceById('craigslist'),budget,'.');
  const body='<div class="removed"><h2>This posting has expired.</h2></div>';
  session.page={goto:async()=>({status:()=>status}),content:async()=>body,locator:()=>({innerText:async()=>'This posting has expired.'})} as any;
  const pending=session.html('https://www.craigslist.org/view/d/example/saved-posting',{availability});
  for(let i=0;i<10;i++)await Promise.resolve();t.mock.timers.tick(4000);
  assert.equal(await pending,availability?body:null);assert.equal(session.lastResponseStatus,status);
  assert.equal(session.stopped,false);assert.equal(budget.remaining('pages'),19);
 }finally{store.close();}
});

test('availability error bodies still enforce access-warning stops',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});
 const store=new Store(':memory:');try{
  const session=new SourceSession(sourceById('craigslist'),runningBudget(store),'.');
  session.page={goto:async()=>({status:()=>410}),content:async()=>'<h1>Access denied</h1>',locator:()=>({innerText:async()=>'Access denied'})} as any;
  const pending=assert.rejects(session.html('https://www.craigslist.org/view/d/example/saved-posting',{availability:true}),/access challenge/);
  for(let i=0;i<10;i++)await Promise.resolve();t.mock.timers.tick(4000);await pending;
  assert.equal(session.stopped,true);assert.equal(store.health()[0].needs_attention,1);
 }finally{store.close();}
});

test('real browser transport records adaptive success for both pages and downloaded photos',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});
 const store=new Store(':memory:');try{
  const budget=runningBudget(store),session=new SourceSession(sourceById('vada'),budget,'.');
  session.page={goto:async()=>({status:()=>200}),content:async()=>'<main>Apartment details</main>',locator:()=>({innerText:async()=>'Apartment details'})} as any;
  session.context={request:{get:async()=>({status:()=>200,ok:()=>true,body:async()=>Buffer.from('saved-photo-bytes')})}} as any;
  const page=session.html('https://vadapm.com/example');
  for(let i=0;i<10;i++)await Promise.resolve();t.mock.timers.tick(4000);await page;
  assert.equal(store.get<{successes:number}>('sourcePace:vada:page')?.successes,1);
  await session.image('https://vadapm.com/example.jpg');
  assert.equal(store.get<{successes:number}>('sourcePace:vada:image')?.successes,1);
  assert.equal(store.db.prepare('SELECT count(*) n FROM requests').get()!.n,2);
 }finally{store.close();}
});

test('browser photo warning honors Retry-After without retrying or warming adaptive pacing',async()=>{
 const store=new Store(':memory:');try{
  const budget=runningBudget(store),session=new SourceSession(sourceById('vada'),budget,'.');let calls=0;
  session.context={request:{get:async()=>{calls++;return {status:()=>429,headers:()=>({'retry-after':'172800'}),ok:()=>false};}}} as any;
  const now=Date.now();await assert.rejects(session.image('https://vadapm.com/example.jpg'),/paused/);
  assert.equal(calls,1);assert.ok(Date.parse(store.health()[0].paused_until!)>=now+172800000);
  assert.equal(store.get<{successes:number}>('sourcePace:vada:image')?.successes,0);
 }finally{store.close();}
});

test('recreated source sessions retain page and image pacing while other sources proceed independently',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});
 const store=new Store(':memory:');try{
  const budget=runningBudget(store),source=sourceById('vada'),first=new SourceSession(source,budget,'.');
  await first.waitForAccess('page');await first.waitForAccess('image');await first.close();
  t.mock.timers.tick(4000);
  const retry=new SourceSession(source,budget,'.');let nextPage=false;
  const pending=retry.waitForAccess('page').then(()=>{nextPage=true;});
  await new SourceSession(sourceById('craigslist'),budget,'.').waitForAccess('page');
  await retry.waitForAccess('image');
  assert.equal(nextPage,false);t.mock.timers.tick(5999);await Promise.resolve();assert.equal(nextPage,false);
  t.mock.timers.tick(1);await pending;assert.equal(nextPage,true);
  let nextImage=false;await retry.waitForAccess('image');
  const image=new SourceSession(source,budget,'.').waitForAccess('image').then(()=>{nextImage=true;});
  t.mock.timers.tick(999);await Promise.resolve();assert.equal(nextImage,false);
  t.mock.timers.tick(1);await image;assert.equal(nextImage,true);
 }finally{store.close();}
});

test('Chrome image sessions and Apartments image failures retain their gap across retries',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});
 const store=new Store(':memory:');try{
  const budget=runningBudget(store);let requests=0;
  t.mock.method(globalThis,'fetch',async()=>{requests++;return new Response('',{status:404});});
  const source=sourceById('zillow'),imageUrl='https://photos.zillowstatic.com/photo.jpg';
  await assert.rejects(new ChromeSourceSession(source,budget).image(imageUrl),/Image unavailable/);
  const second=assert.rejects(new ChromeSourceSession(source,budget).image(imageUrl),/Image unavailable/);
  assert.equal(requests,1);t.mock.timers.tick(999);await Promise.resolve();assert.equal(requests,1);
  t.mock.timers.tick(1);await second;assert.equal(requests,2);
  const apartmentUrl='https://images1.apartments.com/photo.jpg';
  await assert.rejects(downloadApartmentImage(apartmentUrl,budget),/Image unavailable/);
  const retry=assert.rejects(downloadApartmentImage(apartmentUrl,budget),/Image unavailable/);
  assert.equal(requests,3);t.mock.timers.tick(999);await Promise.resolve();assert.equal(requests,3);
  t.mock.timers.tick(1);await retry;assert.equal(requests,4);
 }finally{store.close();}
});

test('source pacing rechecks cancellation and source pauses before allowing the next access',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:100000});
 const store=new Store(':memory:');try{
  const budget=runningBudget(store),source=sourceById('vada');
  await new SourceSession(source,budget,'.').waitForAccess('page');
  const pending=new SourceSession(source,budget,'.').waitForAccess('page'),rejected=assert.rejects(pending,/paused/);
  store.pause(source.id,'Access warning',true);t.mock.timers.tick(10000);await rejected;
  assert.equal(store.get('sourceAccessAt:vada:page'),100000);
  await new SourceSession(sourceById('craigslist'),budget,'.').waitForAccess('page');
  const cancelled=new SourceSession(sourceById('craigslist'),budget,'.').waitForAccess('page'),stopped=assert.rejects(cancelled,/Scan stopped/);
  store.db.prepare("UPDATE plans SET state='cancelled' WHERE id=?").run(budget.id);t.mock.timers.tick(10000);await stopped;
  assert.equal(store.get('sourceAccessAt:craigslist:page'),110000);
 }finally{store.close();}
});
