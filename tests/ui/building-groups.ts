// Entire browser session is served from fixtures; no listing, AI or address requests.
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {build} from 'vite';
import {Store} from '../../server/db.ts';
import {buildingDesk,updateBuildingDesk} from '../../server/building-desk.ts';
import {listingSchema,type Home} from '../../src/domain.ts';

const store=new Store(':memory:');
for(let id=1;id<=6;id++){
 store.ingest(listingSchema.parse({source:'fixture',sourceId:String(id),url:`https://example.test/${id}`,title:'Saved apartment',address:id===2?'99 Other Street, Vancouver':id===6?'1889 Alberni St':'1889 Alberni Street, Vancouver',unit:String(1100+id),rent:id===1?3300:2400+id*100,beds:1,photos:[]}));
 store.db.prepare('UPDATE homes SET stage=?,notes=?,revisit_later=? WHERE id=?').run(id===4?'Not Interested':id===6?'Unreviewed':'Interested',id===4?'Rejected the layout; building is still promising.':`Unit ${id} note`,id===5?1:0,id);
}
store.set('reviewWorkflow',{mode:'quick-first'});for(let id=1;id<=5;id++)store.set(`fullReview:${id}`,{status:'complete',detail:'Complete fixture',updatedAt:'2026-11-20'});
store.db.prepare('INSERT INTO rating_feedback(request_id,home_id,at,user_score,reason,listing_json,score_json,criteria_json) VALUES (?,?,?,?,?,?,?,?)').run('fixture-rating',4,'2026-11-20',2.5,'Bedroom too small','{}','{}','{}');
const homes=():Home[]=>store.homes().map(h=>({...h,deskExclusion:undefined,reviewMode:'full',fullReview:{status:'complete',detail:'Completed',updatedAt:'2026-11-20T12:00:00Z'},score:{...h.score,value:h.id===1?4.5:h.id===2?4:3.5,eligible:true},quickRank:undefined}));
const bundle=await build({configFile:false,logLevel:'error',build:{write:false}});assert.ok('output' in bundle);
const assets=new Map(bundle.output.map(item=>[item.fileName,item.type==='chunk'?item.code:item.source]));
const browser=await chromium.launch({headless:true});
let failSave=false;
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const origin='https://buildings-fixture.test';
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());assert.equal(url.origin,origin,'No external traffic');
  if(!url.pathname.startsWith('/api/')){const path=url.pathname==='/'?'index.html':url.pathname.slice(1),body=assets.get(path);return route.fulfill({status:body===undefined?404:200,contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:typeof body==='string'?body:body?Buffer.from(body):''});}
  let result:unknown;const id=Number(url.pathname.split('/')[3]);
  try{
   if(url.pathname==='/api/state')result={homes:homes(),buildings:buildingDesk(store),csrf:'fixture',demo:true,sources:[],events:[],plans:[],criteria:store.criteria,criteriaRevision:'1',schedule:{enabled:false},aiMode:'chatgpt'};
   else if(url.pathname==='/api/buildings'){
    if(failSave)return route.fulfill({status:500,json:{error:'Fixture save failed; your draft is retained.'}});
    result=updateBuildingDesk(store,route.request().postDataJSON());
   }else if(/\/homes\/\d+$/.test(url.pathname))result=homes().find(h=>h.id===id);
   else if(url.pathname.endsWith('/ratings'))result={ratings:[]};
   else if(url.pathname.endsWith('/map'))result={status:'unavailable',label:''};
   else if(url.pathname.endsWith('/context'))result={research:null,stale:false};
   else if(url.pathname.endsWith('/duplicates'))result={candidates:[],history:[]};
   else throw Error('Unexpected route '+url.pathname);
   return route.fulfill({json:result});
  }catch(e){return route.fulfill({status:409,json:{error:(e as Error).message}});}
 });
 const interested=()=>page.locator('.tabs').getByRole('button',{name:'2. Interested',exact:true});
 const active=()=>page.getByRole('region',{name:'Interested apartments to review'}),later=()=>page.getByRole('region',{name:'Revisit Later',exact:true});
 let readyTab=false;const group=()=>readyTab?page.locator('.building-group'):later().locator('.building-group');
 const ids=async()=>active().locator('.home-id').allTextContents();
 await page.goto(origin);await interested().click();await group().waitFor();
 assert.deepEqual((await ids()).map(s=>Number(s.split('#')[1])),[2]);assert.equal(await later().locator('.home-card').count(),1);assert.equal(await active().locator('.building-group').count(),0,'Ungrouped units stay plain cards');
 assert.equal((await group().locator('.home-id').innerText()).trim(),'DEMO #1');
 const disclosure=()=>group().getByRole('button',{name:/^(Show \d+ other units?|Hide other units)$/});
 assert.equal(await disclosure().getAttribute('aria-expanded'),'false');
 for(const sort of ['rent','recent']){await page.getByRole('combobox',{name:'Sort apartments',exact:true}).selectOption(sort);assert.equal((await group().locator('.home-id').innerText()).trim(),'DEMO #1','Highest score represents the building regardless of sort');}
 await page.getByRole('combobox',{name:'Sort apartments',exact:true}).selectOption('score');
 await disclosure().focus();await page.keyboard.press('Enter');assert.equal(await disclosure().getAttribute('aria-expanded'),'true');assert.equal(await group().locator('.home-card').count(),3);
 const poll=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/state');await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await poll;
 assert.equal(await group().locator('.home-card').count(),3,'Background refresh retains expansion');
 await disclosure().click();assert.equal(await group().locator('.home-card').count(),1);
 await page.getByRole('textbox',{name:'Search apartments',exact:true}).fill('3');assert.equal(await page.locator('.building-group').count(),0,'A single search match is a normal card');assert.equal((await later().locator('.home-id').innerText()).trim(),'DEMO #3','Lower scoring search match is visible');
 await page.getByRole('textbox',{name:'Search apartments',exact:true}).fill('');await group().waitFor();
 await disclosure().click();assert.equal(await group().locator('.home-card').count(),3);
 assert.equal(store.home(1)?.revisitLater,false);assert.equal(store.home(5)?.revisitLater,true);
 await group().getByRole('button',{name:'Building notes & other units',exact:true}).click();
 await group().getByText('Rejected the layout; building is still promising.',{exact:false}).waitFor();
 assert.match(await group().innerText(),/Your score 2.5/);assert.match(await group().innerText(),/Bedroom too small/);
 await group().getByRole('button',{name:'Add building notes',exact:true}).click();
 await group().getByLabel('Shared building notes').fill('Ask about concierge hours. <b>Plain text</b>');
 failSave=true;await group().getByRole('button',{name:'Save building notes',exact:true}).click();
 await group().getByRole('alert').waitFor();assert.equal(await group().getByLabel('Shared building notes').inputValue(),'Ask about concierge hours. <b>Plain text</b>');
 failSave=false;await group().getByRole('button',{name:'Save building notes',exact:true}).click();await group().getByText('Building notes saved.',{exact:true}).waitFor();
 assert.match(await later().innerText(),/Ask about concierge hours/);assert.equal(await group().locator('.building-note b').count(),1,'External text is escaped');
 await page.reload();await interested().click();await group().getByText('Ask about concierge hours.',{exact:false}).waitFor();
 await group().getByRole('button',{name:'Building notes & other units',exact:true}).click();
 // A concurrent note save cannot overwrite this draft.
 await group().getByRole('button',{name:'Edit building notes',exact:true}).click();await group().getByLabel('Shared building notes').fill('My unsaved draft');
 let index=buildingDesk(store),key=index.groups.find(g=>g.homeIds.includes(1))!.key;
 updateBuildingDesk(store,{action:'notes',revision:index.revision,key,notes:'Saved in another session'});
 await group().getByRole('button',{name:'Save building notes',exact:true}).click();await group().getByRole('alert').waitFor();assert.equal(await group().getByLabel('Shared building notes').inputValue(),'My unsaved draft');
 await page.waitForResponse(r=>new URL(r.url()).pathname==='/api/state').catch(()=>{});
 await group().getByRole('button',{name:'Reload saved notes',exact:true}).click();assert.equal(await group().getByLabel('Shared building notes').inputValue(),'Saved in another session');
 await group().getByRole('button',{name:'Cancel edit',exact:true}).click();
 // Unreviewed/unfinished apartments cannot be grouped early.
 assert.equal(await group().getByRole('button',{name:'Same building',exact:true}).isDisabled(),true);
 store.db.prepare("UPDATE homes SET stage='Interested' WHERE id=6").run();store.set('fullReview:6',{status:'complete',detail:'Complete fixture',updatedAt:'2026-11-20'});
 const refreshed=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/state');await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await refreshed;
 await group().getByRole('button',{name:'Same building',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.building-suggestion'));
 assert.equal(store.home(6)?.stage,'Interested');assert.equal(store.resolveHomeId(6),6);assert.equal(await active().locator('.home-card').count(),1);assert.equal(await later().locator('.home-card').count(),1);await group().getByRole('button',{name:'Show 3 other units',exact:true}).click();assert.equal(await later().locator('.home-card').count(),4);
 await page.getByRole('checkbox',{name:'Group by building',exact:true}).uncheck();assert.deepEqual((await ids()).map(s=>Number(s.split('#')[1])),[1,2,6,3]);
 await page.reload();await interested().click();assert.equal(await page.getByRole('checkbox',{name:'Group by building',exact:true}).isChecked(),false);
 await page.getByRole('checkbox',{name:'Group by building',exact:true}).check();
 // Search stays scoped to the matching card, with sibling review context accessible.
 await page.getByRole('textbox',{name:'Search apartments',exact:true}).fill('#1');
 // Search uses the numeric ID as before, without a leading hash.
 await page.getByRole('textbox',{name:'Search apartments',exact:true}).fill('1');
 await page.getByRole('textbox',{name:'Search apartments',exact:true}).fill('99 Other');assert.equal(await active().locator('.home-card').count(),1);
 await page.getByRole('textbox',{name:'Search apartments',exact:true}).fill('');
 // A later stage places the entire completed group there; original unit decisions persist.
 store.db.prepare("UPDATE homes SET stage='Ready to Apply' WHERE id=3").run();
 const moved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/state');await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await moved;
 await page.locator('.tabs').getByRole('button',{name:'4. Ready to Apply',exact:true}).click();readyTab=true;await group().waitFor();assert.equal(await group().locator('.home-card').count(),1);assert.equal(store.home(1)?.stage,'Interested');
 assert.match(await group().innerText(),/Your decision: Interested/);
 mkdirSync('data/ui',{recursive:true});await page.screenshot({path:'data/ui/building-groups-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await group().locator('.home-card').count(),1);await page.screenshot({path:'data/ui/building-collapsed-mobile.png',fullPage:true});await group().getByRole('button',{name:'Show 3 other units',exact:true}).click();assert.equal(await group().locator('.home-card').count(),4);await group().getByRole('button',{name:'Collapse building group',exact:true}).click();assert.equal(await group().locator('.home-card').count(),1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await group().getByRole('button',{name:'Building notes & other units',exact:true}).click();await page.screenshot({path:'data/ui/building-groups-mobile.png',fullPage:true});
 await group().getByRole('button',{name:'#4 · Suite 1104',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Building notes & other units',exact:true}).click();assert.match(await dialog.locator('.building-context').innerText(),/Rejected the layout/);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'data/ui/building-context-detail-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);assert.equal(store.home(4)?.notes,'Rejected the layout; building is still promising.');
 console.log('Building UI passed: default collapse, highest-score representative across sorts, search visibility, keyboard expand/collapse, refresh stability, singleton cards, adjacency, existing sort toggle, deferred groups, rejected-unit context, ratings, notes, reload, failed saves, conflict protection, confirmation, search, detail and mobile layout.');
}finally{await browser.close();store.close();}
