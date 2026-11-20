import test from 'node:test';
import assert from 'node:assert/strict';
import {DecisionQueue} from '../src/decision-queue.ts';
import {ApiError} from '../src/api-request.ts';
import {retainUnchangedHomes} from '../src/desk-refresh.ts';
import {DecisionSaveNotice} from '../src/decision-status.tsx';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {listingSchema,type Home} from '../src/domain.ts';
import {deskCategory} from '../src/desk-category.ts';

const home=(id:number):Home=>({id,listing:listingSchema.parse({source:'fixture',sourceId:String(id),url:'https://example.test/'+id,title:'Apartment',address:'Example',rent:2400,beds:1}),stage:'Unreviewed',reviewMode:'quick',quickRank:{grade:'A',rankValue:75,eligible:true,reasons:[],flags:[]},score:{value:3,low:3,high:3,base:3,adjustments:[],flags:[],reasons:[],eligible:true,uncertain:false,view:'Unknown'},notes:'Saved note',followUp:'',viewing:'',rescued:false,revision:1,firstSeen:'2026-11-18',updatedAt:'2026-11-18',possibleDuplicates:[],postings:[]});
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
const saved=(h:Home,stage:Home['stage']):Home=>({...h,stage,revision:h.revision+1});

test('rapid independent clicks move cards immediately while only two writes run; duplicate clicks cannot enqueue twice',async()=>{
 const sends:Array<{path:string;body:any;pending:ReturnType<typeof deferred<Home>>}>=[];
 const queue=new DecisionQueue(async(path,_method,body)=>{const pending=deferred<Home>();sends.push({path,body,pending});return pending.promise;});
 const homes=[home(1),home(2),home(3)];
 assert.equal(queue.enqueue(homes[0],'Interested'),true);queue.enqueue(homes[1],'Not Interested');queue.enqueue(homes[2],'Interested');
 assert.equal(queue.enqueue(homes[0],'Not Interested'),false);assert.equal(sends.length,2);
 assert.deepEqual(queue.project(homes).map(deskCategory),['Scoring in Progress','Closed','Scoring in Progress']);
 assert.deepEqual(homes.map(h=>h.stage),['Unreviewed','Unreviewed','Unreviewed']);
 assert.equal(queue.blocked(4),false);
 sends[1].pending.resolve(saved(homes[1],'Not Interested'));await flush();assert.equal(sends.length,3);
 sends[0].pending.resolve(saved(homes[0],'Interested'));sends[2].pending.resolve(saved(homes[2],'Interested'));await flush();
 assert.ok(queue.snapshot().every(entry=>entry.status==='saved'));assert.equal(sends[0].body.notes,'Saved note');
});

test('stale polls cannot undo pending or acknowledged decisions, and newer server changes win',async()=>{
 const h=home(1),pending=deferred<Home>(),queue=new DecisionQueue(()=>pending.promise);
 queue.enqueue(h,'Not Interested');queue.reconcile([h]);assert.equal(queue.project([h])[0].stage,'Not Interested');
 const result=saved(h,'Not Interested');pending.resolve(result);await flush();
 queue.reconcile([h]);assert.equal(queue.project([h])[0].stage,'Not Interested');assert.equal(queue.snapshot().length,1);
 queue.reconcile([result]);assert.equal(queue.snapshot().length,0);
 const newer={...result,revision:3,stage:'Unreviewed' as const};assert.equal(queue.project([newer])[0].stage,'Unreviewed');
});

test('a failed write rolls back only its home; later saves continue and retry preserves fresh notes',async()=>{
 const homes=[home(1),home(2)],first=deferred<Home>();let calls=0;const writes:any[]=[];
 const queue=new DecisionQueue(async(path,method,body)=>{
  if(method==='GET'||!method)return {...homes[0],notes:'New note from another tab',revision:4};
  calls++;writes.push(body);if(calls===1)return first.promise;
  return saved(path==='homes/1'?{...homes[0],notes:'New note from another tab',revision:4}:homes[1],(body as any).stage);
 },1);
 queue.enqueue(homes[0],'Interested');queue.enqueue(homes[1],'Not Interested');first.reject(new Error('Offline'));await flush();
 assert.equal(queue.project(homes)[0].stage,'Unreviewed');assert.equal(queue.project(homes)[1].stage,'Not Interested');
 assert.equal(queue.snapshot()[0].status,'failed');queue.retry(1);await flush();
 assert.equal(writes[2].notes,'New note from another tab');assert.equal(writes[2].revision,4);assert.equal(queue.project(homes)[0].stage,'Interested');
});

test('retry reconciles a lost successful response without a second Interested write',async()=>{
 const h=home(1);let writes=0;
 const queue=new DecisionQueue(async(_path,method)=>{if(method==='PUT'){writes++;throw Error('Response lost');}return saved(h,'Interested');});
 queue.enqueue(h,'Interested');await flush();queue.retry(h.id);await flush();
 assert.equal(writes,1);assert.equal(queue.project([h])[0].stage,'Interested');assert.equal(queue.snapshot()[0].status,'saved');
});

test('retry refuses conflicting stage or note edits, retaining the failed decision for review',async()=>{
 const h=home(1);let writes=0;
 const queue=new DecisionQueue(async(_path,method)=>{if(method==='PUT'){writes++;throw Error('Stale revision');}return {...h,revision:2,notes:'A newer note'};});
 queue.enqueue(h,'Not Interested',{notes:'Unsaved detail draft'});await flush();queue.retry(h.id);await flush();
 assert.equal(writes,1);assert.equal(queue.snapshot()[0].status,'failed');assert.match(queue.snapshot()[0].error!,/notes or dates changed/);
 queue.dismiss(h.id);queue.reconcile([h]);assert.equal(queue.snapshot().length,0);
 const other=new DecisionQueue(async(_path,method)=>{if(method==='PUT')throw Error('Response failed');return saved(h,'Not Interested');});
 other.enqueue(h,'Interested');await flush();other.retry(h.id);await flush();assert.match(other.snapshot()[0].error!,/saved stage changed/);
});

test('a later failed decision retains the earlier acknowledged stage even before polling catches up',async()=>{
 const h=home(1);let calls=0;
 const queue=new DecisionQueue(async()=>{if(++calls===1)return saved(h,'Interested');throw Error('Offline');});
 queue.enqueue(h,'Interested');await flush();const interested=queue.project([h])[0];
 queue.enqueue(interested,'Not Interested');await flush();assert.equal(queue.project([h])[0].stage,'Interested');
 queue.dismiss(h.id);assert.equal(queue.project([h])[0].stage,'Interested');
});

test('an unreadable acknowledgement is confirmed automatically without repeating the write',async()=>{
 const h=home(1);let writes=0,reads=0;
 const queue=new DecisionQueue(async(_path,method)=>{
  if(method==='PUT'){writes++;throw new ApiError('Unreadable response',true,502);}
  reads++;return saved(h,'Interested');
 });
 queue.enqueue(h,'Interested');await flush();
 assert.equal(writes,1);assert.equal(reads,1);assert.equal(queue.snapshot()[0].status,'saved');
});

test('scanner revision changes recover automatically while preserving newer user notes',async()=>{
 const h=home(1),current={...h,revision:4,notes:'A newer saved note'};const writes:any[]=[];
 const queue=new DecisionQueue(async(_path,method,body)=>{
  if(method!=='PUT')return current;
  writes.push(body);if(writes.length===1)throw new ApiError('This apartment changed.',true,409);
  return saved(current,'Not Interested');
 });
 queue.enqueue(h,'Not Interested');await flush();
 assert.equal(queue.snapshot()[0].status,'saved');assert.equal(writes.length,2);
 assert.equal(writes[1].revision,4);assert.equal(writes[1].notes,current.notes);
});

test('automatic recovery refuses conflicting edits or decisions and is bounded when offline',async()=>{
 for(const current of [{...home(1),revision:2,notes:'Changed elsewhere'},{...home(1),revision:2,stage:'Interested' as const}]){
  let writes=0;const queue=new DecisionQueue(async(_path,method)=>{
   if(method==='PUT'){writes++;throw new ApiError('Changed',true,409);}return current;
  });
  queue.enqueue(home(1),'Not Interested',{notes:'My draft'});await flush();
  assert.equal(writes,1);assert.equal(queue.snapshot()[0].status,'failed');
 }
 let writes=0,reads=0;const queue=new DecisionQueue(async(_path,method)=>{
  if(method==='PUT'){writes++;throw new ApiError('Connection interrupted',true);}reads++;return home(1);
 });
 queue.enqueue(home(1),'Not Interested');await flush();assert.equal(writes,2);assert.equal(reads,2);assert.equal(queue.snapshot()[0].status,'failed');
});

test('a late poll clears a lost-response warning only when stage and submitted edits are confirmed',async()=>{
 const h=home(1),queue=new DecisionQueue(async()=>{throw new ApiError('Offline',true);});
 queue.enqueue(h,'Not Interested',{notes:'My note'});await flush();assert.equal(queue.snapshot()[0].status,'failed');
 queue.reconcile([saved(h,'Not Interested')]);assert.equal(queue.snapshot()[0].status,'failed');
 queue.reconcile([{...saved(h,'Not Interested'),notes:'My note'}]);assert.equal(queue.snapshot().length,0);
});

test('malformed successful responses cannot mark a decision saved or block the next apartment',async()=>{
 const queue=new DecisionQueue(async()=>({ok:true} as unknown as Home),1);
 queue.enqueue(home(1),'Interested');queue.enqueue(home(2),'Not Interested');await flush();
 assert.deepEqual(queue.snapshot().map(entry=>entry.status),['failed','failed']);
 assert.equal(queue.blocked(3),false);
});

test('polls reuse unchanged card objects while applying new facts and user decisions',()=>{
 const before=[home(1),home(2)],after=structuredClone(before);after[1].stage='Not Interested';after[1].revision++;
 const next=retainUnchangedHomes(before,[...after,home(3)]);
 assert.equal(next[0],before[0]);assert.equal(next[1],after[1]);assert.equal(next[2].id,3);assert.equal(before[1].stage,'Unreviewed');
});

test('failed save snapshots change identity so memoized cards replace pending status with recovery controls',async()=>{
 const pending=deferred<Home>(),queue=new DecisionQueue(()=>pending.promise);
 queue.enqueue(home(1),'Not Interested');const before=queue.snapshot()[0];
 assert.equal(before.status,'saving');pending.reject(new Error('Connection unavailable'));await flush();
 const after=queue.snapshot()[0];assert.notEqual(after,before);assert.equal(before.status,'saving');assert.equal(after.status,'failed');
 const html=renderToStaticMarkup(createElement(DecisionSaveNotice,{entry:after,retry:()=>{},dismiss:()=>{}}));
 assert.match(html,/wasn’t confirmed/);assert.match(html,/Retry Save/);assert.match(html,/Keep Current State/);
 assert.doesNotMatch(html,/Decision save pending|disabled/);
});

test('the inline notice labels only active saves as waiting and keeps confirmed saves quiet',()=>{
 const entry={home:home(1),stage:'Interested' as const,edits:{},at:'2026-11-19',status:'queued' as const};
 const render=(status:'queued'|'saving'|'saved')=>renderToStaticMarkup(createElement(DecisionSaveNotice,{entry:{...entry,status},retry:()=>{},dismiss:()=>{}}));
 assert.match(render('queued'),/Waiting to save/);assert.match(render('saving'),/Saving/);assert.equal(render('saved'),'');
});
