import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {waitForHollyburnSearch} from '../server/hollyburn-rendering.ts';
const url='https://www.hollyburn.com/find-an-apartment?lat=49.28&lng=-123.13&city=Vancouver';

test('Hollyburn render helper preserves cancellation and leaves unrelated routes alone',async()=>{
 let waits=0;const page={waitForFunction:async()=>{waits++;throw Object.assign(new Error('Not ready'),{name:'TimeoutError'});}} as any;
 assert.equal(await waitForHollyburnSearch(page,'https://www.hollyburn.com/furnished-rental-suites/',()=>{}),false);assert.equal(waits,0);
 assert.equal(await waitForHollyburnSearch(page,url,()=>{},10),false);assert.equal(waits,1);
 let checks=0;await assert.rejects(()=>waitForHollyburnSearch(page,url,()=>{if(++checks===2)throw Error('Scan stopped');},10),/Scan stopped/);
});

test('offline browser waits through Hollyburn loader and rejects empty or unrelated cards',{skip:process.env.AF_OFFLINE_BROWSER_TESTS!=='1',timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});let requests=0;
 try{
  const context=await browser.newContext(),page=await context.newPage();
  // Every attempted browser request is fulfilled locally or aborted.
  await context.route('**/*',async route=>{requests++;if(route.request().url()===url)await route.fulfill({status:200,contentType:'text/html',body:'<div id="find_appartment_app"><div class="loading-container">Loading</div></div><script>setTimeout(()=>{document.getElementById("find_appartment_app").innerHTML=\'<a href="/building/fixture/">Fixture</a>\';},250);</script>'});else await route.abort();});
  await page.goto(url);let checks=0;assert.equal(await waitForHollyburnSearch(page,url,()=>{checks++;},3000),true);assert.ok(checks>=2);assert.equal(await page.locator('.loading-container').count(),0);
  await page.setContent('<a href="/building/unrelated/">Footer recommendation</a><div id="find_appartment_app"></div>');assert.equal(await waitForHollyburnSearch(page,url,()=>{},100),false);
  await page.setContent('<div id="find_appartment_app"><div class="loading-container">Loading</div><a href="/building/stale/">Stale card</a></div>');assert.equal(await waitForHollyburnSearch(page,url,()=>{},100),false);
  assert.equal(requests,1);
 }finally{await browser.close();}
});
