// Offline browser regression: node --import tsx tests/ui/responsive-actions.ts
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {build} from 'vite';
import {Store} from '../../server/db.ts';
import {listingSchema,type Home} from '../../src/domain.ts';
import {raiseDiscoveryAlert,resolveDiscoveryAlert,discoveryAlerts,dismissDiscoveryAlert} from '../../server/discovery-alerts.ts';

function gate<T>(){let release!:(value:T)=>void;const promise=new Promise<T>(resolve=>{release=resolve;});return {promise,release};}
const bundle=await build({configFile:false,logLevel:'error',build:{write:false}});assert.ok('output' in bundle);
const assets=new Map(bundle.output.map(item=>[item.fileName,item.type==='chunk'?item.code:item.source]));
const home:Home={id:1,listing:listingSchema.parse({source:'fixture',sourceId:'1',url:'https://example.test/1',title:'Fixture apartment',address:'1 Example Street',rent:2400,beds:1}),stage:'Unreviewed',reviewMode:'quick',quickRank:{grade:'A',rankValue:1000,eligible:true,reasons:[],flags:[]},score:{value:3,low:3,high:3,base:3,adjustments:[],flags:[],reasons:[],eligible:true,uncertain:false,view:'Unknown'},notes:'',followUp:'',viewing:'',rescued:false,revision:1,firstSeen:'2026-11-23',updatedAt:'2026-11-23',possibleDuplicates:[],postings:[]};
const browser=await chromium.launch({headless:true});
try{
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const store=new Store(':memory:'),page=await browser.newPage({viewport});page.setDefaultTimeout(5000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  for(const source of ['craigslist','zumper','kijiji'])raiseDiscoveryAlert(store,source,`${source} scan results have slowed. The last three checks produced no new qualifying apartments. Checks now wait 120 minutes.`,new Date());
  const origin='https://scan-alert-fixture.test',writes=new Map<string,number>(),pending=new Map<string,ReturnType<typeof gate<'ok'|'fail'|'invalid'>>>();
  let stateRequests=0,recoverRequests=0,holdState:ReturnType<typeof gate<boolean>>|undefined,stateStarted=gate<void>();
  const recover=gate<void>();
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());assert.equal(u.origin,origin,'No external traffic');
   if(!u.pathname.startsWith('/api/')){
    const path=u.pathname==='/'?'index.html':u.pathname.slice(1),asset=assets.get(path);assert.ok(asset!==undefined);
    return route.fulfill({contentType:path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html',body:typeof asset==='string'?asset:Buffer.from(asset)});
   }
   if(u.pathname==='/api/state'){
    stateRequests++;
    const snapshot=JSON.stringify({homes:[home],csrf:'fixture-token',demo:true,sources:[],events:[],plans:[],criteria:store.criteria,criteriaRevision:'1',schedule:{enabled:false},aiMode:'api',discoveryAlerts:discoveryAlerts(store)});
    if(holdState){stateStarted.release();if(!await holdState.promise)return route.fulfill({status:503,json:{error:'Refresh unavailable'}});}
    return route.fulfill({contentType:'application/json',body:snapshot});
   }
   assert.equal(route.request().headers()['x-af-token'],'fixture-token');
   if(u.pathname==='/api/recover'){
    recoverRequests++;await recover.promise;return route.fulfill({json:{ok:true}});
   }
   if(u.pathname==='/api/discovery-alerts/dismiss'){
    const id=route.request().postDataJSON().id as string;writes.set(id,(writes.get(id)??0)+1);
    const held=gate<'ok'|'fail'|'invalid'>();pending.set(id,held);const result=await held.promise;pending.delete(id);
    if(result==='fail')return route.fulfill({status:503,json:{error:'Dismissal failed. Try again.'}});
    if(result==='invalid')return route.fulfill({json:{ok:false}});
    return route.fulfill({json:dismissDiscoveryAlert(store,id)});
   }
   throw Error('Unexpected route '+u.pathname);
  });
  const region=page.getByRole('region',{name:'Scan alerts'}),button=(source:string)=>region.getByRole('button',{name:`Dismiss ${source} scan alert`});
  const poll=async()=>{const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/state');await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await response;};
  const reply=async(id:string,result:'ok'|'fail'|'invalid')=>{
   assert.ok(pending.has(id),'Dismissal is already saving independently');
   const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/discovery-alerts/dismiss'&&r.request().postDataJSON().id===id);
   pending.get(id)!.release(result);await response;
  };
  try{
   await page.goto(origin);await region.waitFor();
   // Unrelated slow actions no longer lock alerts. Same-action double clicks
   // are still deduplicated before React has repainted the button.
   await page.getByRole('button',{name:'Activity',exact:false}).click();
   const recoverButton=page.getByRole('button',{name:'Recover interrupted scan',exact:true});
   const recovering=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/recover');
   await recoverButton.evaluate(el=>{(el as HTMLButtonElement).click();(el as HTMLButtonElement).click();});await recovering;
   assert.equal(await recoverButton.isDisabled(),true);assert.equal(recoverRequests,1);
   await page.getByRole('button',{name:'Sorting Desk',exact:false}).click();
   assert.equal(await page.getByRole('button',{name:'Interested',exact:true}).isEnabled(),true,'Unrelated slow actions leave apartment decisions available');
   // Hold an old poll across both pending and acknowledged dismissals.
   holdState=gate<boolean>();const polling=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/state');
   await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await polling;await stateStarted.promise;
   const [first,second,third]=discoveryAlerts(store),readsBefore=stateRequests;
   const dismiss=async(source:string)=>{
    const sending=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/discovery-alerts/dismiss');
    const started=Date.now();await button(source).click();await button(source).waitFor({state:'detached',timeout:750});
    assert.ok(Date.now()-started<1000,'Alert disappears before a slow save responds');await sending;
   };
   await dismiss('craigslist');await dismiss('zumper');
   assert.equal(pending.size,2,'Both saves overlap');assert.equal(await button('kijiji').isEnabled(),true);
   assert.equal(stateRequests,readsBefore,'Dismissals do not trigger a full desk refresh');
   await reply(second.id,'fail');await region.getByRole('alert').filter({hasText:'Dismissal failed'}).waitFor();
   assert.equal(await button('craigslist').count(),0,'One failure does not restore another pending alert');
   await reply(first.id,'ok');
   const stale=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/state');holdState.release(true);holdState=undefined;await stale;
   assert.equal(await button('craigslist').count(),0,'A stale poll cannot resurrect a confirmed dismissal');
   assert.equal(await button('zumper').isEnabled(),true);
   assert.equal(await region.evaluate(el=>el.scrollWidth<=el.clientWidth),true,'Alerts fit the viewport');
   mkdirSync('data/ui-checks',{recursive:true});await page.screenshot({path:`data/ui-checks/discovery-alert-${viewport.width===390?'phone':'desktop'}.png`});
   await dismiss('zumper');await dismiss('kijiji');await poll();
   assert.equal(await region.getByRole('button').count(),0,'Polls cannot resurrect pending dismissals either');
   await reply(third.id,'invalid');
   await region.getByRole('alert').filter({hasText:'did not confirm'}).waitFor();
   await dismiss('kijiji');await reply(third.id,'ok');await reply(second.id,'ok');await region.waitFor({state:'detached'});
   assert.equal(writes.get(first.id),1);assert.equal(writes.get(second.id),2);assert.equal(writes.get(third.id),2);
   // A successful action releases its controls even with a refresh pending.
   holdState=gate<boolean>();stateStarted=gate<void>();const refreshing=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/state');recover.release();await refreshing;await stateStarted.promise;
   await page.getByRole('status').filter({hasText:'Interrupted scan recovered; nothing restarted'}).waitFor();
   await page.getByRole('button',{name:'Activity',exact:false}).click();assert.equal(await recoverButton.isEnabled(),true);
   const failedRefresh=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/state');holdState.release(false);holdState=undefined;await failedRefresh;
   await page.getByRole('alert').filter({hasText:'Your change was saved, but the desk could not refresh'}).waitFor();
   assert.equal(recoverRequests,1,'A read failure does not repeat the successful action');
   // New slowdown episodes from the same source remain visible.
   resolveDiscoveryAlert(store,'craigslist',new Date());raiseDiscoveryAlert(store,'craigslist','New slowdown episode',new Date());
   await poll();await button('craigslist').waitFor();assert.equal(await region.locator('.discovery-alert').count(),1);
   const latest=discoveryAlerts(store).at(-1)!;await dismiss('craigslist');await reply(latest.id,'ok');await region.waitFor({state:'detached'});
   await page.reload();await page.getByRole('heading',{name:'Sorting Desk',exact:true}).waitFor();
   assert.equal(await region.count(),0,'Dismissals survive reload');assert.deepEqual(errors,[]);
   console.log(`${viewport.width}px: immediate successive dismissals, isolated failures/retries, stale polls, scoped actions and persisted refresh passed.`);
  }finally{holdState?.release(true);recover.release();for(const held of pending.values())held.release('fail');await page.close();store.close();}
 }
}finally{await browser.close();}
