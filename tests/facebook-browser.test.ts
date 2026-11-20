import test from 'node:test';import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {inspectFacebookLocationControls} from '../server/facebook-discovery.ts';
const url='https://www.facebook.com/marketplace/vancouver/propertyrentals/';
// Deliberately inline, offline UI fixtures: every browser request is fulfilled or aborted locally.
const fixture=`<!doctype html><html><body><nav>Private notification: ACCOUNT_SECRET</nav>
<div role="navigation" aria-label="Marketplace sidebar"><button id="open" aria-label="Location: Vancouver, British Columbia, Within 72 km">Vancouver, British Columbia · Within 72 km</button></div>
<div role="main" aria-label="Collection of Marketplace items"><button hidden aria-label="Vancouver · 72 km">Vancouver · 72 km</button></div>
<div id="dialog" role="dialog" hidden><h2>Change location</h2><div id="form" hidden><label>Location<input aria-label="Location" value="Vancouver, British Columbia"></label><button id="radius" role="combobox" aria-label="Radius">72 km</button><button id="apply">Apply</button></div><button id="close">Close</button></div>
<div id="options" role="listbox" hidden><div role="option" tabindex="0">3 km</div><div role="option" tabindex="0">4 km</div><div role="option" tabindex="0">5 km</div><div role="option" tabindex="0">72 km</div></div>
<script>
const locationDialog=document.getElementById('dialog'),radiusOptions=document.getElementById('options'),openButton=document.getElementById('open');let selected=72;
openButton.onclick=()=>{locationDialog.hidden=false;document.getElementById('form').hidden=true;setTimeout(()=>{document.getElementById('form').hidden=false;},200);};document.getElementById('radius').onclick=()=>{radiusOptions.hidden=false;};
for(const option of radiusOptions.children)option.onclick=()=>{selected=Number(option.textContent.match(/\\d+/)[0]);radiusOptions.hidden=true;document.getElementById('radius').textContent=selected+' km';};
document.getElementById('apply').onclick=()=>{openButton.setAttribute('aria-label','Location: Vancouver, British Columbia, Within '+selected+' km');openButton.textContent='Vancouver, British Columbia · Within '+selected+' km';locationDialog.hidden=true;history.replaceState(null,'','?radius='+selected);};
document.getElementById('close').onclick=()=>{locationDialog.hidden=true;radiusOptions.hidden=true;};document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!radiusOptions.hidden)radiusOptions.hidden=true;else locationDialog.hidden=true;}});
</script></body></html>`;
test('real offline browser waits for delayed form rendering, isolates public data, and verifies an observed radius change',{skip:process.env.AF_OFFLINE_BROWSER_TESTS!=='1',timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});let fulfilled=0;
 try{
  const context=await browser.newContext();await context.route('**/*',async route=>{if(route.request().isNavigationRequest()&&route.request().url()===url){fulfilled++;await route.fulfill({status:200,contentType:'text/html',body:fixture});}else await route.abort();});
  const page=await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded'});let spent=0;
  const inspected=await inspectFacebookLocationControls(page,url,async()=>{spent++;},()=>{});
  assert.equal(inspected.inspected,true);if(!inspected.inspected)throw Error('Public fixture dialog was not inspected');
  assert.deepEqual(inspected.radiusOptions?.labels,['3 km','4 km','5 km','72 km']);assert.ok(inspected.controls.some(c=>c.value==='Vancouver, British Columbia'));assert.ok(!JSON.stringify(inspected).includes('ACCOUNT_SECRET'));assert.equal(spent,2);assert.equal(page.url(),url);
  const applied=await inspectFacebookLocationControls(page,url,async()=>{spent++;},()=>{},{apply:true});
  assert.equal(applied.inspected,true);if(!applied.inspected)throw Error('Public fixture dialog was not applied');
  assert.equal(applied.applied,true);assert.equal(applied.verifiedRadiusKm,4);assert.equal(applied.afterUrl,url+'?radius=4');assert.equal(spent,6);assert.equal(await page.locator('[role="dialog"]:visible').count(),0);assert.equal(fulfilled,1);
 }finally{await browser.close();}
});
