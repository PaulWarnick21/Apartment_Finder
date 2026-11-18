// Offline browser regression: npx tsx tests/ui/detail-fields.ts
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build} from 'vite';
import {criteriaSchema,listingSchema,type Home} from '../../src/domain.ts';

function fixture(id:number):Home{
 return {id,listing:listingSchema.parse({source:'fixture',sourceId:String(id),url:`https://example.test/${id}`,title:`Fixture apartment ${id}`,address:`${id} Example Street`,rent:2400,beds:1,conflicts:['Fixture conflicting lease terms'],photos:[{id:'one',url:'https://example.test/photo.jpg',local:'fixture.jpg'}]}),score:{value:4,low:3,high:5,base:4,adjustments:[],flags:['Parking unsure'],reasons:[],eligible:true,uncertain:true,view:'Unverified'},stage:'Unreviewed',notes:'Saved note',followUp:'',viewing:'',revision:1,rescued:false,updatedAt:'2026-11-18T13:00:00Z',firstSeen:'2026-11-18T13:00:00Z',possibleDuplicates:[],postings:[{source:'fixture',url:`https://example.test/${id}`} ]};
}
const homes=[fixture(1),fixture(2)];
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
 const origin='http://apartment-fixture.test';
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
  else if(/\/homes\/\d+$/.test(url.pathname))result=home;
  else if(url.pathname.endsWith('/ratings'))result={ratings:[]};
  else if(url.pathname.endsWith('/map'))result={status:'ready',label:home?.listing.address,lat:49.28,lon:-123.12};
  else if(url.pathname.endsWith('/context'))result={research:null,stale:false,airportDirections:'https://example.test/transit',transitSource:'https://example.test/transit'};
  else if(url.pathname.endsWith('/duplicates'))result={candidates:[],history:[]};
  else throw new Error(`Unexpected API request: ${route.request().method()} ${url.pathname}`);
  return route.fulfill({json:result});
 });
 await page.goto(origin);
 await page.locator('.tabs').getByRole('button',{name:'Interested',exact:true}).click();
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
  await page.locator('.tabs').getByRole('button',{name:stage,exact:true}).click();
  const card=page.locator('.home-card').filter({has:page.getByRole('button',{name:homes[0].listing.address,exact:true})});
  await card.getByRole('button',{name:next,exact:true}).waitFor();
  assert.deepEqual(await card.locator('.interest-actions button').allTextContents(),[next,'Not Interested']);
  assert.equal(await card.locator('.rent .furnishing-badge').innerText(),'Unfurnished');
  await card.getByRole('button',{name:homes[0].listing.address,exact:true}).click();
  const dialog=page.getByRole('dialog');
  const options=await dialog.getByLabel('Stage',{exact:true}).locator('option').allTextContents();
  for(const candidate of ['Unreviewed','Interested','Serious Candidates','Ready to Apply'])if(candidate!==stage&&candidate!==next)assert.ok(!options.includes(candidate),`${stage} cannot skip to ${candidate}`);
  await dialog.getByRole('button',{name:'Close dialog',exact:true}).click();
 }
 assert.deepEqual(errors,[],'React must update the detail view without duplicate-key or rendering errors');
 console.log('Detail fields stay unique through desktop/mobile refreshes and apartment switches; drafts retained.');
}catch(error){
 console.error(error);
 process.exitCode=1;
}finally{
 await browser.close();
}
