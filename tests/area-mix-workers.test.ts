import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../server/db.ts';
import {criteriaSchema,listingSchema,type Listing} from '../src/domain.ts';
import {createPlan,approvePlan,getPlan} from '../server/plans.ts';
import {runRegularPlan,type ScanDependencies} from '../server/regular-worker.ts';
import {saveQueue,readQueue} from '../server/discovery-queue.ts';
import {areaMixProgress,areaMixBucket,tryReserveAreaCandidate,settleAreaCandidate} from '../server/area-mix.ts';

const downtown='https://vancouver.craigslist.org/search/van/apa?query=downtown',north='https://www.rew.ca/rentals/areas/north-vancouver-bc';
function setup(){
 const store=new Store(':memory:');store.set('reviewWorkflow',{mode:'quick-first'});
 store.set('criteria',criteriaSchema.parse({quickIntake:{minRent:1000,maxRent:3500,minPhotos:1,allowedBeds:[1,2]}}));
 store.set('searchAreaPolicy',{mode:'source-filters',regions:['downtown-vancouver','north-vancouver','west-vancouver'],existingHomeIds:[],configuredAt:'fixture',sourceRoutes:{craigslist:[{url:downtown,region:'downtown-vancouver'}],rew:[{url:north,region:'north-vancouver'}]}});
 store.set('areaMixPolicy',{downtownShare:.85,configuredAt:'fixture',baselineHomeIds:[]});return store;
}
function offering(source:'craigslist'|'rew',n:number,photos=true):Listing{
 const downtownHome=source==='craigslist',url=downtownHome?`https://vancouver.craigslist.org/van/apa/d/example/${1000000000+n}.html`:`https://www.rew.ca/rentals/${100000+n}/example`;
 return listingSchema.parse({source,sourceId:String(n),url,title:'One bedroom apartment',offeringKind:'unit',address:downtownHome?'100 Example St, Vancouver':'100 Example St, North Vancouver',area:downtownHome?'Downtown':'North Vancouver',unit:String(n),rent:2400,beds:1,laundry:'in-unit',galleryComplete:true,expectedPhotos:1,evidence:{searchAreaSourceUrl:downtownHome?downtown:north,searchAreaRegion:downtownHome?'downtown-vancouver':'north-vancouver'},photos:[{id:String(n),url:`https://images.craigslist.org/${source}-${n}.jpg`,status:photos?'downloaded':'pending',...(photos?{local:`${source}-${n}.jpg`}:{})}]});
}
const caps={assessmentMode:'quick',billingMode:'chatgpt',trafficPolicy:'session',sources:['craigslist','rew'],maxPages:80,maxListings:80,maxPhotos:100,maxAiCalls:0,maxAddressLookups:0,maxReservedUsd:0,newListingsOnly:true,targetNewListingsPerSource:20,targetNewListingsBySource:{craigslist:17,rew:20}};

test('parallel sources admit 17 Downtown and 3 North/West, retain excess candidates and retry without rediscovery',async()=>{
 const store=setup(),dir=mkdtempSync(join(tmpdir(),'area-workers-')),starts:Record<string,number>={},discovery:Record<string,number>={};
 const downtownOffers=Array.from({length:17},(_,i)=>offering('craigslist',i)),northOffers=Array.from({length:20},(_,i)=>offering('rew',i));
 saveQueue(store,'craigslist',{urls:[],next:null,offerings:downtownOffers});saveQueue(store,'rew',{urls:[],next:null,offerings:northOffers});
 const deps:ScanDependencies={session:(source,budget)=>({stopped:false,start:async()=>{starts[source.id]=(starts[source.id]??0)+1;if(source.id==='craigslist')await new Promise(done=>setTimeout(done,20));},close:async()=>{},html:async url=>{budget.reserve('pages');discovery[source.id]=(discovery[source.id]??0)+1;assert.ok(url===downtown||url===north,'facts already collected; only fresh discovery expected');return `<a href="${(source.id==='craigslist'?downtownOffers:northOffers)[0].url}">One bedroom apartment</a>`;},resource:async()=>'',image:async()=>{throw Error('Saved photos only');}})};
 try{
  const plan=createPlan(store,caps);approvePlan(store,plan.id,'APPROVE ONE SCAN');await runRegularPlan(store,plan.id,dir,undefined,deps);
  const progress=areaMixProgress(store);assert.equal(progress.downtown,17);assert.equal(progress.northWest,3);assert.equal(progress.total,20);assert.equal(progress.claimedNorthWest,0);assert.equal(progress.claimedDowntown,0);
  assert.ok(starts.rew>=2,'North source should yield and then resume after Downtown admissions');assert.deepEqual(discovery,{craigslist:1,rew:1});
  assert.equal(readQueue(store,'rew').offerings?.length,17);assert.equal(getPlan(store,plan.id).usage.listings,20);assert.equal(getPlan(store,plan.id).usage.pages,2);assert.equal(getPlan(store,plan.id).usage.aiCalls,0);
  assert.equal(store.db.prepare('SELECT 1 FROM scan_lock').get(),undefined);
 }finally{store.close();}
});

test('parsed North Vancouver facts cannot spend a Downtown card claim and remain queued without photos or a home',async()=>{
 const store=setup(),dir=mkdtempSync(join(tmpdir(),'area-parsed-')),url=offering('craigslist',1).url;
 saveQueue(store,'craigslist',{urls:[url],next:null,cards:{[url]:{url,searchUrl:downtown,searchRegion:'downtown-vancouver'}}});
 const html=readFileSync('tests/fixtures/craigslist.html','utf8').replace('100 Example Street','100 Example Street, North Vancouver');let images=0;
 try{
  const plan=createPlan(store,{...caps,sources:['craigslist'],phase:'assessment',maxListings:20,targetNewListingsPerSource:1,targetNewListingsBySource:{craigslist:1}});approvePlan(store,plan.id,'APPROVE ONE SCAN');
  await runRegularPlan(store,plan.id,dir,undefined,{session:(_source,budget)=>({stopped:false,start:async()=>{},close:async()=>{},html:async()=>{budget.reserve('pages');return html;},resource:async()=>'',image:async()=>{images++;throw Error('No photo work allowed');}})});
  assert.equal(store.homes().length,0);assert.equal(images,0);const queue=readQueue(store,'craigslist');assert.equal(queue.offerings?.length,1);assert.equal(areaMixBucket(store,'craigslist',queue.offerings![0]),'north-west');assert.equal(areaMixProgress(store).claimedDowntown,0);
  assert.equal((getPlan(store,plan.id).sources as Array<{areaDeferred?:boolean}>)[0].areaDeferred,true);
 }finally{store.close();}
});

test('a failed source releases regional claims without counting a photo-less apartment',async()=>{
 const store=setup(),dir=mkdtempSync(join(tmpdir(),'area-failed-'));
 saveQueue(store,'craigslist',{urls:[],next:null,offerings:[offering('craigslist',1,false)]});
 try{
  const plan=createPlan(store,{...caps,sources:['craigslist'],phase:'assessment',maxListings:20,targetNewListingsPerSource:1,targetNewListingsBySource:{craigslist:1}});approvePlan(store,plan.id,'APPROVE ONE SCAN');
  await runRegularPlan(store,plan.id,dir,undefined,{session:()=>({stopped:false,start:async()=>{},close:async()=>{},html:async()=>{throw Error('No detail needed');},resource:async()=>'',image:async()=>{throw Error('Fixture image failure');}})});
  assert.equal(areaMixProgress(store).total,0);assert.equal(areaMixProgress(store).claimedDowntown,0);assert.equal(areaMixProgress(store).claimedNorthWest,0);assert.equal(store.homes().length,1);assert.ok(!store.homes()[0].listing.photos[0].local);
 }finally{store.close();}
});

test('regional priority compares URL and parsed-offering pools before posting age',async()=>{
 const store=setup(),dir=mkdtempSync(join(tmpdir(),'area-pools-')),url=offering('craigslist',1).url;
 const northOffer={...offering('craigslist',2),area:'North Vancouver',address:'100 Example St, North Vancouver'};
 saveQueue(store,'craigslist',{urls:[url],next:null,cards:{[url]:{url,postedAt:'2020-01-01',searchUrl:downtown,searchRegion:'downtown-vancouver'}},offerings:[northOffer]});
 const visited:string[]=[];
 try{
  const plan=createPlan(store,{...caps,sources:['craigslist'],phase:'assessment',maxListings:20,maxPhotos:0,targetNewListingsPerSource:1,targetNewListingsBySource:{craigslist:1}});approvePlan(store,plan.id,'APPROVE ONE SCAN');
  await runRegularPlan(store,plan.id,dir,undefined,{session:(_source,budget)=>({stopped:false,start:async()=>{},close:async()=>{},html:async target=>{visited.push(target);budget.reserve('pages');return readFileSync('tests/fixtures/craigslist.html','utf8');},resource:async()=>'',image:async()=>{throw Error('No image allowance');}})});
  assert.deepEqual(visited,[url]);assert.equal(readQueue(store,'craigslist').offerings?.[0].sourceId,northOffer.sourceId);
 }finally{store.close();}
});

test('a deferred source resumes cached facts with its same exhausted page allowance',async()=>{
 const store=setup(),dir=mkdtempSync(join(tmpdir(),'area-zero-pages-'));store.set('browserExtension',{});
 const policy=store.get<any>('searchAreaPolicy');policy.sourceRoutes.apartments=[{url:'https://www.apartments.com/condos/north-vancouver-bc/',region:'north-vancouver'}];store.set('searchAreaPolicy',policy);
 saveQueue(store,'craigslist',{urls:[],next:null,offerings:[0,1,2].map(n=>offering('craigslist',n))});
 const cached=listingSchema.parse({...offering('rew',20),source:'apartments',url:'https://www.apartments.com/fixture/abcdefg/',evidence:{searchAreaSourceUrl:policy.sourceRoutes.apartments[0].url,searchAreaRegion:'north-vancouver'}});
 saveQueue(store,'apartments',{urls:[],next:null,offerings:[cached]});let calls=0,firstBudget:unknown;
 try{
  const plan=createPlan(store,{...caps,sources:['craigslist','apartments'],phase:'assessment',maxPages:8,maxListings:8,targetNewListingsPerSource:1,targetNewListingsBySource:{craigslist:3,apartments:1}});approvePlan(store,plan.id,'APPROVE ONE SCAN');
  await runRegularPlan(store,plan.id,dir,undefined,{
   session:()=>({stopped:false,start:async()=>{await new Promise(done=>setTimeout(done,20));},close:async()=>{},html:async()=>{throw Error('Cached facts only');},resource:async()=>'',image:async()=>{throw Error('Cached photos only');}}),
   apartments:async(_store,budget,_dir,_jobs,options)=>{
    calls++;if(calls===1){firstBudget=budget;budget.reserve('pages',budget.remaining('pages'));return {source:'apartments',state:'partial',areaDeferred:true,detail:'Fixture waits for Downtown admissions'};}
    assert.equal(budget,firstBudget);assert.equal(budget.remaining('pages'),0);assert.equal(options?.resumeSourcePhase,true);
    const claim=tryReserveAreaCandidate(store,budget,'apartments',cached.url,cached);assert.equal(claim.allowed,true);budget.reserve('listings');settleAreaCandidate(store,budget,claim.token,store.ingest(cached).id);
    return {source:'apartments',state:'complete',detail:'Cached facts resumed without a page request'};
   }
  });
  assert.equal(calls,2);assert.equal(areaMixProgress(store).downtown,3);assert.equal(areaMixProgress(store).northWest,1);assert.equal(getPlan(store,plan.id).usage.pages,2);
 }finally{store.close();}
});
