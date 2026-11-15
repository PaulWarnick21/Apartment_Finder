import test from 'node:test';
import assert from 'node:assert/strict';
import {listingSchema,criteriaSchema,type Listing} from '../src/domain.ts';
import {scoreBase,scoreListing} from '../server/scoring.ts';
import {scoringFacts,feedbackFeatures} from '../server/scoring-facts.ts';
import {conditionCorrections,learningFromRows,feedbackScope,type LearningRow} from '../server/feedback-learning.ts';

const fixture=(extra:Partial<Listing>={})=>listingSchema.parse({source:'fixture',sourceId:'one',url:'https://example.test/one',title:'Example apartment',address:'100 Example Street',rent:2800,beds:1,location:'downtown',laundry:'in-unit',floorLevel:10,parking:'included',modern:true,furnished:false,workspace:false,gas:false,north:false,shortLease:false,openPlan:false,cramped:false,photos:[{id:'window',url:'https://example.test/window.jpg',kind:'interior',scenery:'nature',unitCertain:true,quality:3,status:'reviewed'}],galleryComplete:true,expectedPhotos:1,...extra});
const criteria=criteriaSchema.parse({priceAnchor:3500,priceSlope:.0006,expensiveWeakViewRent:3100,requireLaundry:true,maxRent:4500});
const view=(l:Listing,quality:number)=>({...l,photos:[{...l.photos[0],quality}]});
const row=(id:number,home:number,l:Listing,target:number,reason:string):LearningRow=>({id,home_id:home,user_score:target,reason,listing_json:JSON.stringify(l),score_json:JSON.stringify(scoreBase(l,criteria))});

test('improving a window view cannot lower the score at either side of a ceiling boundary',()=>{
 for(const rent of [1800,2400,2800,3100,3350,4000])for(const modern of [null,false,true])for(const beds of [1,2]){
  const l=fixture({rent,modern,beds});let previous=0;
  for(let step=10;step<=50;step++){const quality=step/10,score=scoreBase(view(l,quality),criteria).value;assert.ok(score>=previous,`${rent}, ${modern}, ${beds}: quality ${quality} lowered ${previous} to ${score}`);previous=score;}
 }
 const weaker=scoreBase(view(fixture({rent:3350}),2),criteria),better=scoreBase(view(fixture({rent:3350}),2.5),criteria);
 assert.ok(weaker.value<=better.value);assert.ok(weaker.value<=2.9,'Repair tightens the overly generous weaker view');
});

test('rent and confirmed convenience changes remain monotone with fixed bedroom classification',()=>{
 for(const quality of [1,2,2.1,2.5,3,3.5,4,5]){
  let previous=5;
  for(let rent=1500;rent<=4500;rent+=25){const l=view(fixture({rent}),quality),s=scoreBase(l,criteria).value;assert.ok(s<=previous,`Higher rent ${rent} increased quality-${quality} score`);previous=s;
   for(const field of ['furnished','workspace','gas','north','shortLease','openPlan'] as const)assert.ok(scoreBase({...l,[field]:true},criteria).value>=s,`${field} reduced the score`);
  }
 }
});

test('calibration envelopes preserve rent and view ordering instead of jumping at a neighbor radius',()=>{
 const a=view(fixture({rent:2400}),4),b=view(fixture({sourceId:'two',rent:3100}),4);
 const c=learningFromRows([row(1,1,a,3.2,'The view is not worth this price.'),row(2,2,b,2.8,'Too expensive for the outlook.')],criteria).criteria;
 for(const quality of [2,2.5,3,3.5,4,4.5,5]){let previous=5;for(let rent=1500;rent<=4400;rent+=20){const s=scoreListing(view(fixture({sourceId:'future',rent}),quality),c).value;assert.ok(s<=previous,`Rent ${rent} increased calibrated score`);previous=s;}}
 for(const rent of [1800,2300,2800,3300,4000]){let previous=0;for(let q=10;q<=50;q++){const s=scoreListing(view(fixture({sourceId:'future',rent}),q/10),c).value;assert.ok(s>=previous,`Quality ${q/10} lowered calibrated score`);previous=s;}}
});

test('shared amenities and conflicting floors never masquerade as a unit floor',()=>{
 const l=fixture({floorLevel:null});
 assert.equal(scoringFacts({...l,description:'The gym is located on the 1st floor. The apartment is located on the 10th floor.'}).floorLevel,10);
 for(const description of ['The fitness center is located on the 2nd floor. Suite 1804.','The furnished guest suite is on the 1st floor.','About the building. Located on the 1st floor.','About the building. The penthouse suite is located on the 30th floor.','Floor: 1 for the shared gym.','A 40-storey building with suite 1804 available.'])assert.equal(scoringFacts({...l,description}).floorLevel,null,description);
 const conflict=scoringFacts({...l,title:'Apartment on the 8th floor',description:'The unit is located on the 10th floor.'});assert.equal(conflict.floorLevel,null);assert.match(conflict.conflicts.join(' '),/Conflicting unit floor/);
 assert.equal(scoringFacts({...l,description:'Located on the 26th floor.'}).floorLevel,26);
 assert.equal(scoringFacts({...l,description:'The apartment is on the ground floor.'}).floorLevel,0);
});

test('later explicit condition corrections supersede earlier facts without losing unrelated history',()=>{
 const l=fixture({modern:null,cramped:null});
 const rows=[row(1,1,l,3,'The kitchen is dated and the apartment is cramped.'),row(2,1,l,3.5,'Correction: the kitchen is modern, not dated, and the apartment is not cramped.'),row(3,1,l,3.4,'The rent is a little high.')];
 const c=learningFromRows(rows,criteria,[{home_id:1,source:'crosspost',source_id:'two'}]).criteria;
 assert.equal(c.userAssessments['home:1'].modern,true);assert.equal(c.userAssessments['home:1'].cramped,false);assert.equal(c.userAssessments['home:1'].feedbackId,2);
 assert.deepEqual(c.userAssessments['crosspost:two'],c.userAssessments['home:1']);
 assert.deepEqual(conditionCorrections('The apartment is no longer cramped.'),{cramped:false});
 assert.deepEqual(conditionCorrections('The kitchen is not dated.'),{modern:null});
 assert.deepEqual(conditionCorrections('This is not a modern kitchen.'),{modern:null});
 assert.deepEqual(conditionCorrections('The kitchen is updated but the bathroom is dated.'),{modern:null});
 assert.deepEqual(conditionCorrections("Correction: I can't tell whether the kitchen is dated or the apartment is cramped."),{modern:null,cramped:null});
 assert.equal(scoreListing({...l,source:'third',sourceId:'third',homeId:1},c).adjustments.some(a=>a.label==='Dated interiors'),false);
});

test('one-off ratings stay local and parking, orientation, and layout prevent unrelated transfer',()=>{
 const l=view(fixture({rent:2500}),4),baseline=scoreBase(l,criteria).value;
 const local=learningFromRows([row(1,1,l,2.8,'This is a one-off exception; do not generalize to other apartments.')],criteria).criteria;
 assert.equal(feedbackScope('Only this apartment is an exception.'),'one-off');
 assert.ok(scoreListing({...l,homeId:1},local).value<baseline);assert.equal(scoreListing({...l,sourceId:'future'},local).value,baseline);
 const noParking={...l,parking:'none' as const},c=learningFromRows([row(2,2,noParking,2.8,'There is no parking so I would not pursue it.')],criteria).criteria;
 assert.equal(scoreListing(l,c).value,scoreBase(l,c).value);
 const general=learningFromRows([row(3,3,l,2.8,'The price and view are not appealing.')],criteria).criteria;
 for(const change of [{north:true},{openPlan:true}])assert.equal(scoreListing({...l,sourceId:'future',...change},general).value,scoreBase({...l,...change},general).value);
 const unknownFee=feedbackFeatures({...l,parking:'extra',parkingCost:null});assert.equal(unknownFee.parkingCost,null);
});
