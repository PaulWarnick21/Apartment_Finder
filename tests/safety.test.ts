import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {listingSchema} from '../src/domain.ts';
import {Store} from '../server/db.ts';
import {createPlan,approvePlan,claimPlan,recoverInterrupted,getPlan,Budget} from '../server/plans.ts';
import {parseListing} from '../server/parsers.ts';
import {sourceById} from '../server/sources.ts';
import {assessPhotos} from '../server/worker.ts';
const caps={sources:['craigslist'],maxPages:2,maxListings:1,maxPhotos:2,maxAiCalls:2,maxReservedUsd:.2,reservePerCallUsd:.1};

test('recovery refuses active workers and never resumes interrupted work',()=>{
 const db=new Store(':memory:'),p=createPlan(db,caps);approvePlan(db,p.id,'APPROVE ONE SCAN');claimPlan(db,p.id);
 assert.throws(()=>recoverInterrupted(db),/active/);
 db.db.prepare('UPDATE scan_lock SET heartbeat=?').run(new Date(Date.now()-660000).toISOString());
 recoverInterrupted(db);assert.equal(getPlan(db,p.id).state,'interrupted');assert.throws(()=>claimPlan(db,p.id),/approved/);db.close();
});

test('negative laundry claims cannot become an in-unit pass',()=>{
 const fixture=readFileSync('tests/fixtures/craigslist.html','utf8');
 const url='https://vancouver.craigslist.org/van/apa/d/example/1234567890.html';
 const text=fixture.replace(/Private in-suite laundry/gi,'no in-unit laundry');
 const listing=parseListing(text,url,sourceById('craigslist'));assert.equal(listing.laundry,'none');
});

test('representative-photo disclaimer overrides cached visual confidence',async()=>{
 const db=new Store(':memory:'),p=createPlan(db,caps);approvePlan(db,p.id,'APPROVE ONE SCAN');claimPlan(db,p.id);
 const listing=listingSchema.parse({source:'fixture',sourceId:'a',url:'https://example.com/a',address:'Example',title:'Example',rent:2500,beds:1,description:'Photos are of a similar unit.',photos:[{id:'p',url:'https://example.com/photo.jpg',hash:'fixture',local:'fixture.jpg',status:'downloaded'}]});
 db.db.prepare('INSERT INTO photo_cache VALUES (?,?,?)').run('fixture','test',JSON.stringify({kind:'interior',scenery:'nature',quality:5,unitCertain:true,note:'Visible mountains'}));
 const provider={version:'test',async review(){throw new Error('Cache should avoid calls');}};
 await assessPhotos(db,listing,provider,new Budget(db,p.id,p.caps),'.');
 assert.equal(listing.photos[0].unitCertain,false);assert.equal(getPlan(db,p.id).usage.aiCalls,0);db.close();
});
