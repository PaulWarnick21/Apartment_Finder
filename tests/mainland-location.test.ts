import test from 'node:test';
import assert from 'node:assert/strict';
import {mainlandExclusion} from '../server/mainland-location.ts';
import {Store} from '../server/db.ts';
import {criteriaSchema,listingSchema} from '../src/domain.ts';
import {quickRank} from '../server/quick-rank.ts';
import {scoreBase} from '../server/scoring.ts';
import {searchAreaExclusion,discoveryAreaFailure,applySearchArea} from '../server/search-area.ts';
import {deskCategory} from '../src/desk-category.ts';
const make=(extra={})=>listingSchema.parse({source:'facebook',sourceId:'354-fixture',url:'https://www.facebook.com/marketplace/item/354/',title:'1 Bed 1 Bath - Apartment',address:'',area:'Unknown',rent:2650,beds:1,description:'Beautifully Renovated Ocean-View Suite for Rent — Bowen Island\n800 sq ft • High Ceilings',...extra});

test('Bowen Island description excludes the home from quick and full scoring despite blank address',()=>{
 const listing=make(),c=criteriaSchema.parse({});assert.match(mainlandExclusion(listing)!,/Bowen Island/);
 assert.equal(quickRank(listing,c).eligible,false);assert.equal(scoreBase(listing,c).eligible,false);
 assert.ok(scoreBase(listing,c).reasons.some(r=>r.includes('mainland')));
});
test('mainland gate applies before saved-home exemptions and before discovery admission',()=>{
 const db=new Store(':memory:');try{
  db.set('searchAreaPolicy',{regions:['north-vancouver'],existingHomeIds:[354],mode:'source-filters',sourceRoutes:{facebook:[{url:'https://www.facebook.com/north/',region:'north-vancouver'}]}});
  const listing=make({homeId:354});assert.match(searchAreaExclusion(db,listing)!,/mainland/);
  assert.match(discoveryAreaFailure(db,{title:'Suite on Bowen Island',city:'North Vancouver'})!,/mainland/);
  const scoped=applySearchArea(db,listing,{searchUrl:'https://www.facebook.com/north/',searchRegion:'north-vancouver'});assert.match(searchAreaExclusion(db,scoped)!,/mainland/);
 }finally{db.close();}
});
test('island municipalities and other explicit island locations are excluded',()=>{
 for(const fields of [{address:'123 Example Road, Nanaimo, BC'},{city:'Victoria'},{area:'Salt Spring Island'},{description:'This apartment is located on Gabriola Island.'},{title:'Oceanfront suite — Vancouver Island'},{description:'Location: Bowen Island'},{description:'A renovated apartment in downtown Victoria.'}])assert.ok(mainlandExclusion(fields),JSON.stringify(fields));
});
test('island views, ferries, mainland street names and kitchens do not exclude a mainland home',()=>{
 for(const fields of [
  {title:'Views of Bowen Island',address:'5252 Marine Drive, West Vancouver'},
  {title:'Bowen Island views from West Vancouver'},
  {description:'Enjoy stunning sunsets over Vancouver Island.'},
  {description:'Catch the ferry to Nanaimo, Bowen Island, or the Sunshine Coast.'},
  {description:'15-minute drive to Horseshoe Bay – ferries to Bowen Island, Sunshine Coast and Vancouver Island'},
  {description:'Views of Passage Island directly across from your yard.'},
  {description:'Located near Bowen Island ferry terminal in Horseshoe Bay.'},
  {address:'330 Nanaimo St N, Vancouver, BC',area:'Victoria-Fraserview'},
  {address:'1525 E 55th Ave, Vancouver, BC',area:'Victoria'},
  {description:'Kitchen with a large island. Near Granville Island market.'},
  {title:'Suite in Gibsons',description:'A mainland Sunshine Coast apartment.'}
 ])assert.equal(mainlandExclusion(fields),undefined,JSON.stringify(fields));
});
test('current exclusion overrides preserved grades, rescue and Interested without erasing saved notes',()=>{
 const db=new Store(':memory:');try{
  const id=db.ingest(make()).id;db.set('reviewWorkflow',{mode:'quick-first'});
  const rank={grade:'S',rankValue:98,eligible:true,reasons:[],flags:[]};db.set(`preservedQuickRank:${id}`,rank);
  db.db.prepare("UPDATE homes SET stage='Interested',rescued=1,notes='Keep my note' WHERE id=?").run(id);
  db.set('searchAreaPolicy',{regions:['north-vancouver'],existingHomeIds:[id]});
  const h=db.home(id)!;assert.equal(deskCategory(h),'Excluded');assert.equal(h.notes,'Keep my note');assert.deepEqual(h.quickRank,rank);
  db.db.prepare("UPDATE homes SET stage='Unreviewed' WHERE id=?").run(id);
  assert.throws(()=>db.update(id,h.revision,{stage:'Interested',rescued:true,notes:h.notes,followUp:'',viewing:''}),/mainland/);
 }finally{db.close();}
});
