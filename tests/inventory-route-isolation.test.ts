import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {createPlan,approvePlan,claimPlan,Budget} from '../server/plans.ts';
import {sourceById} from '../server/sources.ts';
import {runInventorySource,inventoryRoutes} from '../server/inventory-discovery.ts';
import {readQueue} from '../server/discovery-queue.ts';
import {areaSearchRoute} from '../server/search-area.ts';
const city='https://www.hollyburn.com/find-an-apartment/?city=Vancouver',map='https://www.hollyburn.com/find-an-apartment?lat=49.286969089766075&lng=-123.13039898872375&city=Vancouver';
const building='https://www.hollyburn.com/building/example/';

test('an unpopulated search shell does not stop another configured route or erase incomplete coverage',async()=>{
 const store=new Store(':memory:'),source=sourceById('hollyburn'),visits:string[]=[];
 try{
  store.set('searchAreaPolicy',{mode:'source-filters',regions:['downtown-vancouver'],existingHomeIds:[],configuredAt:'test',sourceRoutes:{hollyburn:[city,map].map(url=>({url,region:'downtown-vancouver',scope:'vancouver-approximate'}))}});
  const plan=createPlan(store,{sources:[source.id],phase:'inventory',maxPages:2,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);
  const result=await runInventorySource(store,source,new Budget(store,plan.id,plan.caps),mkdtempSync(join(tmpdir(),'route-isolation-')),undefined,{session:(_source,b)=>({stopped:false,start:async()=>{},close:async()=>{},html:async url=>{b.reserve('pages');visits.push(url);return url===city?'<main><select><option>Vancouver</option></select>Select a location</main>':`<a href="${building}">Example</a>`;},resource:async()=>{throw Error('Unexpected resource');},image:async()=>{throw Error('Unexpected photo');}})});
  assert.deepEqual(visits,[city,map]);assert.deepEqual(readQueue(store,source.id).urls,[building]);
  assert.equal(result.state,'partial');assert.match(result.detail,/1 routes retained/);
  const shell=inventoryRoutes(store,source).find(r=>r.url===city)!;assert.equal(shell.status,'blocked');assert.equal(shell.next,city);assert.equal(shell.pages,1);assert.match(shell.detail,/empty inventory is not established/);
  assert.equal(shell.noCardsFailures,1);assert.ok(shell.retryAt);
  assert.equal(inventoryRoutes(store,source,Date.parse(shell.retryAt!)-1).find(r=>r.url===city)!.status,'blocked');
  const ready=inventoryRoutes(store,source,Date.parse(shell.retryAt!)).find(r=>r.url===city)!;assert.equal(ready.status,'partial');assert.equal(ready.next,city);assert.equal(ready.pages,1);assert.equal(ready.dynamicPending,true);
 }finally{store.close();}
});

test('route isolation never swallows a real source access warning',async()=>{
 const store=new Store(':memory:'),source=sourceById('hollyburn'),visits:string[]=[];
 try{
  store.set('searchAreaPolicy',{mode:'source-filters',regions:['downtown-vancouver'],existingHomeIds:[],configuredAt:'test',sourceRoutes:{hollyburn:[city,map].map(url=>({url,region:'downtown-vancouver',scope:'vancouver-approximate'}))}});
  const plan=createPlan(store,{sources:[source.id],phase:'inventory',maxPages:2,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);
  await assert.rejects(runInventorySource(store,source,new Budget(store,plan.id,plan.caps),mkdtempSync(join(tmpdir(),'route-warning-')),undefined,{session:(_source,b)=>({stopped:false,start:async()=>{},close:async()=>{},html:async url=>{b.reserve('pages');visits.push(url);throw Error('Source access warning: HTTP 429');},resource:async()=>'',image:async()=>{throw Error('Unexpected photo');}})}),/access warning/);
  assert.deepEqual(visits,[city]);
  assert.equal(inventoryRoutes(store,source,Date.now()+86400000).find(r=>r.url===city)!.status,'blocked','route retries must never reinterpret an access warning as an empty render');
 }finally{store.close();}
});

test('explicit EasyRent Vancouver selection admits its FacetWP pages without enabling different cities',()=>{
 const store=new Store(':memory:');try{
  const root='https://www.easyrent.ca/listings/?_city=vancouver';
  store.set('searchAreaPolicy',{mode:'source-filters',regions:['downtown-vancouver'],existingHomeIds:[],configuredAt:'test',sourceRoutes:{easyrent:[{url:root,region:'downtown-vancouver',scope:'vancouver-approximate'}]}});
  assert.ok(areaSearchRoute(store,'easyrent',root+'&_paged=2'));assert.equal(areaSearchRoute(store,'easyrent',root.replace('=vancouver','=surrey')+'&_paged=2'),undefined);
 }finally{store.close();}
});
