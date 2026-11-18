import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {sourceById} from '../server/sources.ts';
import {createPlan,approvePlan,getPlan} from '../server/plans.ts';
import {runRegularPlan} from '../server/regular-worker.ts';
import {discoveryCards,listingUrl} from '../server/source-discovery.ts';

test('current Zumper unit buttons are discovered from their embedded listing URLs',()=>{
 const source=sourceById('zumper'),unit='/listings/1234567p/studio-west-end-vancouver-bc';
 const state={currentSearch:{listables:{listables:[{url:unit,min_price:2400,max_price:2400,min_bedrooms:0,max_bedrooms:0,city:'Vancouver',neighborhood_name:'West End'},{url:'/listings/7654321p/one-bedroom-vancouver-bc',min_price:2300,max_price:2800},{url:'https://example.invalid/listings/1234567p/suite'}]}},relatedListings:[{url:'/listings/9999999p/unrelated'}]};
 const cards=discoveryCards('<script>window.__PRELOADED_STATE__ = '+JSON.stringify(state)+';</script>',source);
 assert.equal(cards.length,2);assert.equal(cards[0].url,'https://www.zumper.com'+unit);assert.equal(cards[0].rent,2400);assert.equal(cards[0].beds,0);assert.equal(cards[1].rent,null);assert.equal(listingUrl('/listings/not-a-unit',source),null);
});

test('unit-only Zumper discovery passes building-only pages without spending unit candidate attempts',async()=>{
 const s=new Store(':memory:');try{
  const source=sourceById('zumper'),next=source.search+'?page=2',unit='https://www.zumper.com/apartments-for-rent/12345678p/one-bedroom-vancouver-bc',building='https://www.zumper.com/apartment-buildings/p123/example-vancouver-bc';
  s.set('discoveryQueue:zumper',{urls:[building],next:null,offerings:[]});
  const p=createPlan(s,{sources:['zumper'],maxPages:3,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0,newListingsOnly:true,unitListingsOnly:true,targetNewListingsPerSource:1});approvePlan(s,p.id,'APPROVE ONE SCAN');
  const visited:string[]=[];
  await runRegularPlan(s,p.id,mkdtempSync(join(tmpdir(),'af-zumper-units-')),undefined,{session:(_source,b)=>({stopped:false,start:async()=>{},close:async()=>{},resource:async()=>{throw Error('No extra resource needed');},image:async()=>{throw Error('No image request allowed');},html:async url=>{b.reserve('pages');b.reserve('requests');visited.push(url);if(url===source.search)return `<a href="${building}">Building</a><a rel="next" href="${next}">Next</a>`;if(url===next)return `<a href="${unit}">Apartment</a>`;assert.equal(url,unit);return '<script>window.__PRELOADED_STATE__ = '+JSON.stringify({detail:{entity:{data:{listing_id:12345678,title:'One bedroom',address:'100 Example St',unit:'2',price:2400,bedrooms:1,media:[],description:'Apartment rental'}}}})+';</script>';}})});
  assert.deepEqual(visited,[source.search,next,unit]);assert.equal(s.homes().length,1);assert.equal(s.homes()[0].listing.offeringKind,'unit');assert.equal(getPlan(s,p.id).usage.listings,1);assert.equal(getPlan(s,p.id).sources[0].newListings,1);assert.deepEqual(s.get(`unitDiscoveryExclusions:${p.id}:zumper`),{urls:[building],offerings:0});
 }finally{s.close();}
});
