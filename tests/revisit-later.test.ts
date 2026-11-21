import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {listingSchema,type Home} from '../src/domain.ts';
import {deskCategory} from '../src/desk-category.ts';
import {reviewDecisions} from '../src/review-presentation.ts';
import {shortlistBackup} from '../server/shortlist-backup.ts';
import {DecisionQueue} from '../src/decision-queue.ts';
import {ApiError} from '../src/api-request.ts';

const listing=(id='one')=>listingSchema.parse({source:'fixture',sourceId:id,url:`https://example.test/${id}`,title:'Apartment',address:'123 Example Street',rent:2400,beds:1,photos:[{id:'p',url:'https://example.test/p.jpg',local:'p.jpg'}]});
function ready(store:Store,id:string){const h=store.ingest(listing(id));store.db.prepare("UPDATE homes SET stage='Interested',notes='Keep my note' WHERE id=?").run(h.id);store.set(`fullReview:${h.id}`,{status:'complete',updatedAt:new Date().toISOString()});return store.home(h.id)!;}
const update=(store:Store,h:Home,changes:Partial<Home>)=>store.update(h.id,h.revision,{stage:h.stage,notes:h.notes,followUp:h.followUp,viewing:h.viewing,rescued:h.rescued,...changes})!;

test('revisit choice survives listing refresh, restart and shortlist backup; leaving Interested clears it',()=>{
 const file=join(mkdtempSync(join(tmpdir(),'revisit-later-')),'apartments.sqlite');let store=new Store(file);
 try{
  store.set('reviewWorkflow',{mode:'quick-first'});let h=ready(store,'one');
  h=update(store,h,{revisitLater:true,notes:'Revisit when ready'});assert.equal(h.revisitLater,true);assert.equal(deskCategory(h),'Interested');
  assert.equal(store.get<Home['fullReview']>(`fullReview:${h.id}`)?.status,'complete');
  assert.throws(()=>update(store,{...h,revision:h.revision-1},{revisitLater:false}),/changed/);
  store.ingest({...listing(),rent:2450});h=store.home(h.id)!;assert.equal(h.revisitLater,true);assert.equal(h.notes,'Revisit when ready');
  assert.equal(shortlistBackup(file).apartments[0].revisitLater,true);
  store.close();store=new Store(file);h=store.home(h.id)!;assert.equal(h.revisitLater,true);
  h=update(store,h,{notes:'Still interested'});assert.equal(h.revisitLater,true);
  h=update(store,h,{stage:'Serious Candidates'});assert.equal(h.revisitLater,false);assert.equal(h.notes,'Still interested');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM plans').get()!.n,0);
 }finally{store.close();}
});

test('only completed Interested homes can defer; Review Now, undo and Not Interested preserve normal workflow',()=>{
 const store=new Store(':memory:');try{
  store.set('reviewWorkflow',{mode:'quick-first'});let h=ready(store,'one');
  store.set(`fullReview:${h.id}`,{status:'paused'});assert.throws(()=>update(store,h,{revisitLater:true}),/fully scored/);
  assert.ok(!reviewDecisions(store.home(h.id)!).some(d=>d.label==='Revisit Later'));
  store.set(`fullReview:${h.id}`,{status:'complete'});h=update(store,h,{revisitLater:true});
  assert.ok(reviewDecisions(h).some(d=>d.label==='Review Now'&&d.revisitLater===false));
  store.undo(h.id);h=store.home(h.id)!;assert.equal(h.revisitLater,false);
  h=update(store,h,{revisitLater:true});h=update(store,h,{revisitLater:false});assert.equal(h.revisitLater,false);
  h=update(store,h,{revisitLater:true});h=update(store,h,{stage:'Not Interested'});assert.equal(h.revisitLater,false);assert.equal(deskCategory(h),'Closed');
 }finally{store.close();}
});

test('same-stage duplicate merge retains a deferred decision and split restores original states',()=>{
 const store=new Store(':memory:');try{
  const keep=ready(store,'keep'),other=update(store,ready(store,'other'),{revisitLater:true});
  store.mergeHomes(keep.id,other.id);assert.equal(store.home(keep.id)!.revisitLater,true);
  const merge=store.mergeHistory(keep.id)[0] as {id:number};store.splitMerge(merge.id);
  assert.equal(store.home(keep.id)!.revisitLater,false);assert.equal(store.home(other.id)!.revisitLater,true);
 }finally{store.close();}
});

test('revisit toggle projects immediately, recovers a lost acknowledgement and cannot be cleared by unrelated notes',async()=>{
 const store=new Store(':memory:');try{
  const h=ready(store,'one');let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let puts=0;
  const queue=new DecisionQueue(async(_path,method,body)=>{
   if(method==='PUT'){puts++;await gate;const input=body as Parameters<Store['update']>[2]&{revision:number};store.update(h.id,input.revision,input);throw new ApiError('Lost reply',true);}
   return store.home(h.id)!;
  });
  queue.enqueue(h,'Interested',{revisitLater:true});assert.equal(queue.project([h])[0].revisitLater,true);assert.equal(queue.project([h])[0].stage,'Interested');
  release();await new Promise(resolve=>setImmediate(resolve));assert.equal(queue.snapshot()[0].status,'saved');assert.equal(puts,1);
  const saved=store.home(h.id)!;queue.reconcile([saved]);assert.equal(queue.project([saved])[0].revisitLater,true);
  let sent:Record<string,unknown>={};const notesQueue=new DecisionQueue(async(_path,_method,body)=>{sent=body as typeof sent;return {...saved,notes:'Another note',revision:saved.revision+1};});
  notesQueue.enqueue(saved,'Interested',{notes:'Another note'});await new Promise(resolve=>setImmediate(resolve));assert.ok(!('revisitLater' in sent));
 }finally{store.close();}
});

test('Serious Candidates deferral and personal tags survive updates, restart and backup; stage exits clear only deferral',()=>{
 const file=join(mkdtempSync(join(tmpdir(),'serious-later-')),'apartments.sqlite');let store=new Store(file);
 try{
  store.set('reviewWorkflow',{mode:'quick-first'});let h=update(store,ready(store,'one'),{revisitLater:true});
  h=update(store,h,{stage:'Serious Candidates'});assert.equal(h.revisitLater,false);
  const originalScore=h.score;h=update(store,h,{revisitLater:true,tagLongTermLease:true,tagUnfurnished:true});assert.deepEqual(h.score,originalScore);
  assert.equal(deskCategory(h),'Serious Candidates');assert.ok(reviewDecisions(h).some(d=>d.label==='Review Now'));
  const score=h.score;store.ingest({...listing(),rent:2450});h=store.home(h.id)!;
  assert.equal(h.tagUnfurnished,true);assert.equal(h.listing.furnished,null,'personal tags do not overwrite listing evidence');
  store.close();store=new Store(file);h=store.home(h.id)!;assert.equal(h.revisitLater,true);
  const backup=shortlistBackup(file).apartments[0];assert.equal(backup.revisitLater,true);assert.equal(backup.tagLongTermLease,true);assert.equal(backup.tagUnfurnished,true);
  h=update(store,h,{tagLongTermLease:false});store.undo(h.id);h=store.home(h.id)!;assert.equal(h.tagLongTermLease,true);
  h=update(store,h,{notes:'Pursue another month'});assert.equal(h.revisitLater,true);assert.equal(h.tagLongTermLease,true);
  h=update(store,h,{stage:'Ready to Apply'});assert.equal(h.revisitLater,false);assert.equal(h.tagUnfurnished,true);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM plans').get()!.n,0);
  assert.ok(score);
 }finally{store.close();}
});

test('merging Serious Candidates retains both sets of personal tags and split restores their original choices',()=>{
 const store=new Store(':memory:');try{
  let a=update(store,ready(store,'a'),{stage:'Serious Candidates',tagLongTermLease:true});
  let b=update(store,ready(store,'b'),{stage:'Serious Candidates',tagUnfurnished:true});b=update(store,b,{revisitLater:true});
  const merged=store.mergeHomes(a.id,b.id);a=store.home(a.id)!;
  assert.equal(a.revisitLater,true);assert.equal(a.tagLongTermLease,true);assert.equal(a.tagUnfurnished,true);
  store.splitMerge(merged.mergeId);a=store.home(a.id)!;b=store.home(b.id)!;
  assert.equal(a.tagLongTermLease,true);assert.equal(a.tagUnfurnished,false);assert.equal(a.revisitLater,false);
  assert.equal(b.tagLongTermLease,false);assert.equal(b.tagUnfurnished,true);assert.equal(b.revisitLater,true);
 }finally{store.close();}
});

test('failed tag saves roll back and retry keeps both tags while unrelated edits omit them',async()=>{
 const store=new Store(':memory:');try{
  const h=update(store,ready(store,'one'),{stage:'Serious Candidates'});let fail=true;
  const queue=new DecisionQueue(async(_path,method,body)=>{
   if(method==='PUT'){if(fail)throw Error('Offline');const input=body as Parameters<Store['update']>[2]&{revision:number};return store.update(h.id,input.revision,input);}
   return store.home(h.id)!;
  });
  queue.enqueue(h,h.stage,{tagLongTermLease:true,tagUnfurnished:true,revisitLater:true});
  assert.equal(queue.project([h])[0].tagUnfurnished,true);await new Promise(r=>setImmediate(r));
  assert.equal(queue.snapshot()[0].status,'failed');assert.equal(queue.project([h])[0].tagUnfurnished,false);
  fail=false;queue.retry(h.id);await new Promise(r=>setImmediate(r));assert.equal(queue.snapshot()[0].status,'saved');
  assert.equal(store.home(h.id)!.revisitLater,true);assert.equal(store.home(h.id)!.tagLongTermLease,true);
  let sent:Record<string,unknown>={};const current=store.home(h.id)!;
  const notes=new DecisionQueue(async(_p,_m,body)=>{sent=body as typeof sent;return {...current,notes:'new note',revision:current.revision+1};});
  notes.enqueue(current,current.stage,{notes:'new note'});await new Promise(r=>setImmediate(r));assert.ok(!('tagUnfurnished' in sent));assert.ok(!('tagLongTermLease' in sent));
 }finally{store.close();}
});
