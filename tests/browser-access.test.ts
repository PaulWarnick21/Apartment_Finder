import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {createPlan,approvePlan,claimPlan,Budget} from '../server/plans.ts';
import {SourceSession,diagnosticUrl} from '../server/transport.ts';
import {sourceById} from '../server/sources.ts';
const caps={purpose:'access-check',billingMode:'chatgpt',sources:['facebook'],maxPages:1,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0};
test('supervised access recovery is narrow and does not clear normal scanner pauses',()=>{
 const db=new Store(':memory:');db.pause('facebook','Login required',true);
 assert.throws(()=>createPlan(db,caps),/paused/);
 for(const change of [{maxPages:2},{maxPhotos:1},{maxAiCalls:1},{sources:['facebook','zillow']}])assert.throws(()=>createPlan(db,{...caps,...change},{accessRecovery:true}),/recovery/);
 const p=createPlan(db,caps,{accessRecovery:true});assert.throws(()=>claimPlan(db,p.id),/approved/);approvePlan(db,p.id,'APPROVE ONE SCAN');claimPlan(db,p.id);
 assert.throws(()=>new SourceSession(sourceById('facebook'),new Budget(db,p.id,p.caps),'.',{accessRecovery:true}),/visible Chrome/);
 assert.throws(()=>db.checkSource('facebook'),/paused/);db.close();
});
test('access diagnostics omit URL credentials, queries and fragments',()=>{
 assert.equal(diagnosticUrl('https://user:secret@example.com/login?token=secret#code'),'https://example.com/login');
});
