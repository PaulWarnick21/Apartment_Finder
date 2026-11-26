import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {Store} from '../server/db.ts';
import {ChromeJobs} from '../server/chrome-jobs.ts';
import {createPlan,approvePlan,claimPlan,Budget,getPlan} from '../server/plans.ts';
import {recoverZillowChrome} from '../server/chrome-recovery.ts';
import {extractRemaining} from '../server/remaining-extraction.ts';
import {discoverSource} from '../server/source-discovery.ts';
import {sourceById} from '../server/sources.ts';
import {runRegularPlan} from '../server/regular-worker.ts';
import {isQuarantined} from '../server/discovery-queue.ts';

const url='https://www.zillow.com/homedetails/Example/123_zpid/';
const image='https://photos.zillowstatic.com/fp/example.jpg';
function capture(property:any,body='Rental details',path='/homedetails/Example/123_zpid/'){
 const data={props:{pageProps:{componentProps:{gdpClientCache:JSON.stringify({target:{property},account:{email:'private@example.test'}})}}}};
 const document={title:'Rental',body:{innerText:body},querySelector:()=>({textContent:JSON.stringify(data)}),querySelectorAll:()=>[{href:url},{href:'https://evil.example/homedetails/Example/123_zpid/'}]};
 return JSON.parse(JSON.stringify(runInNewContext(readFileSync('extension/zillow-capture.js','utf8').replace('export function captureZillow','function captureZillow')+'\ncaptureZillow()',{URL,document,location:{origin:'https://www.zillow.com',pathname:path}})));
}
const property={zpid:123,streetAddress:'100 Example #4',city:'Vancouver',state:'BC',price:2400,bedrooms:1,bathrooms:1,livingArea:650,description:'In-unit laundry. Unfurnished.',homeStatus:'FOR_RENT',ownerEmail:'private@example.test',originalPhotos:[{mixedSources:{jpeg:[{url:image,width:1600,height:1200},{url:image+'?small',width:320,height:240}]}}],responsivePhotos:[{}]};
test('Zillow capture scopes public property data and preserves full resolution gallery',()=>{
 const page=capture(property);assert.equal(page.galleryComplete,true);assert.equal(page.images[0].url,image);assert.ok(!JSON.stringify(page).includes('private@example.test'));
 const listing=extractRemaining('zillow',page.html,url);assert.equal(listing.rent,2400);assert.equal(listing.unit,'4');assert.equal(listing.photos.length,1);assert.equal(listing.photos[0].url,image);assert.equal(listing.laundry,'in-unit');
 assert.equal(capture({...property,responsivePhotos:[{},{}]}).galleryComplete,false);
 assert.equal(capture(property,'Press & hold to verify').warning!==null,true);
 assert.throws(()=>capture({...property,zpid:999}),/not available/);
 assert.throws(()=>extractRemaining('zillow',capture({...property,homeStatus:'FOR_SALE'}).html,url),/not currently advertised for rent/);
 for(const [description,expected] of [['Laundry room in the building.','shared-only'],['No in-unit laundry. Laundry room in the building.','shared-only'],['No in-unit laundry.','none'],['In-unit laundry. Additional shared laundry in the building.','in-unit']]){
  assert.equal(extractRemaining('zillow',capture({...property,description}).html,url).laundry,expected);
 }
});
test('Regular Zillow scans dispatch through the paired Chrome bridge and apply the rent gate',async()=>{
 const {db,p,jobs}=setup(),dir=mkdtempSync(join(tmpdir(),'af-zillow-'));db.set('discoveryQueue:zillow',{urls:[url],next:null});
 try{const done=runRegularPlan(db,p.id,dir,jobs);await new Promise(resolve=>setTimeout(resolve,20));const discovery=jobs.poll().job!;assert.equal(discovery.kind,'discovery');jobs.result({id:discovery.id,snapshot:capture(null,'Rental search','/vancouver-bc/rentals/')});await new Promise(resolve=>setTimeout(resolve,20));const job=jobs.poll().job!;assert.equal(job.kind,'listing');
 jobs.result({id:job.id,snapshot:capture({...property,price:5000})});await done;
 assert.equal(db.homes().length,1);assert.equal(db.homes()[0].listing.source,'zillow');assert.equal(getPlan(db,p.id).usage.photos,0);assert.equal(getPlan(db,p.id).usage.aiCalls,0);assert.equal(getPlan(db,p.id).usage.pages,2);
 }finally{jobs.fail('cleanup');db.close();rmSync(dir,{recursive:true,force:true});}
});

test('Zillow placeholder or missing rent stays unknown instead of losing the rental',()=>{
 for(const price of [0,1,null,undefined]){
  const listing=extractRemaining('zillow',capture({...property,price}).html,url);
  assert.equal(listing.rent,null);assert.match(listing.evidence.rent,/not supplied/);
  assert.equal(listing.photos.length,1);
 }
 assert.equal(extractRemaining('zillow',capture(property).html,url).rent,2400);
});

test('confirmed Zillow sale ads are non-rental failures while unknown statuses still need extraction review',async()=>{
 for(const [homeStatus,kind] of [['FOR_SALE','prefilter'],['UNRECOGNIZED_STATUS','parse']]){
  const db=new Store(':memory:'),dir=mkdtempSync(join(tmpdir(),'af-zillow-sale-'));
  try{
   const p=createPlan(db,{phase:'assessment',trafficPolicy:'session',sources:['zillow'],billingMode:'chatgpt',newListingsOnly:true,targetNewListingsPerSource:1,maxPages:1,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});approvePlan(db,p.id,'APPROVE ONE SCAN');db.set('discoveryQueue:zillow',{urls:[url],next:null});
   await runRegularPlan(db,p.id,dir,undefined,{session:(_source,budget)=>({stopped:false,start:async()=>{},close:async()=>{},html:async()=>{budget.reserve('pages');return capture({...property,homeStatus}).html;},resource:async()=>{throw Error('No resource expected');},image:async()=>{throw Error('No photos expected');}})});
   const failures=db.get<any[]>('candidateFailures:zillow')!;assert.equal(failures.length,1);assert.equal(failures[0].kind,kind);assert.equal(isQuarantined(db,'zillow',url),kind==='parse');assert.equal(db.homes().length,0);assert.equal(getPlan(db,p.id).usage.aiCalls,0);assert.equal(getPlan(db,p.id).usage.photos,0);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
 }
});
test('Zillow discovery uses only visible same-site unit links',()=>{
 const page=capture(null,'Rental search','/vancouver-bc/rentals/');assert.deepEqual(discoverSource(page.html,sourceById('zillow')),[url]);assert.equal(page.images.length,0);
});
test('Zillow search diagnostics retain bounded schema keys without application values',()=>{
 const data={props:{pageProps:{account:{email:'private@example.test'},searchPageState:{cat1:{searchResults:{listResults:[{privateValue:'do-not-copy'}],mapResults:[]}},csrfToken:'do-not-copy'}}}};
 const document={title:'Rental search',body:{innerText:'Search'},querySelector:(selector:string)=>selector==='#__NEXT_DATA__'?{textContent:JSON.stringify(data)}:null,querySelectorAll:()=>[]};
 const page=runInNewContext(readFileSync('extension/zillow-capture.js','utf8').replace('export function captureZillow','function captureZillow')+'\ncaptureZillow()',{URL,document,location:{origin:'https://www.zillow.com',pathname:'/vancouver-bc/rentals/'}});
 assert.match(page.html,/searchPageState.cat1.searchResults.listResults/);
 assert.ok(!page.html.includes('private@example.test'));assert.ok(!page.html.includes('do-not-copy'));assert.ok(!page.html.includes('privateValue'));
});
function setup(recovery=false){const db=new Store(':memory:');db.set('browserExtension',{id:'a'.repeat(32)});if(recovery)db.pause('zillow','Previous 403',true,Date.now()-1);const p=createPlan(db,{purpose:recovery?'access-check':'listings',sources:['zillow'],billingMode:'chatgpt',maxPages:recovery?1:2,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0},{accessRecovery:recovery});approvePlan(db,p.id,'APPROVE ONE SCAN');return {db,p,jobs:new ChromeJobs(db)};}
test('Chrome jobs enforce approved source, matching origin, and source-specific warnings',async()=>{
 const {db,p,jobs}=setup();try{claimPlan(db,p.id);const budget=new Budget(db,p.id,p.caps);assert.throws(()=>jobs.request(budget,'https://www.apartments.com/unit/abcdefg/','listing',null,0),/not included/);
 const done=jobs.request(budget,url,'listing',null,0);const rejected=assert.rejects(done,/Zillow shows/);const job=jobs.poll().job!;
 assert.throws(()=>jobs.result({id:job.id,snapshot:{...capture(property),url:url.replace('www.zillow.com','www.apartments.com')}}),/different/);
 jobs.result({id:job.id,snapshot:capture(property,'Access denied')});await rejected;assert.throws(()=>db.checkSource('zillow'),/paused/);assert.doesNotThrow(()=>db.checkSource('apartments'));
 assert.equal(db.db.prepare("SELECT source FROM requests WHERE kind='page'").get()?.source,'zillow');
 }finally{jobs.fail('cleanup');db.close();}
});
test('Explicit one-page recovery verifies discovery before clearing only Zillow pause',async()=>{
 const {db,p,jobs}=setup(true),dir=mkdtempSync(join(tmpdir(),'af-zillow-'));db.pause('apartments','Other warning',true);
 try{const done=recoverZillowChrome(db,p.id,dir,jobs);const job=jobs.poll().job!;jobs.result({id:job.id,snapshot:capture(null,'Search','/vancouver-bc/rentals/')});await done;
 assert.doesNotThrow(()=>db.checkSource('zillow'));assert.throws(()=>db.checkSource('apartments'),/paused/);assert.equal(getPlan(db,p.id).usage.pages,1);assert.equal(getPlan(db,p.id).usage.aiCalls,0);assert.equal(db.homes().length,0);
 }finally{jobs.fail('cleanup');db.close();rmSync(dir,{recursive:true,force:true});}
});
test('Empty or challenged recovery never clears the existing source pause',async()=>{
 for(const warning of [null,'Access warning']){const {db,p,jobs}=setup(true),dir=mkdtempSync(join(tmpdir(),'af-zillow-'));
 try{const done=recoverZillowChrome(db,p.id,dir,jobs);jobs.result({id:jobs.poll().job!.id,snapshot:{...capture(null,'Search','/vancouver-bc/rentals/'),html:'<main>No results loaded</main>',links:[],warning}});await done;assert.throws(()=>db.checkSource('zillow'),/paused/);assert.equal(getPlan(db,p.id).state,'partial');
 }finally{jobs.fail('cleanup');db.close();rmSync(dir,{recursive:true,force:true});}}
});
