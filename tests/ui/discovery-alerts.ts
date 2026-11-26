// Built UI served entirely from fixtures; no listing or model traffic.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {Store} from '../../server/db.ts';
import {raiseDiscoveryAlert,discoveryAlerts,dismissDiscoveryAlert} from '../../server/discovery-alerts.ts';

const store=new Store(':memory:');
raiseDiscoveryAlert(store,'craigslist','Craigslist scan results have slowed. The last three checks produced no new qualifying apartments. Checks now wait 120 minutes. Incomplete coverage or access problems can also reduce results.',new Date());
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const origin='https://scan-alert-fixture.test';let failDismiss=true;
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());assert.equal(u.origin,origin,'No external traffic');
  if(!u.pathname.startsWith('/api/')){
   const path=u.pathname==='/'?'index.html':u.pathname.slice(1);
   return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:readFileSync('dist/'+path)});
  }
  if(u.pathname==='/api/state')return route.fulfill({json:{homes:[],csrf:'fixture-token',demo:true,sources:[],events:[],plans:[],criteria:store.criteria,criteriaRevision:'1',schedule:{enabled:false},aiMode:'chatgpt',discoveryAlerts:discoveryAlerts(store)}});
  if(u.pathname==='/api/discovery-alerts/dismiss'){
   assert.equal(route.request().headers()['x-af-token'],'fixture-token');
   if(failDismiss)return route.fulfill({status:503,json:{error:'Dismissal failed. Try again.'}});
   return route.fulfill({json:dismissDiscoveryAlert(store,route.request().postDataJSON().id)});
  }
  throw Error('Unexpected route '+u.pathname);
 });
 await page.goto(origin);const region=page.getByRole('region',{name:'Scan alerts'});await region.waitFor();
 assert.match(await region.innerText(),/Craigslist scan results have slowed/);
 await region.getByRole('button',{name:'Dismiss craigslist scan alert'}).click();
 await page.getByRole('alert').filter({hasText:'Dismissal failed'}).waitFor();assert.ok(await region.isVisible());
 mkdirSync('data/ui-checks',{recursive:true});await page.screenshot({path:'data/ui-checks/discovery-alert-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await region.evaluate(el=>el.scrollWidth<=el.clientWidth),true,'Alert fits phone width');
 await page.screenshot({path:'data/ui-checks/discovery-alert-phone.png'});
 failDismiss=false;await region.getByRole('button',{name:'Dismiss craigslist scan alert'}).click();await region.waitFor({state:'detached'});
 await page.reload();await page.getByRole('heading',{name:'Sorting Desk',exact:true}).waitFor();
 assert.equal(await region.count(),0,'Dismissal survives refresh');assert.deepEqual(errors,[]);
 console.log('Desktop/phone alert, failed save, authenticated dismissal and persisted refresh passed.');
}finally{await browser.close();store.close();}
