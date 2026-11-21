import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {listingSchema,type Home} from '../src/domain.ts';
import {migrateSeriousCandidates} from '../server/stage-migration.ts';
import {canTransition,stageOptions} from '../src/stage-transitions.ts';
import {reviewDecisions} from '../src/review-presentation.ts';
import {deskCategory} from '../src/desk-category.ts';

const flow=['Unreviewed','Interested','Serious Candidates','Ready to Apply','In Progress'] as const;
test('every forward skip and backward review-stage transition is rejected',()=>{
 for(let a=0;a<flow.length;a++)for(let b=0;b<flow.length;b++)assert.equal(canTransition(flow[a],flow[b]),b===a||b===a+1,`${flow[a]} → ${flow[b]}`);
 for(const stage of flow){assert.ok(canTransition(stage,'Not Interested'));assert.equal(stageOptions(stage).filter(s=>flow.includes(s as typeof flow[number])).length,stage==='In Progress'?1:2);}
 assert.equal(canTransition('Ready to Apply','Leased'),false);
});
test('cards offer the next review stage, Interested deferral, and Not Interested',()=>{
 for(let i=0;i<flow.length-1;i++){
  const h={stage:flow[i],reviewMode:'full',fullReview:{status:'complete'}} as Home;
  assert.deepEqual(reviewDecisions(h).map(d=>d.stage),['Interested','Serious Candidates'].includes(flow[i])?[flow[i+1],flow[i],'Not Interested']:[flow[i+1],'Not Interested']);
 }
});
test('migration moves old approvals once and preserves notes, evidence, grades, dates and historical meaning',()=>{
 const db=new Store(':memory:');try{
  const id=db.ingest(listingSchema.parse({source:'fixture',sourceId:'migration',url:'https://example.test/migration',title:'Apartment',address:'123 Example St',rent:2400,beds:1,photos:[{id:'p',url:'https://example.test/p.jpg',local:'p.jpg'}]})).id;
  db.db.prepare("UPDATE homes SET stage='Ready to Apply',notes='Original note',follow_up='2026-12-01',revision=7 WHERE id=?").run(id);
  db.set('reviewWorkflow',{mode:'quick-first'});db.set(`fullReview:${id}`,{status:'complete',detail:'Retained',updatedAt:'2026-11-18T00:00:00Z'});
  const rank={grade:'A',eligible:true,rankValue:88,reasons:[],flags:[]};db.set(`preservedQuickRank:${id}`,rank);
  const before=db.home(id)!;const date=before.categoryEnteredAt;
  db.db.prepare('INSERT INTO history(home_id,at,event,before_json,after_json) VALUES (?,?,?,?,?)').run(id,'2026-11-18T00:00:00Z','Decision saved',JSON.stringify({stage:'Interested',notes:'Original note'}),JSON.stringify({stage:'Ready to Apply',notes:'Original note'}));
  db.db.prepare("DELETE FROM meta WHERE key='seriousCandidatesStageV1'").run();
  assert.equal(migrateSeriousCandidates(db),true);
  const after=db.home(id)!;assert.equal(after.stage,'Serious Candidates');assert.equal(deskCategory(after),'Serious Candidates');assert.equal(after.revision,8);
  for(const key of ['listing','notes','followUp','viewing','score','quickRank','fullReview','categoryEnteredAt'] as const)assert.deepEqual(after[key],before[key],key);
  assert.equal(after.categoryEnteredAt,date);
  const history=db.db.prepare("SELECT after_json FROM history WHERE home_id=? AND event='Decision saved'").get(id)!;assert.equal(JSON.parse(history.after_json as string).stage,'Serious Candidates');
  const decision={stage:'Ready to Apply',notes:after.notes,followUp:after.followUp,viewing:after.viewing,rescued:false};
  assert.throws(()=>db.update(id,7,decision),/changed/);db.update(id,8,decision);
  assert.equal(migrateSeriousCandidates(db),false);assert.equal(db.home(id)!.stage,'Ready to Apply');
 }finally{db.close();}
});
test('backend rejects skipped stages even with completed scoring and preserves decisions on rejection',()=>{
 const db=new Store(':memory:');try{
  const id=db.ingest(listingSchema.parse({source:'fixture',sourceId:'flow',url:'https://example.test/flow',title:'Apartment',address:'123 Example St',rent:2400,beds:1,photos:[{id:'p',url:'https://example.test/p.jpg',local:'p.jpg'}]})).id;
  db.set(`fullReview:${id}`,{status:'complete',detail:'Done',updatedAt:new Date().toISOString()});
  const move=(stage:string)=>{const h=db.home(id)!;return db.update(id,h.revision,{stage,notes:'Preserved note',followUp:'',viewing:'',rescued:false});};
  for(let i=0;i<flow.length-1;i++){
   for(let j=i+2;j<flow.length;j++)assert.throws(()=>move(flow[j]),/without skipping/);
   assert.equal(db.home(id)!.stage,flow[i]);move(flow[i+1]);
  }
  assert.equal(db.home(id)!.notes,'Preserved note');
 }finally{db.close();}
});

test('migration retains the ability to split an unchanged merge without restoring an old final stage',()=>{
 const db=new Store(':memory:');try{
  const ids=[1,2].map(n=>db.ingest(listingSchema.parse({source:'fixture',sourceId:String(n),url:`https://example.test/${n}`,title:'Apartment',address:`${n} Example Street`,rent:2400,beds:1})).id);
  db.db.prepare("UPDATE homes SET stage='Ready to Apply'").run();
  const merged=db.mergeHomes(ids[0],ids[1]);
  db.db.prepare("DELETE FROM meta WHERE key='seriousCandidatesStageV1'").run();migrateSeriousCandidates(db);
  assert.doesNotThrow(()=>db.splitMerge(merged.mergeId));
  for(const id of ids)assert.equal(db.home(id)!.stage,'Serious Candidates');
 }finally{db.close();}
});
