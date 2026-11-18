import test from 'node:test';
import assert from 'node:assert/strict';
import {listingSchema,criteriaSchema,type Listing} from '../src/domain.ts';
import {scoreBase,scoreListing} from '../server/scoring.ts';
import {learningFromRows} from '../server/feedback-learning.ts';
import {Store} from '../server/db.ts';
import {applyLocalUpgrades} from '../server/local-upgrades.ts';
import {deskCategory} from '../src/desk-category.ts';
const c=criteriaSchema.parse({requireNiceViewForDesk:true,interiorTradeoff:{enabled:true,viewPenalty:0,ceiling:3.5}});
const fixture=(extra:Partial<Listing>={})=>listingSchema.parse({source:'fixture',sourceId:'nice',url:'https://example.test/nice',title:'Apartment',address:'',rent:2000,beds:1,location:'downtown',floorLevel:10,parking:'included',modern:true,furnished:true,workspace:true,openPlan:true,photos:[{id:'one',url:'https://example.test/photo',local:'fixture.jpg',status:'reviewed',kind:'interior',scenery:'nature',quality:4,unitCertain:true}],expectedPhotos:1,galleryComplete:true,...extra});
test('weak and unconfirmed outlooks stay excluded despite cheap rent and appealing interiors',()=>{
 const l=fixture();
 for(const change of [{quality:1},{quality:2},{quality:3},{quality:3.5},{quality:3.9},{scenery:'buildings'},{scenery:'unknown'},{unitCertain:false},{attributionPending:true},{kind:'balcony'},{kind:'amenity'},{status:'pending'}] as const){
  const s=scoreBase({...l,photos:[{...l.photos[0],...change}]},c);assert.ok(s.value<=2.9,JSON.stringify(change));assert.ok(s.high<=2.9);assert.equal(s.eligible,false);assert.ok(!s.adjustments.some(a=>a.label==='Interior strengths offset weak outlook'));
 }
});
test('unknown nature remains uncertain rather than becoming a proven absent view',()=>{
 const l=fixture();l.photos[0].scenery='unknown';const s=scoreBase(l,c);
 assert.equal(s.view,'Unverified');assert.ok(s.reasons.some(r=>/not confirmed/.test(r)));assert.ok(!s.reasons.some(r=>/Confirmed absence/.test(r)));
 assert.ok(scoreBase(fixture(),c).value>=3);assert.ok(scoreBase(fixture({conflicts:['View differs across postings.']}),c).value<=2.9);
});
test('a prior positive personal score cannot restore a poor-view apartment to the desk',()=>{
 const l=fixture();l.photos[0].quality=3;const base=scoreBase(l,c);
 const learned=learningFromRows([{id:1,home_id:1,user_score:4.8,reason:'I liked this apartment before the view-first rule.',listing_json:JSON.stringify(l),score_json:JSON.stringify({...base,value:3.5})}],c).criteria;
 const s=scoreListing({...l,homeId:1},learned);assert.ok(s.value<=2.9);assert.equal(s.eligible,false);assert.equal(learned.learnedExamples[0].target,4.8);
});
test('migration makes exclusions manually accessible without changing saved decisions',()=>{
 const store=new Store(':memory:');try{
  store.set('criteria',criteriaSchema.parse({interiorTradeoff:{enabled:true,viewPenalty:0,ceiling:3.5}}));const l=fixture();l.photos[0].quality=3;
  const id=store.ingest(l).id;store.update(id,store.home(id)!.revision,{stage:'Interested',notes:'Keep my notes',followUp:'2026-12-01',viewing:'',rescued:true});
  applyLocalUpgrades(store);const h=store.home(id)!;
  assert.equal(store.criteria.requireNiceViewForDesk,true);assert.equal(store.criteria.interiorTradeoff.enabled,false);
  assert.equal(deskCategory(h),'Excluded');assert.equal(h.stage,'Interested');assert.equal(h.notes,'Keep my notes');assert.equal(h.followUp,'2026-12-01');assert.equal(h.rescued,true);
  assert.equal(store.homes().length,1);assert.equal(applyLocalUpgrades(store),false);
 }finally{store.close();}
});
