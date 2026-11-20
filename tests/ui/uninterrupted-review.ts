// Offline browser regression: node --import tsx tests/ui/uninterrupted-review.ts
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build} from 'vite';
import {criteriaSchema,listingSchema,type Home} from '../../src/domain.ts';
import {cardSummary} from '../../server/desk-state.ts';

function home(id:number):Home{
 return {id,listing:listingSchema.parse({source:'fixture',sourceId:String(id),url:`https://example.test/${id}`,title:`Fixture ${id}`,address:`${id} Example Street`,rent:2400,beds:1,photos:[{id:'one',url:'https://example.test/one',local:'one.jpg'},{id:'two',url:'https://example.test/two',local:'two.jpg'}]}),stage:'Unreviewed',reviewMode:'quick',quickRank:{grade:'A',rankValue:1000-id,eligible:true,reasons:[],flags:[]},score:{value:3,low:3,high:3,base:3,adjustments:[],flags:[],reasons:[],eligible:true,uncertain:false,view:'Unknown'},notes:'Saved note',followUp:'',viewing:'',rescued:false,revision:1,firstSeen:'2026-11-18',updatedAt:'2026-11-18',possibleDuplicates:[],postings:[]};
}
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};}
const bundle=await build({configFile:false,logLevel:'error',build:{write:false}});assert.ok('output' in bundle);
const assets=new Map(bundle.output.map(item=>[item.fileName,item.type==='chunk'?item.code:item.source]));
const browser=await chromium.launch({headless:true,timeout:15000});
try{
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport});page.setDefaultTimeout(10000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const homes=Array.from({length:500},(_,index)=>home(index+1));
  homes[499].deskExclusion='Photos not yet collected';
  const writes=new Map<number,number>();let stateRequests=0,holdState:ReturnType<typeof gate>|undefined,holdDetail:ReturnType<typeof gate>|undefined,holdSave:ReturnType<typeof gate>|undefined;
  const origin='http://apartment-fixture.test';
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());assert.equal(url.origin,origin,'No external source or model requests');
   if(url.pathname.startsWith('/media/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="green"/></svg>'});
   if(!url.pathname.startsWith('/api/')){
    const path=url.pathname==='/'?'index.html':url.pathname.slice(1),body=assets.get(path);
    return route.fulfill({status:body===undefined?404:200,contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:typeof body==='string'?body:body?Buffer.from(body):''});
   }
   if(url.pathname==='/api/state'){
    stateRequests++;
    const snapshot=JSON.stringify({homes:homes.map(cardSummary),csrf:'fixture',demo:true,sources:[],events:[],plans:[],criteria:criteriaSchema.parse({}),criteriaRevision:'1',providerReady:false,schedule:{enabled:false,reason:'Offline'}});
    if(holdState)await holdState.promise;
    return route.fulfill({contentType:'application/json',body:snapshot});
   }
   const id=Number(url.pathname.split('/')[3]),current=homes.find(h=>h.id===id)!;
   assert.match(url.pathname,/^\/api\/homes\/\d+$/);
   if(route.request().method()==='GET'){
    const result=structuredClone(current);if(id===1&&holdDetail)await holdDetail.promise;
    return route.fulfill({json:result}).catch(()=>{}); // Closing detail deliberately aborts this read.
   }
   assert.equal(route.request().method(),'PUT');writes.set(id,(writes.get(id)??0)+1);
   if([5,6].includes(id)&&writes.get(id)===1)return route.fulfill({status:503,json:{error:'Temporary connection failure'}});
   if([5,6].includes(id)&&writes.get(id)===2)return route.fulfill({status:503,json:{error:'Temporary connection failure'}});
   if(id===3&&holdSave)await holdSave.promise;
   if(id===4&&writes.get(id)===1){current.revision++;current.notes='New note from another device';return route.fulfill({status:409,json:{error:'This apartment changed. Refresh before saving.'}});}
   const input=route.request().postDataJSON();assert.equal(input.revision,current.revision);
   Object.assign(current,input,{revision:current.revision+1});
   if(id===2)return route.fulfill({status:502,contentType:'text/html',body:'<html>Interrupted acknowledgement</html>'});
   return route.fulfill({json:current});
  });
  await page.goto(origin);await page.locator('.home-card').first().waitFor();
  const card=(id:number)=>page.locator('.home-card').filter({has:page.getByRole('button',{name:`${id} Example Street`,exact:true})});
  // Opening a slow detail immediately offers the existing quick card's decisions.
  holdDetail=gate();await card(1).getByRole('button',{name:'1 Example Street',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Interested',exact:true}).isEnabled(),true);
  await dialog.getByRole('button',{name:'Close dialog'}).click();
  assert.equal(await card(2).getByRole('button',{name:'Interested',exact:true}).isEnabled(),true);
  await card(2).getByRole('button',{name:'2 Example Street',exact:true}).click();
  holdDetail.release();holdDetail=undefined;
  assert.match(await dialog.getAttribute('aria-label')??'',/Apartment #2/);
  await dialog.getByRole('button',{name:'Close dialog'}).click();
  // Keep a stale scan refresh in flight throughout successive independent decisions.
  const incoming=home(501);incoming.quickRank!.rankValue=2000;homes.push(incoming);
  homes[499].deskExclusion=undefined;
  holdState=gate();const polling=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/state');
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await polling;
  await card(2).getByRole('button',{name:'Interested',exact:true}).click();
  holdSave=gate();await card(3).getByRole('button',{name:'Not Interested',exact:true}).click();
  await card(4).getByRole('button',{name:'Not Interested',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#decision-save-errors'));
  const refreshed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/state');holdState.release();holdState=undefined;await refreshed;
  await page.getByRole('button',{name:'Show new apartments',exact:true}).waitFor();
  for(const id of [2,3,4])assert.equal(await card(id).count(),0,'Stale refresh must not resurrect a decision');
  assert.equal(await card(501).count(),0,'New high-ranked inventory must wait for the user');
  assert.equal(await card(500).count(),0,'Existing records newly admitted by photo collection must also wait');
  assert.equal(await card(5).getByRole('button',{name:'Interested',exact:true}).isEnabled(),true);
  assert.equal(await page.locator('.card-title').first().innerText(),'1 Example Street');
  holdSave.release();holdSave=undefined;
  await page.waitForFunction(()=>!document.querySelector('.decision-save-count'));
  assert.equal(writes.get(2),1,'Lost acknowledgement must not write twice');
  assert.equal(writes.get(3),1);assert.equal(writes.get(4),2);assert.equal(homes[3].notes,'New note from another device');
  assert.equal(await page.locator('#decision-save-errors').count(),0);
  // Screenshot regression: an unresolved save returns to Unreviewed with usable
  // recovery controls on that card, never "pending" above two grey buttons.
  await card(5).getByRole('button',{name:'Not Interested',exact:true}).click();
  await card(5).getByRole('button',{name:'Retry Save',exact:true}).waitFor();
  assert.match(await card(5).innerText(),/Not Interested wasn’t confirmed/);
  assert.equal(await card(5).getByRole('button',{name:'Interested',exact:true}).count(),0);
  assert.equal(await card(5).locator('button:disabled').count(),1,'Only the first-photo back arrow is disabled');
  assert.equal(await card(6).getByRole('button',{name:'Interested',exact:true}).isEnabled(),true);
  await card(5).getByRole('button',{name:'5 Example Street',exact:true}).click();
  await dialog.getByRole('button',{name:'Retry Save',exact:true}).waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Interested',exact:true}).count(),0);
  await dialog.getByRole('button',{name:'Retry Save',exact:true}).click();
  assert.equal(await dialog.count(),0,'Retry returns to the desk so review can continue immediately');
  await page.waitForFunction(()=>!document.querySelector('.decision-save-count'));
  assert.equal(writes.get(5),3);assert.equal(homes[4].stage,'Not Interested');
  await card(6).getByRole('button',{name:'Not Interested',exact:true}).click();
  await card(6).getByRole('button',{name:'Keep Current State',exact:true}).click();
  assert.equal(await card(6).getByRole('button',{name:'Interested',exact:true}).isEnabled(),true);
  assert.equal(await card(6).getByRole('button',{name:'Not Interested',exact:true}).isEnabled(),true);
  assert.equal(writes.get(6),2,'Keeping the current state does not issue a new write');
  await card(1).getByRole('button',{name:'Next photo of apartment 1'}).click();
  assert.match(await card(1).locator('.card-photo-count').innerText(),/2 \/ 2/);
  const nextPoll=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/state');
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await nextPoll;
  assert.match(await card(1).locator('.card-photo-count').innerText(),/2 \/ 2/);
  await page.getByRole('button',{name:'Show new apartments',exact:true}).click();
  await card(501).waitFor();assert.equal(await page.locator('.card-title').first().innerText(),'501 Example Street');
  const beforeActivity=stateRequests;
  for(let i=0;i<4;i++){await page.evaluate(()=>document.dispatchEvent(new Event('scroll')));await page.waitForTimeout(1500);}
  assert.equal(stateRequests,beforeActivity,'Routine whole-desk polling waits while the user is actively reviewing');
  await page.waitForResponse(response=>new URL(response.url()).pathname==='/api/state',{timeout:12000});
  assert.ok(stateRequests>beforeActivity,'Routine polling resumes after review activity stops');
  assert.deepEqual(errors,[]);await page.close();
  console.log(`${viewport.width}px: 500-card review remains interactive during delayed detail, scan refresh, saves, malformed acknowledgement and revision conflict.`);
 }
}finally{await browser.close();}
