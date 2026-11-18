import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {listingSchema} from '../src/domain.ts';
import {savedSourceDecisions,savedSourceYieldStats} from '../server/source-feedback.ts';

const listing=(n:number,source='craigslist')=>listingSchema.parse({source,sourceId:String(n),url:`https://example.test/${n}`,title:'Fixture apartment',address:`${n} Example Street`,rent:2400,beds:1,photos:[{id:'saved',url:'https://example.test/saved.jpg',local:'saved.jpg',status:'downloaded'}],});
const change=(store:Store,id:number,stage:string,at:string)=>{const home=store.home(id)!;store.update(id,home.revision,{stage,notes:'Retained note',followUp:'',viewing:'',rescued:false});store.db.prepare('UPDATE history SET at=? WHERE id=(SELECT max(id) FROM history)').run(at);};

test('source feedback uses actual choice dates, not notes, scanning, or later application stages',()=>{
 const store=new Store(':memory:');try{
  const id=store.ingest(listing(1)).id;
  change(store,id,'Interested','2026-11-01T00:00:00Z');
  change(store,id,'Interested','2026-11-15T00:00:00Z');
  store.ingest({...listing(1),title:'Updated advertising'});
  change(store,id,'In Progress','2026-11-16T00:00:00Z');
  assert.deepEqual(savedSourceDecisions(store),[{homeId:id,interested:true,at:'2026-11-01T00:00:00Z'}]);
  change(store,id,'Closed','2026-11-17T00:00:00Z');
  assert.equal(savedSourceDecisions(store)[0].interested,true);
  assert.equal(savedSourceYieldStats(store,Date.parse('2026-11-15T00:00:00Z'))[0].recentInterested,.5);
 }finally{store.close();}
});

test('rejection replaces a prior success, reopening removes the outcome, and a new choice is counted once',()=>{
 const store=new Store(':memory:');try{
  const id=store.ingest(listing(1)).id;change(store,id,'Interested','2026-11-01T00:00:00Z');change(store,id,'Not Interested','2026-11-05T00:00:00Z');
  assert.deepEqual(savedSourceDecisions(store),[{homeId:id,interested:false,at:'2026-11-05T00:00:00Z'}]);
  store.reopen(id,store.home(id)!.revision);assert.deepEqual(savedSourceDecisions(store),[]);
  change(store,id,'Interested','2026-11-18T00:00:00Z');
  const stats=savedSourceYieldStats(store,Date.parse('2026-11-18T00:00:00Z'));
  assert.equal(stats[0].userReviewed,1);assert.equal(stats[0].userInterested,1);assert.equal(stats[0].recentInterested,1);
 }finally{store.close();}
});

test('merging cross-posted homes preserves one primary-source outcome and splitting restores distinct outcomes',()=>{
 const store=new Store(':memory:');try{
  const first=store.ingest(listing(1)).id,second=store.ingest(listing(2,'facebook')).id;
  change(store,first,'Interested','2026-11-01T00:00:00Z');change(store,second,'Interested','2026-11-02T00:00:00Z');
  const merged=store.mergeHomes(first,second),stats=savedSourceYieldStats(store);
  assert.equal(stats.length,1);assert.equal(stats[0].source,'craigslist');assert.equal(stats[0].userReviewed,1);
  store.splitMerge(merged.mergeId);assert.equal(savedSourceYieldStats(store).reduce((n,s)=>n+s.userReviewed,0),2);
 }finally{store.close();}
});
