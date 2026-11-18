import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {criteriaSchema,listingSchema,type Listing} from '../src/domain.ts';
import {quickRank} from '../server/quick-rank.ts';
import {quickRank as oldRank} from '../server/quick-rank-v1.ts';
import {Store} from '../server/db.ts';

const criteria=criteriaSchema.parse({requireLaundry:true,preferredMinFloor:5});
const candidate=(patch:Partial<Listing>={})=>listingSchema.parse({source:'craigslist',sourceId:'one',url:'https://example.test/one',title:'Apartment',address:'123 Example Street',rent:1600,beds:2,laundry:'in-unit',downtownDistance:'downtown',modern:true,openPlan:true,cramped:false,parking:'included',floorLevel:6,galleryComplete:true,allOutlooksCovered:true,expectedPhotos:2,evidence:{addressLookupStatus:'verified'},photos:[1,2].map(n=>({id:String(n),url:`https://example.test/${n}.jpg`,local:`${n}.jpg`,status:'reviewed',kind:'interior',scenery:n===1?'nature':'unknown',quality:n===1?4.5:null,unitCertain:true})),...patch});

test('S requires both exceptional fit and strong evidence; advertised bonuses cannot substitute',()=>{
 assert.equal(quickRank(candidate(),criteria).grade,'S');
 for(const patch of [
  {evidence:{}},{downtownDistance:'unknown'},{galleryComplete:false},{expectedPhotos:3},
  {allOutlooksCovered:false},{floorLevel:null},{floorLevel:2},{modern:null},{cramped:null},
  {parking:'unknown'},{parking:'none'},{parking:'extra',parkingCost:null},
  {conflicts:['Window attribution conflicts']},{rent:null},{beds:null},{laundry:'unknown'},
  {photos:candidate().photos.map(p=>({...p,status:'downloaded'}))},
  {photos:candidate().photos.map(p=>({...p,unitCertain:false}))},
  {photos:candidate().photos.map(p=>({...p,attributionPending:true}))},
  {photos:candidate().photos.map(p=>({...p,local:undefined}))},
  {photos:[candidate().photos[0],{...candidate().photos[1],scenery:'buildings'}]}
 ] as Partial<Listing>[]){const rank=quickRank(candidate(patch),criteria);assert.notEqual(rank.grade,'S',JSON.stringify(patch));assert.ok(rank.rankValue<92);}
 const marketing=candidate({photos:candidate().photos.map(p=>({...p,status:'downloaded',scenery:'unknown',quality:null})),description:'Stunning ocean views',furnished:true,shortLease:true,gas:true});
 assert.equal(oldRank(marketing,criteria).grade,'S');assert.equal(quickRank(marketing,criteria).grade,'A');
 assert.equal(quickRank(marketing,criteria).eligible,true);
});

test('pre-update ranks survive migration, refresh, criteria changes, merge and restart',()=>{
 const path=join(mkdtempSync(join(tmpdir(),'rank-preservation-')),'desk.sqlite');
 let store=new Store(path);store.set('criteria',criteria);store.set('reviewWorkflow',{mode:'quick-first'});
 const id=store.ingest(candidate({evidence:{},photos:candidate().photos.map(p=>({...p,status:'downloaded'}))})).id;
 const original=store.home(id)!,rank=oldRank(original.listing,criteria,id);
 assert.equal(rank.grade,'S');
 // Represent a database last opened by the previous version (which had no policy marker).
 store.db.prepare("DELETE FROM meta WHERE key='quickRankPolicyV2'").run();store.close();
 store=new Store(path);
 assert.deepEqual(store.home(id)!.quickRank,rank);assert.equal(store.home(id)!.revision,original.revision);
 assert.deepEqual(store.home(id)!.listing,original.listing);
 store.ingest(candidate({rent:3400,modern:false}));store.set('criteria',{...criteria,priceAnchor:1000});
 assert.deepEqual(store.home(id)!.quickRank,rank);
 const other=store.ingest(candidate({sourceId:'other',address:'456 Different Street',evidence:{}})).id;
 assert.notEqual(store.home(other)!.quickRank!.grade,'S');
 store.mergeHomes(id,other);assert.deepEqual(store.home(id)!.quickRank,rank);
 store.close();store=new Store(path);
 try{assert.deepEqual(store.home(id)!.quickRank,rank);assert.equal(store.get<{preserved:number}>('quickRankPolicyV2')!.preserved,1);}finally{store.close();}
});
