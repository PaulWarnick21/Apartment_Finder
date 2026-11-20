import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {listingSchema,stages} from '../src/domain.ts';
import {shortlistBackup,shortlistStages} from '../server/shortlist-backup.ts';

test('portable shortlist covers positive stages, scores, decisions and cross-posts without galleries or criteria',async()=>{
 const root=await mkdtemp(join(tmpdir(),'shortlist-backup-')),file=join(root,'apartments.sqlite'),store=new Store(file);
 try{
  for(const [i,stage] of stages.entries()){
   const id=store.ingest(listingSchema.parse({source:'fixture',sourceId:String(i),url:`https://example.com/${i}`,title:stage,address:`${i} Example Street`,rent:2500,beds:1,description:'DESCRIPTION-MUST-NOT-EXPORT',photos:[{id:'image',url:'https://example.com/photo',local:'missing-photo.jpg'}]})).id;
   store.db.prepare('UPDATE homes SET stage=?,notes=?,follow_up=?,viewing=? WHERE id=?').run(stage,'Keep my note','Tomorrow','Friday',id);
   if(stage==='Interested'){
    store.set(`fullReview:${id}`,{status:'queued',detail:'Pending',updatedAt:'2026-11-20T12:00:00Z'});
    store.set(`preservedQuickRank:${id}`,{grade:'A',rankValue:4,eligible:true,reasons:[],flags:[]});
    store.db.prepare('INSERT INTO postings VALUES (?,?,?,?,?)').run('other','cross-post',id,'https://other.example/unit','fingerprint');
   }
  }
  const before=JSON.stringify(store.db.prepare('SELECT * FROM homes').all());
  const snapshot=shortlistBackup(file,'2026-11-20T12:00:00Z'),json=JSON.stringify(snapshot);
  assert.equal(snapshot.apartments.length,shortlistStages.size);
  assert.deepEqual(new Set(snapshot.apartments.map(h=>h.stage)),shortlistStages);
  const interested=snapshot.apartments.find(h=>h.stage==='Interested')!;
  assert.equal(interested.notes,'Keep my note');assert.equal(interested.followUp,'Tomorrow');assert.equal(interested.viewing,'Friday');
  assert.equal(interested.assessmentStatus,'queued');assert.equal(interested.quickGrade,'A');assert.equal(interested.postings.length,2);assert.ok(Number.isFinite(interested.score.value));
  assert.ok(!json.includes('DESCRIPTION-MUST-NOT-EXPORT'));assert.ok(!json.includes('missing-photo.jpg'));assert.ok(!json.includes('priceAnchor'));
  assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM homes').all()),before);
 }finally{store.close();}
});

test('merged homes retain alias URLs and latest rating without duplicate recovery entries',async()=>{
 const root=await mkdtemp(join(tmpdir(),'shortlist-alias-')),file=join(root,'apartments.sqlite'),store=new Store(file);
 try{
  const ids=['a','b'].map(sourceId=>store.ingest(listingSchema.parse({source:'fixture',sourceId,url:`https://example.com/${sourceId}`,title:'Home',address:'1 Example Street',rent:2500,beds:1})).id);
  store.mergeHomes(ids[0],ids[1]);store.db.prepare("UPDATE homes SET stage='Interested' WHERE id=?").run(ids[0]);
  store.db.prepare('INSERT INTO rating_feedback(request_id,home_id,at,user_score,reason,listing_json,score_json,criteria_json) VALUES (?,?,?,?,?,?,?,?)').run('rating',ids[1],'2026-11-20T12:00:00Z',4.2,'My preference','{}','{}','{}');
  const snapshot=shortlistBackup(file);assert.equal(snapshot.apartments.length,1);
  assert.deepEqual(snapshot.apartments[0].aliases,[ids[1]]);assert.equal(snapshot.apartments[0].postings.length,2);assert.equal(snapshot.apartments[0].userRating?.score,4.2);
 }finally{store.close();}
});
