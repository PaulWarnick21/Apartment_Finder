import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {listingSchema,criteriaSchema} from '../src/domain.ts';
import {quickRank} from '../server/quick-rank.ts';

const listing=()=>listingSchema.parse({source:'craigslist',sourceId:'cache',url:'https://example.test/cache',title:'Apartment',address:'1200 Example Street',area:'Downtown Vancouver',rent:2400,beds:1,laundry:'in-unit',galleryComplete:true,photos:[{id:'one',url:'https://example.test/photo.jpg',local:'photo.jpg',status:'downloaded'}]});
const criteria=criteriaSchema.parse({requireLaundry:false,quickIntake:{minRent:1000,maxRent:3500,minPhotos:1,allowedBeds:[1,2]}});

test('quick ranks stay detached from callers and refresh after another worker changes listing facts or criteria',()=>{
 const file=join(mkdtempSync(join(tmpdir(),'quick-cache-')),'desk.sqlite'),desk=new Store(file);
 desk.set('reviewWorkflow',{mode:'quick-first'});desk.set('criteria',criteria);
 const id=desk.ingest(listing()).id,worker=new Store(file);
 try{
  const initial=desk.home(id)!.quickRank!,expected=structuredClone(initial);
  initial.rankValue=-100;initial.flags.push('Caller mutation');
  assert.deepEqual(desk.home(id)!.quickRank,expected);
  const changed={...listing(),rent:3400};worker.db.prepare('UPDATE homes SET listing=? WHERE id=?').run(JSON.stringify(changed),id);
  const afterFacts=desk.home(id)!;assert.deepEqual(afterFacts.quickRank,quickRank(afterFacts.listing,criteria,id));assert.notEqual(afterFacts.quickRank!.rankValue,expected.rankValue);
  const changedCriteria=criteriaSchema.parse({...criteria,quickIntake:{...criteria.quickIntake,maxRent:3000}});worker.set('criteria',changedCriteria);
  const afterCriteria=desk.home(id)!;assert.equal(afterCriteria.quickRank!.eligible,false);assert.deepEqual(afterCriteria.quickRank,quickRank(afterCriteria.listing,changedCriteria,id));
  assert.equal(afterCriteria.stage,'Unreviewed');assert.equal(afterCriteria.notes,'');
 }finally{worker.close();desk.close();}
});

test('frozen ranks remain unchanged while decision admission checks fresh facts rather than a displayed cached rank',()=>{
 const desk=new Store(':memory:');try{
  desk.set('reviewWorkflow',{mode:'quick-first'});desk.set('criteria',criteria);
  const id=desk.ingest(listing()).id,rank=desk.home(id)!.quickRank!;
  desk.set(`preservedQuickRank:${id}`,rank);
  desk.db.prepare('UPDATE homes SET listing=? WHERE id=?').run(JSON.stringify({...listing(),rent:4500}),id);
  const home=desk.home(id)!;assert.deepEqual(home.quickRank,rank);assert.equal(home.quickRank!.eligible,true);
  assert.throws(()=>desk.update(id,home.revision,{stage:'Interested',notes:'',followUp:'',viewing:'',rescued:false}),/hard intake requirement/);
  assert.equal(desk.home(id)!.stage,'Unreviewed');assert.deepEqual(desk.home(id)!.quickRank,rank);
 }finally{desk.close();}
});
