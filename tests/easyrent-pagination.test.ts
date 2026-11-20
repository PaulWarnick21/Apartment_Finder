import test from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';
import {Store} from '../server/db.ts';import {Budget,createPlan,approvePlan,claimPlan,getPlan} from '../server/plans.ts';
import {SourceSession} from '../server/transport.ts';import {sourceById} from '../server/sources.ts';import {facetPagination} from '../server/source-discovery.ts';
const source=sourceById('easyrent'),url='https://www.easyrent.ca/listings/?_city=vancouver&_paged=17';
const settled=(n:number,last=28)=>`<div class="facetwp-facet"><div class="facetwp-template"><a href="/listings/page-${n}-fixture/">Page ${n}</a></div><div class="facetwp-pager"><a class="facetwp-page active" data-page="${n}">${n}</a><a class="facetwp-page last" data-page="${last}">${last}</a>${n<last?`<a class="facetwp-page next" data-page="${n+1}">Next</a>`:''}</div></div>`;
test('FacetWP loading and clicked Next are never mistaken for a settled current page or exhausted inventory',()=>{
 assert.deepEqual(facetPagination(settled(17),source),{current:17,last:28,next:18,exhausted:false});
 const transient=settled(17).replace('facetwp-facet','facetwp-facet is-loading').replace('facetwp-page active','facetwp-page').replace('facetwp-page next','facetwp-page next active');
 assert.equal(facetPagination(transient,source),null);
 assert.equal(facetPagination(transient.replace(' is-loading',''),source),null);
 assert.equal(facetPagination(settled(17).replace('facetwp-facet','facetwp-facet is-loading'),source),null);
 assert.equal(facetPagination(settled(17).replace('facetwp-page last','facetwp-page last active'),source),null);
 assert.deepEqual(facetPagination(settled(28),source),{current:28,last:28,next:null,exhausted:true});
});

test('offline FacetWP continuation waits for AJAX completion and final page consumes no extra allowance',{skip:process.env.AF_OFFLINE_BROWSER_TESTS!=='1',timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'}),store=new Store(':memory:');let requests=0;
 try{
  const body=settled(17)+`<script>document.querySelector('.next').onclick=()=>{const facet=document.querySelector('.facetwp-facet');facet.classList.add('is-loading');document.querySelector('.facetwp-page.active').classList.remove('active');document.querySelector('.next').classList.add('active');history.replaceState(null,'','?_city=vancouver&_paged=18');setTimeout(()=>{facet.outerHTML=${JSON.stringify(settled(18))};},300);};</script>`;
  const context=await browser.newContext();await context.route('**/*',async route=>{requests++;if(route.request().url()===url)await route.fulfill({status:200,contentType:'text/html',body});else await route.abort();});
  const page=await context.newPage();await page.goto(url);
  const plan=createPlan(store,{phase:'inventory',sources:['easyrent'],trafficPolicy:'session',maxPages:2,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);const budget=new Budget(store,plan.id,plan.caps);
  class OfflineSession extends SourceSession {async waitForAccess(){}}
  const session=new OfflineSession(source,budget,'');session.page=page;
  const result=await session.facetContinuation();assert.equal(result?.end,false);assert.equal(result?.url,url.replace('=17','=18'));assert.match(result?.html??'',/page-18-fixture/);assert.equal(await page.locator('.facetwp-facet.is-loading').count(),0);
  assert.deepEqual(facetPagination(result!.html!,source),{current:18,last:28,next:19,exhausted:false});assert.equal(getPlan(store,plan.id).usage.pages,1);assert.equal(getPlan(store,plan.id).usage.requests,1);
  await page.setContent(settled(16).replace('facetwp-facet','facetwp-facet is-loading')+`<script>setTimeout(()=>{document.body.innerHTML=${JSON.stringify(settled(17))};},250);</script>`);
  await session.waitForSearchRendering(url);assert.equal(facetPagination(await page.content(),source)?.current,17);assert.equal(await page.locator('.is-loading').count(),0);
  await page.setContent(settled(28));const final=await session.facetContinuation();assert.equal(final?.end,true);assert.equal(getPlan(store,plan.id).usage.pages,1);assert.equal(store.health().length,0);assert.equal(requests,1);
 }finally{await browser.close();store.close();}
});
