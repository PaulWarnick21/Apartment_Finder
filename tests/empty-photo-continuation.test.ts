import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {Store} from '../server/db.ts';
import {listingSchema} from '../src/domain.ts';
import {createPlan,approvePlan,getPlan} from '../server/plans.ts';
import {runRegularPlan} from '../server/regular-worker.ts';

test('an empty image is recorded as a gap while other photos and apartments continue',async()=>{
 const store=new Store(':memory:');try{
  const photo=(id:string)=>({id,url:`https://vadapm.com/${id}.jpg`});
  const listing=(id:string,photos:ReturnType<typeof photo>[])=>listingSchema.parse({source:'vada',sourceId:id,url:`https://vadapm.com/one-bedroom-rental-${id}`,title:id,address:id,rent:2400,beds:1,galleryComplete:true,expectedPhotos:photos.length,photos});
  const first=store.ingest(listing('first',[photo('empty'),photo('valid-one')])).id,second=store.ingest(listing('second',[photo('valid-two')])).id;
  for(const id of [first,second])store.set(`pendingGallery:${id}`,{source:'vada',homeId:id});
  const p=createPlan(store,{sources:['vada'],maxPages:2,maxListings:2,maxPhotos:3,maxAiCalls:2,maxReservedUsd:0,billingMode:'chatgpt',newListingsOnly:true,targetNewListingsBySource:{vada:0},resumeHomeIds:[first,second]});approvePlan(store,p.id,'APPROVE ONE SCAN');
  const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#aaa'}}).jpeg().toBuffer(),reviewed:number[]=[];
  await runRegularPlan(store,p.id,mkdtempSync(join(tmpdir(),'af-empty-photo-')),undefined,{session:()=>({stopped:false,start:async()=>{},html:async()=>'<a href="https://vadapm.com/one-bedroom-rental-unseen">Another apartment</a>',resource:async()=>'',image:async url=>url.includes('/empty.')?Buffer.alloc(0):bytes,close:async()=>{}}),review:async(l,b)=>{b.reserveAi();reviewed.push(l.homeId!);for(const photo of l.photos.filter(p=>p.local))photo.status='reviewed';}});
  assert.deepEqual(reviewed.sort((a,b)=>a-b),[first,second]);
  assert.equal(store.home(first)!.listing.photos[0].status,'unavailable');
  assert.match(store.home(first)!.listing.photos[0].note,/empty image response/);
  assert.equal(store.home(first)!.listing.photos[1].status,'reviewed');
  assert.equal(store.home(second)!.listing.photos[0].status,'reviewed');
  assert.equal(getPlan(store,p.id).usage.aiCalls,2);
  assert.equal(store.db.prepare('SELECT 1 FROM source_health WHERE source=?').get('vada'),undefined);
 }finally{store.close();}
});
