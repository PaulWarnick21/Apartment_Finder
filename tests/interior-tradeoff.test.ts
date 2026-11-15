import test from 'node:test';
import assert from 'node:assert/strict';
import {criteriaSchema,listingSchema,type Listing} from '../src/domain.ts';
import {scoreBase,scoreListing} from '../server/scoring.ts';
import {learningFromRows} from '../server/feedback-learning.ts';

const criteria=criteriaSchema.parse({
  baseScore:3.3,priceAnchor:3500,priceSlope:.9/1400,maxRent:3600,requireLaundry:true,
  buildingViewPenalty:3.3,datedInteriorPenalty:.6,crampedPenalty:.2,
  unverifiedViewCeiling:3.1,goodUnverifiedViewCeiling:3.3,
  farFromDowntownCeiling:3.3,streetLevelCeiling:2.9,
  expensiveWeakViewRent:3100,expensiveWeakViewCeiling:3.1,
  interiorTradeoff:{enabled:true,viewPenalty:.7,ceiling:3.3},
});
const apartment=(extra:Partial<Listing>={})=>listingSchema.parse({
  source:'fixture',sourceId:'furnished-office',url:'https://example.test/furnished-office',
  title:'Fictional compact apartment with an office',address:'100 Example Street',
  rent:2400,beds:1,location:'downtown',laundry:'in-unit',parking:'included',
  furnished:true,workspace:true,openPlan:true,modern:false,cramped:true,
  gas:false,north:false,shortLease:false,floorLevel:10,
  photos:[{id:'window',url:'https://example.test/window.jpg',status:'reviewed',kind:'interior',unitCertain:true,scenery:'buildings'}],
  galleryComplete:true,expectedPhotos:1,allOutlooksCovered:false,...extra,
});
const withNature=(l:Listing,quality:number):Listing=>({...l,photos:l.photos.map(p=>({...p,scenery:'nature' as const,quality}))});

test('supported furnishing, office and layout can make a modest-view apartment worth a look',()=>{
  const l=apartment(),s=scoreBase(l,criteria);
  assert.equal(s.value,3.2);assert.equal(s.eligible,true);assert.equal(s.view,'Unverified');
  assert.ok(s.flags.some(f=>/view|outlook/i.test(f)),'Weak-view evidence remains visible');
  assert.ok(s.adjustments.some(a=>a.label==='Dated interiors'&&a.value<0));
  assert.ok(s.adjustments.some(a=>a.label==='Cramped layout'&&a.value<0));
  const strict=scoreBase(l,criteriaSchema.parse({...criteria,interiorTradeoff:{...criteria.interiorTradeoff,enabled:false}}));
  assert.equal(strict.value,.6);assert.equal(strict.eligible,false);
});

test('ordinary poor-view apartments and unsupported features do not qualify',()=>{
  for(const change of [
    {furnished:false,workspace:null,modern:null},
    {openPlan:null,workspace:null,modern:null},
    {furnished:null},
    {workspace:null},
    {openPlan:null},
    {beds:2,modern:null},
    {rent:null},
  ] satisfies Partial<Listing>[]){
    const score=scoreBase(apartment(change),criteria);
    assert.ok(score.value<3,JSON.stringify(change));assert.equal(score.eligible,false);
  }
  const representative=apartment();representative.photos[0].unitCertain=false;
  assert.ok(scoreBase(representative,criteria).value<3,'Representative interiors cannot establish the appealing unit');
  const unsupported=apartment({furnished:null,workspace:null,openPlan:null,modern:null,description:'Furnished modern loft with an excellent open layout and office!'});
  assert.ok(scoreBase(unsupported,criteria).value<3,'Marketing copy alone does not manufacture supported features');
  assert.equal(criteriaSchema.parse({}).interiorTradeoff.enabled,false,'This preference must be enabled explicitly');
});

test('a verified poor outlook remains labelled while the authorized interior tradeoff can still qualify',()=>{
  const s=scoreBase(apartment({allOutlooksCovered:true}),criteria);
  assert.equal(s.value,3.2);assert.equal(s.eligible,true);assert.equal(s.view,'No qualifying nature');
  assert.equal(s.reasons.some(r=>/Confirmed absence of a qualifying nature outlook/.test(r)),false);
  const ordinary=scoreBase(apartment({allOutlooksCovered:true,workspace:null}),criteria);
  assert.equal(ordinary.eligible,false);assert.ok(ordinary.reasons.some(r=>/Confirmed absence/.test(r)));
});

test('better views never reduce an appealing apartment from its building-facing score',()=>{
  for(const rent of [1900,2400,2800,3099,3100,3400])for(const modern of [false,true,null]){
    const l=apartment({rent,modern});let previous=scoreBase(l,criteria).value;
    for(let step=10;step<=50;step++){
      const quality=step/10,score=scoreBase(withNature(l,quality),criteria).value;
      assert.ok(score>=previous,`${rent}, modern=${modern}, quality=${quality}: ${previous} -> ${score}`);previous=score;
    }
  }
});

test('rent increases and supported convenience improvements preserve score ordering',()=>{
  for(const quality of [null,1,2,2.1,3,3.9,4,5]){
    let previous=5;
    for(let rent=1500;rent<=3700;rent+=25){
      const plain=apartment({rent}),l=quality===null?plain:withNature(plain,quality),score=scoreBase(l,criteria).value;
      assert.ok(score<=previous,`Rent ${rent} increased quality ${quality} score`);previous=score;
      for(const field of ['furnished','workspace','openPlan','modern','gas','north','shortLease'] as const){
        const without=scoreBase({...l,[field]:false},criteria).value,withFeature=scoreBase({...l,[field]:true},criteria).value;
        assert.ok(withFeature>=without,`${field} reduced quality ${quality} score at rent ${rent}`);
      }
    }
  }
});

test('interior appeal cannot override hard requirements or street and high-rent limits',()=>{
  for(const change of [
    {laundry:'shared-only'},
    {laundry:'none'},
    {rent:3600},
    {offeringKind:'building'},
    {available:'Rented'},
    {evidence:{nonRental:'true'}},
    {photos:[]},
  ] satisfies Partial<Listing>[]){
    assert.equal(scoreBase(apartment(change),criteria).eligible,false,JSON.stringify(change));
  }
  assert.ok(scoreBase(apartment({floorLevel:1}),criteria).value<3);
  assert.ok(scoreBase(apartment({rent:3200,modern:true,cramped:false}),criteria).value<=3.1);
  const distant=scoreBase(apartment({location:'outside',downtownDistance:'far',modern:true,cramped:false}),criteria);
  assert.ok(distant.value<=3.3);
});

test('personal feedback cannot turn a building-facing interior alternative into a strong match',()=>{
  const l=apartment({homeId:1});
  const learned=learningFromRows([{
    id:1,home_id:1,user_score:4.8,reason:'I like the furnishing, useful office and layout.',
    listing_json:JSON.stringify(l),score_json:JSON.stringify({value:.6}),
  }],criteria).criteria;
  const score=scoreListing(l,learned);
  assert.ok(score.value>=3.2&&score.value<=3.3);assert.equal(score.eligible,true);
  assert.equal(scoreListing({...l,laundry:'shared-only'},learned).eligible,false);
});
