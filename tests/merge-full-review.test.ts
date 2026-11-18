import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/db.ts';
import {criteriaSchema,listingSchema,type FullReviewState,type QuickRank} from '../src/domain.ts';
import {Budget,createPlan,approvePlan,claimPlan,getPlan} from '../server/plans.ts';
import {FullReviewService} from '../server/full-review.ts';

function apartment(store:Store,name:string){
 const id=store.ingest(listingSchema.parse({source:'craigslist',sourceId:name,url:`https://example.test/${name}`,title:'Saved apartment',address:`${name} Example Street`,rent:2400,beds:1,galleryComplete:true,expectedPhotos:2,photos:[1,2].map(n=>({id:`${name}-${n}`,url:`https://example.test/${name}-${n}.jpg`,local:`${name}-${n}.jpg`,status:'downloaded'}))})).id;
 const home=store.home(id)!;
 store.update(id,home.revision,{stage:'Interested',notes:`Keep ${name} notes`,followUp:'2026-12-01',viewing:'',rescued:false});
 return id;
}
function runningReview(store:Store,id:number,group:string){
 const plan=createPlan(store,{sources:['craigslist'],assessmentMode:'full',phase:'assessment',fullReviewHomeIds:[id],cachedReviewOnly:true,parallelGroup:group,billingMode:'chatgpt',maxPages:1,maxListings:1,maxPhotos:0,maxAiCalls:12,maxAddressLookups:0,maxReservedUsd:0});
 approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);
 store.set(`fullReview:${id}`,{status:'running',planId:plan.id,detail:'Fixture review',updatedAt:new Date().toISOString()});
 return {...plan,budget:new Budget(store,plan.id,plan.caps)};
}
function setup(){const store=new Store(':memory:');store.set('reviewWorkflow',{mode:'quick-first'});store.set('criteria',criteriaSchema.parse({}));return store;}

test('merging concurrent reviews stops duplicate spending and late completion while preserving the canonical decision and rank',async()=>{
 const store=setup();let service:FullReviewService|undefined;
 try{
  // Construct before queueing, so startup recovery is separate from the running-merge case.
  service=new FullReviewService(store,'.',{hasActive:true,start(){throw Error('Merge must not authorize another review');}},true);
  const keep=apartment(store,'one'),duplicate=apartment(store,'two'),group=randomUUID();
  const rank:QuickRank={grade:'S',rankValue:95,eligible:true,reasons:['Preserved existing rank'],flags:[]};store.set(`preservedQuickRank:${keep}`,rank);
  const canonical=runningReview(store,keep,group),alias=runningReview(store,duplicate,group),before=store.home(keep)!;
  alias.budget.reserveAi();assert.equal(getPlan(store,alias.id).usage.aiCalls,1);
  const result=store.mergeHomes(keep,duplicate,{keep:before.revision,duplicate:store.home(duplicate)!.revision});
  const merged=store.home(keep)!;
  assert.equal(merged.stage,'Interested');assert.equal(merged.followUp,before.followUp);assert.deepEqual(merged.quickRank,rank);
  assert.equal(merged.notes,`Keep one notes\n\n[Apartment #${duplicate}]\nKeep two notes`);
  assert.deepEqual(merged.fullReview,before.fullReview);assert.equal(store.home(duplicate)!.id,keep);
  assert.equal(getPlan(store,canonical.id).state,'running');assert.equal(getPlan(store,alias.id).state,'cancelled');
  assert.equal(store.get<FullReviewState>(`fullReview:${duplicate}`)!.status,'cancelled');
  assert.throws(()=>alias.budget.reserveAi(),/Scan stopped/);canonical.budget.reserveAi();
  // In-flight work may publish its result after cancellation; queue reconciliation ignores it.
  store.set(`fullReviewResult:${alias.id}:${duplicate}`,{complete:true,hardFiltered:false,detail:'Late result'});
  await service.tick();assert.equal(store.get<FullReviewState>(`fullReview:${duplicate}`)!.status,'cancelled');
  store.update(keep,merged.revision,{stage:'Not Interested',notes:merged.notes,followUp:merged.followUp,viewing:merged.viewing,rescued:merged.rescued});
  assert.equal(getPlan(store,canonical.id).state,'cancelled');assert.equal(getPlan(store,alias.id).state,'cancelled');
  assert.equal(store.db.prepare("SELECT count(*) AS n FROM plans WHERE state IN ('draft','approved','running')").get()!.n,0);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM plans').get()!.n,2);
  assert.equal(store.home(keep)!.stage,'Not Interested');assert.deepEqual(store.home(keep)!.quickRank,rank);assert.ok(result.mergeId);
 }finally{await service?.close();store.close();}
});

test('queued aliases and older merged aliases stay cancelled through a merge and split without new authorization',()=>{
 const store=setup();try{
  const keep=apartment(store,'one'),duplicate=apartment(store,'two'),older=apartment(store,'three');
  store.mergeHomes(duplicate,older);
  // An older installation could have left an alias queued; reconcile the entire merged group.
  store.set(`fullReview:${older}`,{status:'queued',detail:'Legacy queued review',updatedAt:new Date().toISOString()});
  const canonicalBefore=store.get(`fullReview:${keep}`),merge=store.mergeHomes(keep,duplicate);
  for(const id of [duplicate,older])assert.equal(store.get<FullReviewState>(`fullReview:${id}`)!.status,'cancelled');
  assert.deepEqual(store.get(`fullReview:${keep}`),canonicalBefore);
  store.splitMerge(merge.mergeId);
  assert.equal(store.home(duplicate)!.stage,'Interested');assert.equal(store.home(duplicate)!.fullReview!.status,'cancelled');
  assert.equal(store.get<FullReviewState>(`fullReview:${older}`)!.status,'cancelled');
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM plans').get()!.n,0);
 }finally{store.close();}
});
