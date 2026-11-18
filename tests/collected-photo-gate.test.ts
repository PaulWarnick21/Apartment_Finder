import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {createPlan,Budget} from '../server/plans.ts';
import {saveGalleryProgress} from '../server/regular-worker.ts';
import {listingSchema,type Photo} from '../src/domain.ts';
import {deskCategory} from '../src/desk-category.ts';
import {cardSummary} from '../server/desk-state.ts';
import {reviewDecisions} from '../src/review-presentation.ts';
import {photoCollectionExclusion} from '../src/photo-availability.ts';

const listing=()=>listingSchema.parse({source:'craigslist',sourceId:'449-fixture',url:'https://example.test/449',title:'Photo links only',address:'123 Example Street',rent:2400,beds:1,laundry:'in-unit',galleryComplete:true,expectedPhotos:10,photos:Array.from({length:10},(_,i)=>({id:String(i),url:`https://example.test/${i}.jpg`,status:'pending'}))});
test('ten attached URLs with zero downloads are excluded even with a preserved S rank',()=>{
 const store=new Store(':memory:');try{
  store.set('reviewWorkflow',{mode:'quick-first'});const id=store.ingest(listing()).id;
  const rank={grade:'S',rankValue:95,eligible:true,reasons:['Saved rank'],flags:[]};store.set(`preservedQuickRank:${id}`,rank);
  const home=store.home(id)!;assert.equal(deskCategory(home),'Excluded');assert.match(home.deskExclusion!,/No photos collected/);
  assert.equal(deskCategory(cardSummary(home)),'Excluded');assert.deepEqual(home.quickRank,rank);assert.equal(home.stage,'Unreviewed');
  assert.equal(store.db.prepare('SELECT category FROM desk_membership WHERE home_id=?').get(id)!.category,'Excluded');
  assert.deepEqual(reviewDecisions(home).map(d=>d.stage),['Not Interested']);
  assert.throws(()=>store.update(id,home.revision,{stage:'Interested',notes:'',followUp:'',viewing:'',rescued:false}),/No photos collected/);
  assert.equal(store.get(`fullReview:${id}`),undefined);
  assert.equal(store.home(id)!.revision,home.revision);
 }finally{store.close();}
});

test('a saved photo restores eligibility without waiting for visual review or changing decisions or ranks',()=>{
 const store=new Store(':memory:');try{
  store.set('reviewWorkflow',{mode:'quick-first'});const l=listing(),id=store.ingest(l).id,rank=store.home(id)!.quickRank!;
  store.set(`preservedQuickRank:${id}`,rank);store.update(id,store.home(id)!.revision,{stage:'Unreviewed',notes:'Keep my note',followUp:'',viewing:'',rescued:false});
  l.photos[0].local='saved.jpg';l.photos[0].status='downloaded';
  const plan=createPlan(store,{assessmentMode:'quick',sources:['craigslist'],maxPhotos:10,maxAiCalls:0,maxPages:1,maxListings:1,maxReservedUsd:0});
  saveGalleryProgress(store,store.home(id)!,l,new Budget(store,plan.id,plan.caps));
  const ready=store.home(id)!;assert.equal(ready.deskExclusion,undefined);assert.equal(deskCategory(ready),'Unreviewed');assert.equal(ready.notes,'Keep my note');assert.deepEqual(ready.quickRank,rank);
  const interested=store.update(id,ready.revision,{stage:'Interested',notes:ready.notes,followUp:'',viewing:'',rescued:false})!;assert.equal(deskCategory(interested),'Scoring in Progress');
 }finally{store.close();}
});

test('no-photo exclusions preserve Closed decisions and do not masquerade as user rejections',()=>{
 const store=new Store(':memory:');try{
  store.set('reviewWorkflow',{mode:'quick-first'});const id=store.ingest(listing()).id,home=store.home(id)!;
  const closed=store.update(id,home.revision,{stage:'Not Interested',notes:'User decision',followUp:'',viewing:'',rescued:false})!;
  assert.equal(deskCategory(closed),'Closed');assert.match(closed.deskExclusion!,/No photos collected/);
  const reopened=store.reopen(id,closed.revision)!;assert.equal(deskCategory(reopened),'Excluded');assert.equal(reopened.stage,'Unreviewed');assert.equal(reopened.notes,'User decision');
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM history WHERE event='Decision saved'").get()!.count,2);
 }finally{store.close();}
});

test('empty and inaccessible galleries do not pass on status labels alone',()=>{
 const p=listing().photos[0];
 for(const photos of [[],[p],[{...p,status:'downloaded'}],[{...p,status:'reviewed'}],[{...p,status:'unavailable'}],[{...p,local:' '}]] as Photo[][])assert.ok(photoCollectionExclusion({photos}));
 assert.equal(photoCollectionExclusion({photos:[{...p,local:'cached.jpg',status:'downloaded'}]}),undefined);
});
