// Offline browser regression: npx tsx tests/ui/detail-fields.ts
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {build} from 'vite';
import {criteriaSchema,listingSchema,type Home} from '../../src/domain.ts';
import {deskSections} from '../../src/desk-sections.ts';
import type {RatingFeedback} from '../../src/rating-types.ts';

function fixture(id:number):Home{
 return {id,listing:listingSchema.parse({source:'fixture',sourceId:String(id),url:`https://example.test/${id}`,title:`Fixture apartment ${id}`,address:`${id} Example Street`,rent:2400,beds:1,conflicts:['Fixture conflicting lease terms'],photos:[{id:'one',url:'https://example.test/photo.jpg',local:'fixture.jpg'}]}),score:{value:4,low:3,high:5,base:4,adjustments:[],flags:['Parking unsure'],reasons:[],eligible:true,uncertain:true,view:'Unverified'},stage:'Unreviewed',notes:'Saved note',followUp:'',viewing:'',revision:1,rescued:false,updatedAt:'2026-11-18T13:00:00Z',firstSeen:'2026-11-18T13:00:00Z',possibleDuplicates:[],postings:[{source:'fixture',url:`https://example.test/${id}`} ]};
}
const homes=[fixture(1),fixture(2)];
const ratings=new Map<number,RatingFeedback[]>(),submissionIds:string[]=[],operations:string[]=[];
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
let loseRatingReply=false,revisionConflicts=0,ratingOffline=false,ratingFailures=0,ratingGate:ReturnType<typeof gate>|undefined;
for(const home of homes){
 home.stage='Interested';home.reviewMode='full';
 home.fullReview={status:'complete',detail:'Full scoring complete',updatedAt:home.updatedAt};
 home.listing.description=home.id===1?'This apartment is unfurnished.':'This apartment is fully furnished.';
}
console.log('Starting offline detail-view fixture');
// Serve the real app bundle entirely from memory; no localhost/network access required.
const bundle=await build({configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':'"development"'},build:{write:false,minify:false}});
assert.ok('output' in bundle);
const assets=new Map(bundle.output.map(item=>[item.fileName,item.type==='chunk'?item.code:item.source]));
console.log('Launching isolated test browser');
const browser=await chromium.launch({headless:true,timeout:15000});
try{
 const page=await browser.newPage();
 const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 const origin='https://apartment-fixture.test';
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  // No real listing, map, media or model requests are allowed in this test.
  if(url.origin!==origin)return route.fulfill({status:200,contentType:'text/html',body:'Offline map fixture'});
  if(url.pathname.startsWith('/media/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="green"/></svg>'});
  if(!url.pathname.startsWith('/api/')){
   const path=url.pathname==='/'?'index.html':url.pathname.slice(1),body=assets.get(path);
   return route.fulfill({status:body===undefined?404:200,contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:typeof body==='string'?body:body?Buffer.from(body):''});
  }
  const id=Number(url.pathname.split('/')[3]),home=homes.find(h=>h.id===id);
  let result:unknown;
  if(url.pathname==='/api/state')result={homes,csrf:'fixture',demo:true,sources:[],events:[],plans:[],criteria:criteriaSchema.parse({}),criteriaRevision:'1',providerReady:false,schedule:{enabled:false,reason:'Offline'}};
  else if(/\/homes\/\d+$/.test(url.pathname)){
   if(route.request().method()==='PUT'){
    const body=route.request().postDataJSON();
    if(body.revision!==home!.revision){revisionConflicts++;return route.fulfill({status:409,json:{error:'Apartment changed; reload before saving'}});}
    Object.assign(home!,body,{revision:home!.revision+1});operations.push(`stage:${body.stage}`);
   }
   result=home;
  }
  else if(url.pathname.endsWith('/ratings')){
   if(route.request().method()==='POST'){
    const body=route.request().postDataJSON();submissionIds.push(body.requestId);
    if(ratingGate)await ratingGate.promise;
    if(ratingOffline){ratingFailures++;return route.fulfill({status:503,json:{error:'Fixture rating service unavailable'}});}
    if(!ratings.get(id)?.length){
     ratings.set(id,[{id:1,homeId:id,at:new Date().toISOString(),userScore:body.score,appScore:4,reason:body.reason,status:'pending',review:null,error:'',origin:'app',canUndo:false}]);
     home!.revision++;operations.push('rating');
    }
    if(loseRatingReply){loseRatingReply=false;return route.fulfill({status:200,contentType:'text/html',body:'Interrupted response'});}
    result={rating:ratings.get(id)![0]};
   }else result={ratings:ratings.get(id)??[]};
  }
  else if(url.pathname.endsWith('/map'))result={status:'ready',label:home?.listing.address,lat:49.28,lon:-123.12};
  else if(url.pathname.endsWith('/context'))result={research:null,stale:false,airportDirections:'https://example.test/transit',transitSource:'https://example.test/transit'};
  else if(url.pathname.endsWith('/duplicates'))result={candidates:[],history:[]};
  else throw new Error(`Unexpected API request: ${route.request().method()} ${url.pathname}`);
  return route.fulfill({json:result});
 });
 await page.goto(origin);
 await page.locator('.tabs').waitFor();
 assert.deepEqual(await page.locator('.tabs button').allTextContents(),deskSections.map(s=>`${s.number}. ${s.title}`));
 await page.locator('.tabs').getByRole('button',{name:'2. Interested',exact:true}).click();
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  for(const home of homes){
   const card=page.locator('.home-card').filter({has:page.getByRole('button',{name:home.listing.address,exact:true})});
   await card.waitFor();
   assert.equal(await card.locator('.rent .furnishing-badge').innerText(),home.id===1?'Unfurnished':'Furnished');
   assert.equal(await card.locator('.view-line,.tags,.full-review-complete').count(),0);
   await page.getByRole('button',{name:home.listing.address,exact:true}).click();
   const dialog=page.getByRole('dialog',{name:new RegExp(`Apartment #${home.id}`)});
   await dialog.locator('.location-map iframe').waitFor();
   await dialog.getByLabel(/^Your notes/).fill('Unsaved note survives refresh');
   for(let revision=0;revision<3;revision++){
    home.revision++;
    home.deskExclusion=revision%2?'Fixture exclusion':undefined;
    home.score.reasons=revision%2?['Fixture warning']:[];
    const refreshed=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/homes/${home.id}`);
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await refreshed;
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    // Check every section and editable field, not only the reported map.
    for(const selector of ['.location-map','.rating-panel','.photo-grid','.detail-facts','.property-context','.apartment-summary','.source-links'])assert.equal(await dialog.locator(selector).count(),1,selector);
    for(const label of ['Your notes','Stage','Follow up on','Viewing · your local time','Your Score','Reason for Your Score'])assert.equal(await dialog.getByLabel(new RegExp('^'+label)).count(),1,label);
    assert.equal(await dialog.getByLabel(/^Your notes/).inputValue(),'Unsaved note survives refresh');
   }
   await dialog.getByText('Listing Description & Evidence',{exact:true}).click();
   assert.equal(await dialog.getByText('Fixture conflicting lease terms',{exact:true}).count(),1);
   await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
   assert.equal(await page.getByRole('dialog').count(),0);
   home.deskExclusion=undefined;
  }
 }
 for(const [stage,next] of [['Interested','Serious Candidates'],['Serious Candidates','Ready to Apply'],['Ready to Apply','In Progress']] as const){
  homes[0].stage=stage;
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.locator('.tabs').getByRole('button',{name:`${deskSections.find(s=>s.title===stage)!.number}. ${stage}`,exact:true}).click();
  const card=page.locator('.home-card').filter({has:page.getByRole('button',{name:homes[0].listing.address,exact:true})});
  await card.getByRole('button',{name:next,exact:true}).waitFor();
  assert.deepEqual(await card.locator('.interest-actions button').allTextContents(),['Interested','Serious Candidates'].includes(stage)?[next,'Revisit Later','Not Interested']:[next,'Not Interested']);
  assert.equal(await card.locator('.rent .furnishing-badge').innerText(),'Unfurnished');
  await card.getByRole('button',{name:homes[0].listing.address,exact:true}).click();
  const dialog=page.getByRole('dialog');
  const options=await dialog.getByLabel(/^Stage/).locator('option').allTextContents();
  assert.ok(options.includes(stage)&&options.includes(next));
  for(const candidate of ['Unreviewed','Interested','Serious Candidates','Ready to Apply'])if(candidate!==stage&&candidate!==next)assert.ok(!options.includes(candidate),`${stage} cannot skip to ${candidate}`);
  await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
 }
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  for(const scenario of ['advance','reject','blank','invalid','lost-reply','rating-offline','unchanged','save-changes','closed-rating'] as const){
   console.log(`Checking ${scenario} at ${viewport.width}px`);
   const home=homes[0];home.stage=scenario==='closed-rating'?'Closed':'Interested';home.revision++;
   ratings.clear();operations.length=0;submissionIds.length=0;
   if(scenario==='unchanged')ratings.set(home.id,[{id:1,homeId:home.id,at:new Date().toISOString(),userScore:3.7,appScore:4,reason:'More room for my workspace',status:'pending',review:null,error:'',origin:'app',canUndo:false}]);
   await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
   await page.locator('.tabs').getByRole('button',{name:scenario==='closed-rating'?'7. Closed':'2. Interested',exact:true}).click();
   await page.getByRole('button',{name:home.listing.address,exact:true}).click();
   const dialog=page.getByRole('dialog'),panel=dialog.getByRole('region',{name:'Your apartment rating'});
   await panel.waitFor();
   assert.equal(await dialog.getByRole('button',{name:/Submit/}).count(),0);
   if(scenario==='unchanged')await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('input[aria-label="Your Score"]')?.value==='3.7');
   else if(scenario!=='blank'){
    await panel.getByLabel('Your Score',{exact:true}).fill('3.7');
    if(scenario!=='invalid')await panel.getByLabel('Reason for Your Score',{exact:true}).fill('More room for my workspace');
   }
   const note=`Keep this ${scenario} note at ${viewport.width}px`;
   await dialog.getByLabel(/^Your notes/).fill(note);
   if(scenario==='advance'){mkdirSync('test-results',{recursive:true});await panel.screenshot({path:`test-results/combined-rating-${viewport.width}.png`});}
   const target=scenario==='reject'?'Not Interested':scenario==='closed-rating'?'Closed':'Serious Candidates';
   if(scenario==='save-changes')await dialog.getByLabel(/^Stage/).selectOption(target);
   const button=scenario==='save-changes'||scenario==='closed-rating'?dialog.getByRole('button',{name:'Save Changes',exact:true}):panel.getByRole('button',{name:target,exact:true});
   if(scenario==='lost-reply')loseRatingReply=true;
   if(scenario==='rating-offline')ratingOffline=true;
   const delayed=['advance','reject','save-changes','closed-rating'].includes(scenario);
   if(delayed)ratingGate=gate();
   await button.click();
   if(scenario==='invalid'){
    await panel.getByRole('alert').first().waitFor();
    assert.equal(home.stage,'Interested');assert.ok(!operations.some(op=>op.startsWith('stage:')));
    assert.equal(await panel.getByLabel('Your Score',{exact:true}).inputValue(),'3.7');
    await panel.getByLabel('Reason for Your Score',{exact:true}).fill('More room for my workspace');
    await button.click();
   }
   await dialog.waitFor({state:'hidden'});
   if(delayed){
    assert.deepEqual(operations,[],'Dialog closes before even the rating request finishes');
    assert.equal(home.stage,scenario==='closed-rating'?'Closed':'Interested','Server stage is still unchanged');
    const category=target==='Not Interested'?'Closed':target;
    const section=deskSections.find(s=>s.title===category)!;
    await page.locator('.tabs').getByRole('button',{name:`${section.number}. ${section.title}`,exact:true}).click();
    await page.getByRole('button',{name:home.listing.address,exact:true}).waitFor();
    await page.locator('.tabs').getByRole('button',{name:'2. Interested',exact:true}).click();
    await page.getByRole('button',{name:homes[1].listing.address,exact:true}).click();
    await page.getByRole('dialog',{name:/Apartment #2/}).waitFor();
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    ratingGate!.release();ratingGate=undefined;
   }
   if(scenario==='rating-offline'){
    const recovery=page.getByRole('complementary',{name:'Decision saves'});
    await recovery.getByRole('button',{name:'Retry Save',exact:true}).waitFor();
    assert.equal(home.stage,'Interested');assert.deepEqual(operations,[]);
    assert.match(await recovery.innerText(),/Rating retained for retry: 3.7/);
    assert.match(await recovery.innerText(),/More room for my workspace/);
    ratingOffline=false;await recovery.getByRole('button',{name:'Retry Save',exact:true}).click();
   }
   await page.waitForFunction(()=>!document.querySelector('.decision-save-count'));
   assert.equal(home.stage,target,`${scenario}: intended stage saved`);
   assert.equal(home.notes,note);
   const needsRating=!['blank','unchanged'].includes(scenario);
   assert.deepEqual(operations,needsRating?['rating',`stage:${target}`]:[`stage:${target}`]);
   assert.equal(ratings.get(home.id)?.length??0,scenario==='blank'?0:1);
   if(scenario==='lost-reply'||scenario==='rating-offline')assert.equal(new Set(submissionIds).size,1,'Retry uses the same feedback submission ID');
  }
 }
 assert.deepEqual(errors.sort(),[...Array.from({length:revisionConflicts},()=> 'Failed to load resource: the server responded with a status of 409 (Conflict)'),...Array.from({length:ratingFailures},()=> 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)')].sort(),'Only deliberately simulated failures may appear; no React rendering errors');
 console.log('Desktop/mobile: instant rating decisions while requests are held; other homes remain usable; retained feedback after failure; idempotent retries; validation and unchanged ratings.');
}catch(error){
 console.error(error);
 console.error(await browser.contexts()[0]?.pages()[0]?.locator('body').innerText());
 process.exitCode=1;
}finally{
 ratingGate?.release();
 await browser.close();
}
