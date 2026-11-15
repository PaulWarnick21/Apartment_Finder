import test from 'node:test';
import assert from 'node:assert/strict';
import {listingSchema,criteriaSchema} from '../src/domain.ts';
import {chronologicalHoldout,counterfactualChecks,evaluateRows,type EvaluationRow} from '../scripts/scoring-evaluation.ts';
const c=criteriaSchema.parse({});
const rows:EvaluationRow[]=Array.from({length:8},(_,i)=>{const l=listingSchema.parse({source:'fixture',sourceId:String(i),url:`https://example.test/${i}`,title:'Example',address:'Example',rent:2200+i*50,beds:1,location:'downtown',laundry:'in-unit',photos:[{id:'p',url:'https://example.test/p.jpg',status:'reviewed',kind:'interior',scenery:'nature',quality:4,unitCertain:true}],galleryComplete:true,expectedPhotos:1});return {id:i+1,home_id:i+1,user_score:3.2,reason:'The outlook is not worth the price.',listing_json:JSON.stringify(l),score_json:JSON.stringify({value:4}),criteria_json:JSON.stringify(c)};});
test('held-out ratings and reasons never change held-out predictions or enter training',()=>{
 const first=chronologicalHoldout(rows)!;assert.deepEqual(first.heldOutHomeIds,[7,8]);assert.ok(first.trainingHomeIds.every(h=>h<7));
 const mutated=rows.map(r=>r.home_id>=7?{...r,user_score:.1,reason:'Avoid street-level views. Prefer at least 100 floors.'}:r),second=chronologicalHoldout(mutated)!;
 assert.deepEqual(first.predictions.map(p=>p.prediction),second.predictions.map(p=>p.prediction));assert.notEqual(first.meanAbsoluteError,second.meanAbsoluteError);
 const repeat={...rows[0],id:9,user_score:4.5};const withRepeat=chronologicalHoldout([...rows,repeat])!;assert.deepEqual(withRepeat.heldOutHomeIds,[7,8]);assert.ok(!withRepeat.heldOutHomeIds.includes(1));
});
test('evaluation labels fitting and historical holdout separately and discloses limits',()=>{
 const result=evaluateRows(c,rows);assert.match(result.inSample.label,/In-sample/);assert.match(result.holdout!.label,/held-out labels.*excluded/);assert.match(result.holdout!.limitations,/not a prospective blind/);assert.equal(result.holdout!.examples,2);
 assert.equal(chronologicalHoldout(rows.slice(0,3)),null);assert.equal(counterfactualChecks(c).violations,0);
});
