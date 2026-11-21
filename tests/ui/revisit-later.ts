import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {build} from 'vite';
import {criteriaSchema,listingSchema,type Home} from '../../src/domain.ts';

const fixture=(id:number):Home=>({id,listing:listingSchema.parse({source:'fixture',sourceId:String(id),url:`https://example.test/${id}`,title:'Saved apartment',address:`${id} Example Street`,rent:2400,beds:1,photos:[]}),stage:'Interested',revisitLater:false,tagLongTermLease:false,tagUnfurnished:false,reviewMode:'full',fullReview:{status:'complete',detail:'Full scoring complete',updatedAt:'2026-11-20T12:00:00Z'},score:{value:3.5,low:3.5,high:3.5,base:3.5,adjustments:[],flags:[],reasons:[],eligible:true,uncertain:false,view:'Reviewed'},notes:'Saved note',followUp:'',viewing:'',rescued:false,revision:1,firstSeen:'2026-11-20',updatedAt:'2026-11-20',possibleDuplicates:[],postings:[]});
const homes=[fixture(1),fixture(2)],operations:string[]=[],ratings=new Map<number,any[]>();
let release!:()=>void,hold=true;const gate=new Promise<void>(r=>release=r);
const bundle=await build({configFile:false,logLevel:'error',build:{write:false}});assert.ok('output' in bundle);
const assets=new Map(bundle.output.map(item=>[item.fileName,item.type==='chunk'?item.code:item.source]));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const origin='https://revisit-fixture.test';
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==origin)return route.fulfill({body:'Offline external content',contentType:'text/html'});
  if(!url.pathname.startsWith('/api/')){const path=url.pathname==='/'?'index.html':url.pathname.slice(1),body=assets.get(path);return route.fulfill({status:body===undefined?404:200,contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:typeof body==='string'?body:body?Buffer.from(body):''});}
  const id=Number(url.pathname.split('/')[3]),home=homes.find(h=>h.id===id);let result:unknown;
  if(url.pathname==='/api/state')result={homes,csrf:'fixture',demo:true,sources:[],events:[],plans:[],criteria:criteriaSchema.parse({}),criteriaRevision:'1',schedule:{enabled:false},aiMode:'chatgpt'};
  else if(/\/homes\/\d+$/.test(url.pathname)){
   if(route.request().method()==='PUT'){
    if(hold)await gate;const input=route.request().postDataJSON();assert.equal(input.revision,home!.revision);
    Object.assign(home!,input,{revision:home!.revision+1,revisitLater:['Interested','Serious Candidates'].includes(input.stage)&&input.stage===home!.stage?(input.revisitLater??home!.revisitLater):false});operations.push(input.revisitLater===undefined?input.stage:input.revisitLater?'Revisit Later':'Review Now');
   }result=home;
  }else if(url.pathname.endsWith('/ratings')){
   if(route.request().method()==='POST'){const input=route.request().postDataJSON();const rating={id:1,homeId:id,userScore:input.score,reason:input.reason,appScore:3.5,at:new Date().toISOString(),status:'reviewed',review:null,error:'',origin:'app',canUndo:false};ratings.set(id,[rating]);operations.push('rating');result={rating};}else result={ratings:ratings.get(id)??[]};
  }else if(url.pathname.endsWith('/map'))result={status:'unavailable',label:''};
  else if(url.pathname.endsWith('/context'))result={research:null,stale:false};
  else if(url.pathname.endsWith('/duplicates'))result={candidates:[],history:[]};
  else throw Error('Unexpected fixture request: '+url.pathname);
  return route.fulfill({json:result});
 });
 const interested=()=>page.locator('.tabs').getByRole('button',{name:'2. Interested',exact:true});
 const active=()=>page.getByRole('region',{name:'Interested apartments to review'}),later=()=>page.getByRole('region',{name:'Revisit Later',exact:true});
 const card=(id:number)=>page.locator('.home-card').filter({has:page.getByRole('button',{name:`${id} Example Street`,exact:true})});
 await page.goto(origin);await interested().click();
 await card(1).getByRole('button',{name:'Revisit Later',exact:true}).click();
 await later().getByRole('button',{name:'1 Example Street',exact:true}).waitFor();assert.equal(await active().locator('.home-card').count(),1);assert.equal(homes[0].revisitLater,false,'UI moves before the request completes');
 hold=false;await Promise.all([page.waitForResponse(r=>r.url().endsWith('/homes/1')&&r.request().method()==='PUT'),Promise.resolve().then(()=>release())]);
 await page.reload();await interested().click();await later().getByRole('button',{name:'1 Example Street',exact:true}).waitFor();
 homes.push(fixture(3));await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await active().getByRole('button',{name:'3 Example Street',exact:true}).waitFor();assert.equal(await later().locator('.home-card').count(),1);
 const activeBox=await active().boundingBox(),laterBox=await later().boundingBox();assert.ok(laterBox!.y>activeBox!.y+activeBox!.height);
 mkdirSync('data/ui',{recursive:true});await page.screenshot({path:'data/ui/revisit-later-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await later().scrollIntoViewIfNeeded();await page.screenshot({path:'data/ui/revisit-later-mobile.png',fullPage:true});
 await card(1).getByRole('button',{name:'1 Example Street',exact:true}).click();const dialog=page.getByRole('dialog');
 await dialog.getByLabel(/^Your notes/).fill('Keep for another look');await dialog.getByLabel('Your Score',{exact:true}).fill('3.6');await dialog.getByLabel('Reason for Your Score',{exact:true}).fill('Interested but need another look');
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/homes/1')&&r.request().method()==='PUT'),dialog.getByRole('button',{name:'Review Now',exact:true}).click()]);await active().getByRole('button',{name:'1 Example Street',exact:true}).waitFor();
 assert.deepEqual(operations.slice(-2),['rating','Review Now']);assert.equal(homes[0].notes,'Keep for another look');
 await card(1).getByRole('button',{name:'Revisit Later',exact:true}).click();await later().getByRole('button',{name:'1 Example Street',exact:true}).waitFor();
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/homes/1')&&r.request().method()==='PUT'),card(1).getByRole('button',{name:'Serious Candidates',exact:true}).click()]);assert.equal(homes[0].stage,'Serious Candidates');assert.equal(homes[0].revisitLater,false);
 await card(2).getByRole('button',{name:'Revisit Later',exact:true}).click();await later().getByRole('button',{name:'2 Example Street',exact:true}).waitFor();
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/homes/2')&&r.request().method()==='PUT'),card(2).getByRole('button',{name:'Not Interested',exact:true}).click()]);assert.equal(homes[1].stage,'Not Interested');assert.equal(homes[1].revisitLater,false);

 await page.locator('.tabs').getByRole('button',{name:'3. Serious Candidates',exact:true}).click();
 const pursue=()=>page.getByRole('region',{name:'Serious Candidates to pursue'});
 await card(1).getByRole('button',{name:'1 Example Street',exact:true}).click();
 await dialog.getByRole('checkbox',{name:'Long Term Lease',exact:true}).check();await dialog.getByRole('checkbox',{name:'Unfurnished',exact:true}).check();
 await dialog.getByLabel(/^Your notes/).fill('Still serious, revisit next month');
 await dialog.getByRole('group',{name:'Your Tags'}).scrollIntoViewIfNeeded();await page.screenshot({path:'data/ui/serious-tags-detail-mobile.png'});
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/homes/1')&&r.request().method()==='PUT'),dialog.getByRole('button',{name:'Revisit Later',exact:true}).click()]);
 await later().getByRole('button',{name:'1 Example Street',exact:true}).waitFor();assert.equal(await pursue().locator('.home-card').count(),0);
 assert.equal(homes[0].tagLongTermLease,true);assert.equal(homes[0].tagUnfurnished,true);assert.equal(homes[0].notes,'Still serious, revisit next month');
 await page.reload();await page.locator('.tabs').getByRole('button',{name:'3. Serious Candidates',exact:true}).click();await later().getByText('Long Term Lease',{exact:true}).waitFor();await later().getByText('Unfurnished',{exact:true}).waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'data/ui/serious-revisit-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:'data/ui/serious-revisit-desktop.png',fullPage:true});
 await card(1).getByRole('button',{name:'1 Example Street',exact:true}).click();assert.equal(await dialog.getByRole('checkbox',{name:'Long Term Lease',exact:true}).isChecked(),true);
 await dialog.getByRole('checkbox',{name:'Long Term Lease',exact:true}).uncheck();
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/homes/1')&&r.request().method()==='PUT'),dialog.getByRole('button',{name:'Review Now',exact:true}).click()]);
 await pursue().getByRole('button',{name:'1 Example Street',exact:true}).waitFor();assert.equal(await card(1).getByText('Long Term Lease',{exact:true}).count(),0);assert.equal(await card(1).getByText('Unfurnished',{exact:true}).count(),1);
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/homes/1')&&r.request().method()==='PUT'),card(1).getByRole('button',{name:'Ready to Apply',exact:true}).click()]);assert.equal(homes[0].stage,'Ready to Apply');assert.equal(homes[0].revisitLater,false);assert.equal(homes[0].tagUnfurnished,true);
 assert.deepEqual(errors,[]);console.log('Revisit Later: grouping, instant save, reload, new arrivals, mobile layout, ratings, promotion and rejection passed offline.');
}finally{await browser.close();}
