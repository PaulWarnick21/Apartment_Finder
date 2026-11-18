import test from 'node:test';
import assert from 'node:assert/strict';
import {listingSchema,criteriaSchema,type Listing} from '../src/domain.ts';
import {scoreBase,scoreListing} from '../server/scoring.ts';
import {learningFromRows} from '../server/feedback-learning.ts';
const fixture=(extra:Partial<Listing>={})=>listingSchema.parse({source:'fixture',sourceId:'premium',url:'https://example.test/premium',title:'Apartment',address:'',rent:3495,beds:2,location:'downtown',floorLevel:10,parking:'included',modern:true,cramped:false,openPlan:true,gas:true,furnished:true,workspace:true,photos:[{id:'one',url:'https://example.test/photo',status:'reviewed',kind:'interior',scenery:'nature',quality:5,unitCertain:true}],expectedPhotos:1,galleryComplete:true,evidence:{interiorAssessment:'Photos one: Updated kitchen and bathroom; spacious rooms.'},...extra});
const c=criteriaSchema.parse({priceAnchor:3500,priceSlope:.0006});
const bonus=(l:Listing)=>scoreBase(l,c).adjustments.find(a=>a.label==='Second bedroom')?.value??0;
test('second-bedroom value tapers with cost and never stacks with workspace',()=>{
 assert.equal(bonus(fixture({rent:3000})),.15);assert.equal(bonus(fixture({rent:3250})),.08);assert.equal(bonus(fixture({rent:3500})),0);
 assert.equal(bonus(fixture({rent:3350,parking:'extra',parkingCost:150})),0);
 for(const rent of [3000,3250,3500])assert.ok(!scoreBase(fixture({rent}),c).adjustments.some(a=>a.label==='Usable workspace'));
});
test('premium prices require exceptional verified unit quality across bedroom counts',()=>{
 assert.ok(scoreBase(fixture(),c).value>=4);
 for(const beds of [1,2])for(const change of [{modern:null},{modern:false},{cramped:null},{cramped:true},{openPlan:null},{evidence:{}},{floorLevel:null}]){
  const s=scoreBase(fixture({beds,...change}),c);assert.ok(s.value<=3.3);assert.ok(s.high<=3.3);assert.ok(s.ceiling!<=3.3);
 }
 const l=fixture();l.photos[0].quality=4;assert.equal(scoreBase(l,c).value,3.3);
 l.photos[0].quality=5;l.photos[0].unitCertain=false;assert.ok(scoreBase(l,c).value<=3.3);
 assert.ok(scoreBase(fixture({rent:3300,modern:null}),c).value>3.3);
});
test('positive calibration cannot restore premium scores and known parking charges count',()=>{
 const l=fixture({modern:null,rent:3300,parking:'extra',parkingCost:150}),base=scoreBase(l,c);
 const learned=learningFromRows([{id:1,home_id:1,user_score:5,reason:'I like this home.',listing_json:JSON.stringify(l),score_json:JSON.stringify(base)}],c).criteria;
 assert.equal(scoreListing({...l,homeId:1},learned).value,3.3);
});
test('increasing rent never improves premium or ordinary two-bedroom scores',()=>{
 for(const modern of [true,false,null]){let previous=5;for(let rent=2800;rent<=3600;rent+=5){const s=scoreBase(fixture({rent,modern}),c).value;assert.ok(s<=previous,`${modern}: ${rent} increased ${previous} to ${s}`);previous=s;}}
});
test('even affordable apartments need supported overall quality for 4.8 or higher',()=>{
 const ordinary=fixture({rent:2300,modern:null});
 assert.equal(scoreBase(ordinary,c).value,4.7);
 assert.ok(scoreBase(fixture({rent:2300}),c).value>=4.8);
 const learned=learningFromRows([{id:1,home_id:1,user_score:5,reason:'I like this home.',listing_json:JSON.stringify(ordinary),score_json:JSON.stringify(scoreBase(ordinary,c))}],c).criteria;
 assert.equal(scoreListing({...ordinary,homeId:1},learned).value,4.7);
});
