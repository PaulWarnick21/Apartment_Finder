import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {criteriaSchema,listingSchema} from '../src/domain.ts';
import {approvePlan,Budget,claimPlan,createPlan} from '../server/plans.ts';
import {areaMixBucket,areaMixProgress,areaMixRevision,mixEnabled,preferredAreaBucket,releaseAreaClaims,settleAreaCandidate,tryReserveAreaCandidate} from '../server/area-mix.ts';

const epoch='2026-11-18T18:00:00Z',downtownUrl='https://vancouver.craigslist.org/search/van/apa?query=downtown',northUrl='https://vancouver.craigslist.org/search/nvn/apa';
const downtownCard={searchUrl:downtownUrl,searchRegion:'downtown-vancouver'},northCard={searchUrl:northUrl,searchRegion:'north-vancouver'};
function setup(share=.85,path=':memory:'){
 const store=new Store(path);store.set('reviewWorkflow',{mode:'quick-first'});
 store.set('criteria',criteriaSchema.parse({quickIntake:{minRent:1000,maxRent:3500,minPhotos:1,allowedBeds:[1,2]}}));
 store.set('searchAreaPolicy',{mode:'source-filters',regions:['downtown-vancouver','north-vancouver','west-vancouver'],existingHomeIds:[],configuredAt:epoch,sourceRoutes:{craigslist:[{url:downtownUrl,region:'downtown-vancouver'},{url:northUrl,region:'north-vancouver'}]}});
 store.set('areaMixPolicy',{downtownShare:share,configuredAt:epoch,baselineHomeIds:[]});
 const plan=createPlan(store,{sources:['craigslist'],assessmentMode:'quick',billingMode:'chatgpt',maxPages:10,maxListings:60,maxPhotos:100,maxAiCalls:0,maxReservedUsd:0,maxAddressLookups:0});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);
 return {store,budget:new Budget(store,plan.id,plan.caps)};
}
function apartment(store:Store,name:string,region:'downtown'|'north-west',photos=true){
 const route=region==='downtown'?downtownCard:northCard;
 return store.ingest(listingSchema.parse({source:'craigslist',sourceId:name,url:`https://vancouver.craigslist.org/van/apa/d/${name}/1234567890.html`,title:name,address:region==='downtown'?'100 Example St, Vancouver':'100 Example St, North Vancouver',area:region==='downtown'?'Downtown':'North Vancouver',unit:name,rent:2400,beds:1,laundry:'in-unit',galleryComplete:true,expectedPhotos:1,evidence:{searchAreaSourceUrl:route.searchUrl,searchAreaRegion:route.searchRegion},photos:[{id:name,url:`https://images.craigslist.org/${name}.jpg`,...(photos?{local:name+'.jpg',status:'downloaded'}:{status:'pending'})}]})).id;
}

test('future unique admissions converge to 85/15 and user decisions do not rewrite the mix',()=>{
 const {store,budget}=setup();try{
  for(let n=0;n<20;n++){
   const region=preferredAreaBucket(store),card=region==='downtown'?downtownCard:northCard;
   const claim=tryReserveAreaCandidate(store,budget,'craigslist',String(n),card);assert.equal(claim.allowed,true);
   const id=apartment(store,String(n),region);settleAreaCandidate(store,budget,claim.token,id);
  }
  const progress=areaMixProgress(store);assert.equal(progress.downtown,17);assert.equal(progress.northWest,3);assert.equal(progress.claimedNorthWest,0);
  const home=store.homes()[0];store.update(home.id,home.revision,{stage:'Not Interested',notes:'Keep this note',followUp:'',viewing:'',rescued:false});
  assert.equal(areaMixProgress(store).total,20);assert.equal(store.home(home.id)!.notes,'Keep this note');
 }finally{store.close();}
});

test('parallel North/West claims cannot spend the same geographic slot and failed work releases it',()=>{
 const {store,budget}=setup();try{
  for(let n=0;n<3;n++)settleAreaCandidate(store,budget,undefined,apartment(store,'d'+n,'downtown'));
  const before=areaMixRevision(store),first=tryReserveAreaCandidate(store,budget,'craigslist','first',northCard);assert.ok(first.token);
  assert.equal(tryReserveAreaCandidate(store,budget,'craigslist','first',northCard).token,first.token);
  assert.equal(tryReserveAreaCandidate(store,budget,'craigslist','second',northCard).allowed,false);
  assert.notEqual(areaMixRevision(store),before);settleAreaCandidate(store,budget,first.token);
  assert.equal(areaMixProgress(store).total,3);assert.equal(tryReserveAreaCandidate(store,budget,'craigslist','second',northCard).allowed,true);
  releaseAreaClaims(store,budget.id);assert.equal(areaMixProgress(store).claimedNorthWest,0);
  tryReserveAreaCandidate(store,budget,'craigslist','cancelled',northCard);store.db.prepare("UPDATE plans SET state='cancelled' WHERE id=?").run(budget.id);
  assert.equal(areaMixProgress(store).claimedNorthWest,0);
 }finally{store.close();}
});

test('only new eligible photo-collected homes count, and baseline resumes bypass the gate',()=>{
 const {store,budget}=setup();try{
  const old=apartment(store,'old','north-west');store.set('areaMixPolicy',{downtownShare:.85,configuredAt:epoch,baselineHomeIds:[old]});
  assert.equal(tryReserveAreaCandidate(store,budget,'craigslist','old',{...northCard,homeId:old}).allowed,true);settleAreaCandidate(store,budget,undefined,old);
  const pending=apartment(store,'pending','downtown',false);settleAreaCandidate(store,budget,undefined,pending);assert.equal(areaMixProgress(store).total,0);
  const fresh=apartment(store,'fresh','downtown');settleAreaCandidate(store,budget,undefined,fresh);settleAreaCandidate(store,budget,undefined,fresh);assert.equal(areaMixProgress(store).total,1);
  const home=store.home(fresh)!;home.listing.beds=0;store.db.prepare('UPDATE homes SET listing=? WHERE id=?').run(JSON.stringify(home.listing),fresh);
  assert.equal(areaMixProgress(store).total,1,'previous admission remains sticky after later fact changes');
 }finally{store.close();}
});

test('independent worker connections share reservations and duplicate aliases count once',()=>{
 const {store,budget}=setup(.85,join(mkdtempSync(join(tmpdir(),'area-mix-')),'homes.sqlite')),other=new Store(store.path),otherBudget=new Budget(other,budget.id,budget.caps);
 try{
  const ids=Array.from({length:3},(_,n)=>apartment(store,'shared-d'+n,'downtown'));for(const id of ids)settleAreaCandidate(store,budget,undefined,id);
  const first=tryReserveAreaCandidate(store,budget,'craigslist','first',northCard);assert.equal(first.allowed,true);
  assert.equal(tryReserveAreaCandidate(other,otherBudget,'craigslist','second',northCard).allowed,false);
  settleAreaCandidate(store,budget,first.token);assert.equal(tryReserveAreaCandidate(other,otherBudget,'craigslist','second',northCard).allowed,true);
  store.mergeHomes(ids[0],ids[1]);assert.equal(areaMixProgress(other).downtown,2);
  settleAreaCandidate(other,otherBudget,undefined,ids[1]);assert.equal(areaMixProgress(store).downtown,2);
 }finally{other.close();store.close();}
});

test('fallback requires exhausted checked Downtown routes with no queued or unfinished new home',()=>{
 const {store,budget}=setup();try{
  const coverage=(status:string)=>store.set('inventoryCoverage:craigslist',[{url:downtownUrl,next:null,status}]);
  for(const status of ['pending','partial','blocked','unverified']){coverage(status);assert.equal(tryReserveAreaCandidate(store,budget,'craigslist','north',northCard).allowed,false);}
  coverage('exhausted');assert.equal(areaMixProgress(store).downtownDrained,true);
  assert.equal(tryReserveAreaCandidate(store,budget,'craigslist','north',northCard).allowed,true);releaseAreaClaims(store,budget.id);
  store.set('discoveryQueue:craigslist',{urls:['queued'],cards:{queued:downtownCard},next:null});assert.equal(areaMixProgress(store).downtownDrained,false);
  store.set('discoveryQueue:craigslist',{urls:[],next:null});const id=apartment(store,'waiting','downtown',false);assert.equal(areaMixProgress(store).downtownDrained,false);
  const home=store.home(id)!;home.listing.photos[0].status='unavailable';store.db.prepare('UPDATE homes SET listing=? WHERE id=?').run(JSON.stringify(home.listing),id);
  assert.equal(areaMixProgress(store).downtownDrained,true);
  const closed=apartment(store,'closed-pending','downtown',false),closedHome=store.home(closed)!;
  store.update(closed,closedHome.revision,{stage:'Not Interested',notes:'Do not resume',followUp:'',viewing:'',rescued:false});
  assert.equal(areaMixProgress(store).downtownDrained,true,'closed incomplete galleries are not future intake work');
 }finally{store.close();}
});

test('scoped facts override source provenance and reclassification atomically releases earlier claims',()=>{
 const {store,budget}=setup();try{
  assert.equal(areaMixBucket(store,'craigslist',{...downtownCard,address:'100 Main St, North Vancouver'}),'north-west');
  assert.equal(areaMixBucket(store,'craigslist',{searchRegion:'downtown-vancouver',searchUrl:'https://untrusted.example/downtown'}),undefined);
  assert.equal(areaMixBucket(store,'craigslist',{...downtownCard,address:'100 Main St, Burnaby'}),undefined);
  const initial=tryReserveAreaCandidate(store,budget,'craigslist','same',downtownCard);assert.ok(initial.token);
  assert.equal(tryReserveAreaCandidate(store,budget,'craigslist','same',{...downtownCard,address:'100 Main St, North Vancouver'}).allowed,false);assert.equal(areaMixProgress(store).claimedDowntown,0);
 }finally{store.close();}
});

test('zero and hundred percent preferences remain usable and old epochs do not carry quotas forward',()=>{
 const {store,budget}=setup(0);try{
  assert.equal(preferredAreaBucket(store),'north-west');assert.equal(tryReserveAreaCandidate(store,budget,'craigslist','north',northCard).allowed,true);
  store.set('areaMixPolicy',{downtownShare:1,configuredAt:epoch+'-next',baselineHomeIds:[]});assert.equal(preferredAreaBucket(store),'downtown');assert.equal(areaMixProgress(store).claimedNorthWest,0);
  assert.equal(tryReserveAreaCandidate(store,budget,'craigslist','next',northCard).allowed,false);assert.equal(tryReserveAreaCandidate(store,budget,'craigslist','downtown',downtownCard).allowed,true);
  store.db.prepare('DELETE FROM meta WHERE key=?').run('areaMixPolicy');assert.equal(mixEnabled(store,budget),false);assert.equal(tryReserveAreaCandidate(store,budget,'craigslist','north',northCard).allowed,true);
 }finally{store.close();}
});
