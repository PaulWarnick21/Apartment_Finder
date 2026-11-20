import test from 'node:test';import assert from 'node:assert/strict';
import {austevilleScopedFeed,austevilleScopedCards} from '../server/austeville-discovery.ts';import {sourceById} from '../server/sources.ts';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Store} from '../server/db.ts';import {createPlan,approvePlan,claimPlan,Budget} from '../server/plans.ts';import {runInventorySource} from '../server/inventory-discovery.ts';import {readQueue} from '../server/discovery-queue.ts';
const endpoint='https://www.austeville.com/wp-json/wp/v2/re_property?per_page=100';
const html=(value='19',url=endpoint)=>`<script>var propertySearchConfig = ${JSON.stringify({mode:'residential',endpoints:{property:url},filters:[{id:'neighbourhood',initialValue:[value]}]})};</script>`;
test('inventory worker recovers scoped source data without admitting other neighbourhoods',async()=>{
 const store=new Store(':memory:'),source=sourceById('austeville'),url='https://www.austeville.com/vacancies/?neighbourhood=19';
 try{
  store.set('searchAreaPolicy',{mode:'source-filters',regions:['downtown-vancouver'],existingHomeIds:[],configuredAt:new Date().toISOString(),sourceRoutes:{austeville:[{url,region:'downtown-vancouver'}]}});
  const plan=createPlan(store,{sources:['austeville'],assessmentMode:'quick',phase:'inventory',maxPages:1,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);const budget=new Budget(store,plan.id,plan.caps);
  let requests=0;const rows=[{id:10,parent:0,status:'publish',acf:{property_neighbourhood_id:[19],property_address:{city:'Vancouver'}}},{id:20,parent:0,status:'publish',acf:{property_neighbourhood_id:[27],property_address:{city:'West Vancouver'}}},...[10,20].map(parent=>({id:parent+1,parent,status:'publish',link:`https://www.austeville.com/property/building-${parent}/suite-1/`,acf:{rent:{cost:2500},available_at:'2026-12-01',bedroom_count:1}}))];
  const result=await runInventorySource(store,source,budget,mkdtempSync(join(tmpdir(),'af-scoped-feed-')),undefined,{session:()=>({start:async()=>{},close:async()=>{},html:async()=>{budget.reserve('pages');return html();},resource:async(actual:string)=>{assert.equal(actual,endpoint);requests++;budget.reserve('requests');return JSON.stringify(rows);}}) as any});
  assert.equal(result.state,'complete');assert.equal(requests,1);assert.deepEqual(readQueue(store,'austeville').urls,['https://www.austeville.com/property/building-10/suite-1/']);
 }finally{store.close();}
});
test('fallback requires the exact page-selected neighbourhood and an advertised source endpoint',()=>{
 assert.deepEqual(austevilleScopedFeed(html(),'https://www.austeville.com/vacancies/?neighbourhood=19'),{endpoint,neighbourhood:19});
 for(const [page,url] of [[html(),'https://www.austeville.com/vacancies/'],[html('26'),'https://www.austeville.com/vacancies/?neighbourhood=19'],[html('19','https://other.example/feed'),'https://www.austeville.com/vacancies/?neighbourhood=19']])assert.equal(austevilleScopedFeed(page,url),null);
});
test('only available suites with matching published building evidence enter scoped discovery',()=>{
 const parent={id:10,parent:0,status:'publish',acf:{property_neighbourhood_id:[19],property_address:{city:'Vancouver'}}};
 const unit={id:11,parent:10,status:'publish',link:'https://www.austeville.com/property/test/suite-1/',title:{rendered:'Suite 1'},acf:{rent:{cost:2500},bedroom_count:1,available_at:'2026-12-01'}};
 const rows=[parent,unit,{...unit,id:12,parent:11},{...unit,id:13,parent:999},{...unit,id:14,status:'draft'},{...unit,id:15,acf:{...unit.acf,property_neighbourhood_id:[26]}},{...unit,id:16,acf:{...unit.acf,rent:{cost:''}}}];
 assert.equal(austevilleScopedCards(JSON.stringify(rows),sourceById('austeville'),19).length,1);
 assert.equal(austevilleScopedCards(JSON.stringify(rows),sourceById('austeville'),26).length,0);
 assert.throws(()=>austevilleScopedCards(JSON.stringify(Array(100).fill(parent)),sourceById('austeville'),19),/further pages/);
});
