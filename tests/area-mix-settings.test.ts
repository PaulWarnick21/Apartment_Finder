import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {listingSchema} from '../src/domain.ts';
import {areaMixSettings,updateAreaMixSettings} from '../server/area-mix-settings.ts';
import {createPlan,approvePlan} from '../server/plans.ts';
import {createApp} from '../server/api.ts';

function setup(){const store=new Store(':memory:');store.set('reviewWorkflow',{mode:'quick-first'});store.set('searchAreaPolicy',{mode:'source-filters',regions:['downtown-vancouver','north-vancouver','west-vancouver'],existingHomeIds:[],configuredAt:'2026-11-18T00:00:00Z',sourceRoutes:{}});return store;}
test('area target changes are future-only, revision-protected and never change ranks, notes or scheduling',()=>{
 const store=setup();try{
  const id=store.ingest(listingSchema.parse({source:'craigslist',sourceId:'saved',url:'https://vancouver.craigslist.org/van/apa/d/saved/1234567890.html',title:'Saved',address:'100 Example Street',rent:2400,beds:1})).id;
  const home=store.home(id)!;store.update(id,home.revision,{stage:'Not Interested',notes:'Keep this decision',followUp:'',viewing:'',rescued:false});
  const before=store.home(id)!;store.set('scanSchedule',{enabled:false});store.set('scanProgramme',{enabled:false});
  const first=updateAreaMixSettings(store,{revision:areaMixSettings(store).revision,downtownPercent:85});
  assert.equal(first.downtownPercent,85);assert.equal(first.enabled,true);assert.deepEqual(store.get<any>('areaMixPolicy').baselineHomeIds,[id]);assert.deepEqual(store.home(id),before);
  const next=updateAreaMixSettings(store,{revision:first.revision,downtownPercent:70});assert.equal(next.downtownPercent,70);assert.notEqual(next.revision,first.revision);
  assert.throws(()=>updateAreaMixSettings(store,{revision:first.revision,downtownPercent:90}),/changed/);
  assert.throws(()=>updateAreaMixSettings(store,{revision:next.revision,downtownPercent:101}));assert.deepEqual(store.get('scanProgramme'),{enabled:false});assert.deepEqual(store.get('scanSchedule'),{enabled:false});
  const plan=createPlan(store,{assessmentMode:'quick',sources:['craigslist'],maxPages:2,maxListings:2,maxAiCalls:0,maxPhotos:0,maxReservedUsd:0});approvePlan(store,plan.id,'APPROVE ONE SCAN');
  assert.throws(()=>updateAreaMixSettings(store,{revision:next.revision,downtownPercent:80}),/scan is running or approved/);
  assert.deepEqual(store.home(id),before);
 }finally{store.close();}
});

test('area preference API uses the existing CSRF boundary and does not expose baseline IDs',async()=>{
 const store=setup(),app=createApp(store,mkdtempSync(join(tmpdir(),'area-mix-settings-')),{demo:true});await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));
 const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}/api/`;
 try{
  const state=await(await fetch(base+'state')).json() as any,patch={revision:state.areaMix.revision,downtownPercent:85};
  assert.equal((await fetch(base+'area-mix',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(patch)})).status,403);
  const response=await fetch(base+'area-mix',{method:'PATCH',headers:{'content-type':'application/json','x-af-token':state.csrf},body:JSON.stringify(patch)});assert.equal(response.status,200);
  const saved=await response.json() as any;assert.equal(saved.downtownPercent,85);assert.equal(saved.baselineHomeIds,undefined);assert.equal(saved.enabled,true);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM plans').get()!.n,0);
 }finally{await app.close();store.close();}
});
