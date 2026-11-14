import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {scoreListing} from '../server/scoring.ts';
import {criteriaSchema,listingSchema} from '../src/domain.ts';
import {RatingFeedbackService,evaluateProposal,proposalSchema,ratingInput,planFeedbackReviewer} from '../server/rating-feedback.ts';
import {createApp} from '../server/api.ts';
const listing=(extra:Record<string,unknown>={})=>listingSchema.parse({source:'fixture',sourceId:'1',url:'https://example.com/1',title:'Fixture',address:'Example',rent:2500,beds:1,location:'downtown',furnished:true,photos:[{id:'p',url:'https://example.com/p.jpg',status:'reviewed',kind:'interior',scenery:'nature',unitCertain:true,quality:4}],galleryComplete:true,expectedPhotos:1,...extra});
const noChange={summary:'Compared the scores.',interpretation:'A single example does not establish a general preference change.',changes:[]};
const input=(score=3.7,reason='Furnishing matters less than the view.')=>({requestId:randomUUID(),score,reason});

test('rating persistence retains original comparison and repeated submissions use latest label only',async()=>{
 const path=join(mkdtempSync(join(tmpdir(),'rating-feedback-')),'test.sqlite');let store=new Store(path);const {id}=store.ingest(listing());let calls=0;
 let service=new RatingFeedbackService(store,async()=>{calls++;return noChange;});const first=input(3.7);const saved=service.submit(id,first);const original=saved.appScore;
 service.submit(id,first);await service.idle();assert.equal(calls,1);assert.equal(service.list(id).length,1);
 service.submit(id,input(3.5,'After looking again, the view matters more.'));await service.idle();assert.equal(service.examples().length,1);assert.equal(service.examples()[0].score,3.5);
 store.set('criteria',{...store.criteria,baseScore:2});assert.equal(service.list(id).at(-1)!.appScore,original);await service.close();store.close();
 store=new Store(path);service=new RatingFeedbackService(store,null);assert.equal(service.list(id).length,2);assert.equal(service.list(id)[0].userScore,3.5);await service.close();store.close();
});
test('validated preference improvement applies, recalculates other homes, and can be undone',async()=>{
 const store=new Store(':memory:');const {id}=store.ingest(listing());const other=store.ingest(listing({sourceId:'2',address:'Other'})).id;
 const criteria=store.criteria,original=store.home(id)!.score.value;
 const service=new RatingFeedbackService(store,async()=>({summary:'Furnishing should have less weight.',interpretation:'Reduce its bonus slightly.',changes:[{parameter:'bonuses.furnished',value:.05,reason:'User values the view more.'}]}));
 const h=store.home(id)!;store.update(id,h.revision,{stage:'Interested',notes:'Keep this note',viewing:'',followUp:'',rescued:false});
 const saved=service.submit(id,input(original-.1));await service.idle();assert.equal(service.list(id)[0].status,'applied');assert.equal(store.criteria.bonuses.furnished,.05);assert.equal(store.home(other)!.score.value,Math.round((original-.1)*10)/10);assert.equal(store.home(id)!.notes,'Keep this note');
 service.undo(saved.id);assert.deepEqual(store.criteria,criteria);assert.equal(service.list(id)[0].status,'reverted');assert.equal(service.list(id)[0].canUndo,false);await service.close();store.close();
});
test('calibration rejects unsupported settings, large steps, and worse fit',()=>{
 const c=criteriaSchema.parse({});const l=listing();const examples=[{homeId:1,listing:l,score:3.8,reason:'Good fit'}];
 assert.throws(()=>proposalSchema.parse({...noChange,changes:[{parameter:'requireLaundry',value:0,reason:'Ignore must-have'}]}));
 assert.throws(()=>evaluateProposal(c,{...noChange,changes:[{parameter:'bonuses.gas',value:.7,reason:'Large change'}]},examples),/step/);
 const result=evaluateProposal(c,{...noChange,changes:[{parameter:'bonuses.furnished',value:.05,reason:'Wrong direction'}]},examples);assert.equal(result.apply,false);
 assert.throws(()=>ratingInput.parse(input(5.5)));assert.throws(()=>ratingInput.parse(input(3.55)));assert.throws(()=>ratingInput.parse(input(3,'')));
});
test('review failure retains feedback and retries only when explicitly requested',async()=>{
 const store=new Store(':memory:');const {id}=store.ingest(listing());let calls=0;const service=new RatingFeedbackService(store,async()=>{calls++;throw new Error('Plan allowance unavailable');});
 const saved=service.submit(id,input());await service.idle();assert.equal(service.list(id)[0].status,'failed');assert.equal(calls,1);await service.idle();assert.equal(calls,1);
 service.enqueue(saved.id);await service.idle();assert.equal(calls,2);assert.equal(service.list(id).length,1);await service.close();store.close();
});
test('learning cannot bring an unwanted example back into the desk merely to improve average error',()=>{
 const c=criteriaSchema.parse({}),bad=listing({rent:4300});assert.equal(scoreListing(bad,c).value,2.9);
 const result=evaluateProposal(c,{...noChange,changes:[{parameter:'bonuses.furnished',value:.25,reason:'Furnishing valued more'}]},[
  {homeId:1,listing:bad,score:2.9,reason:'Not interested'},
  {homeId:2,listing:listing(),score:4.2,reason:'Good fit'},
  {homeId:3,listing:listing(),score:4.2,reason:'Good fit'}
 ]);assert.ok(result.afterError<result.beforeError);assert.equal(result.apply,false);
});
test('stale reviews cannot overwrite preferences changed during an AI request',async()=>{
 const store=new Store(':memory:');const {id}=store.ingest(listing());let release!:()=>void;const waiting=new Promise<void>(r=>release=r);let started!:()=>void;const ready=new Promise<void>(r=>started=r);
 const service=new RatingFeedbackService(store,async()=>{started();await waiting;return {summary:'Change',interpretation:'Reduce bonus',changes:[{parameter:'bonuses.furnished',value:.05,reason:'Less valuable'}]};});
 service.submit(id,input(store.home(id)!.score.value-.1));await ready;store.set('criteria',{...store.criteria,baseScore:3.1});release();await service.idle();assert.equal(store.criteria.baseScore,3.1);assert.equal(store.criteria.bonuses.furnished,.15);assert.equal(service.list(id)[0].status,'reviewed');await service.close();store.close();
});
test('paid API mode is refused before any provider request',async()=>{
 const previous=process.env.AI_PROVIDER;process.env.AI_PROVIDER='api';try{await assert.rejects(()=>planFeedbackReviewer('.')({criteria:criteriaSchema.parse({}),current:{homeId:1,listing:listing(),score:3,reason:'Test'},appScore:4,examples:[]},new AbortController().signal),/paid API fallback is disabled/);}finally{if(previous===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=previous;}
});
test('ratings API requires CSRF, stores offline in demo, and exports history',async()=>{
 const store=new Store(':memory:');const {id}=store.ingest(listing());const app=createApp(store,join(tmpdir(),'feedback-offline-demo'),{demo:true});await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(app.server.address() as any).port}`;
 try{const state=await (await fetch(base+'/api/state')).json() as any;const payload=JSON.stringify(input());const path=`/api/homes/${id}/ratings`;
 assert.equal((await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:payload})).status,403);
 const result=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-af-token':state.csrf},body:payload});assert.equal(result.status,201);
 const data=await (await fetch(base+path)).json() as any;assert.equal(data.ratings.length,1);assert.equal(data.ratings[0].status,'pending');assert.match(data.ratings[0].error,/offline/);
 const exported=await (await fetch(base+'/api/export')).json() as any;assert.equal(exported.ratings.length,1);
 }finally{await app.close();store.close();}
});
