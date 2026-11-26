import {fetchSourcePhoto,pauseAccess,pauseTransport} from './source-failures.ts';
import {chromium,type BrowserContext,type Page} from 'playwright';
import {join} from 'node:path';
import timers from 'node:timers/promises';
import {type Source,allowedUrl} from './sources.ts';
import {Budget,assertAccessRecoveryCaps,assertRecoveryCooldown} from './plans.ts';
import {recordSourceAccess,sessionTraffic} from './traffic-policy.ts';
import {waitForSourceAccess,recordAccessSuccess} from './source-pacing.ts';
import {facetPagination} from './source-discovery.ts';
import {completeZumperSearch} from './zumper-discovery.ts';
import {facebookSearchSnapshot,continueFacebookSearch,inspectFacebookLocationControls} from './facebook-discovery.ts';
import {hash} from './db.ts';
import {adoptFacebookRadiusRoute} from './facebook-scope.ts';
import {waitForHollyburnSearch} from './hollyburn-rendering.ts';
import {isLocalScanStop} from './scan-stop.ts';
import {areaSearchRoute,sourceFilteredIntake} from './search-area.ts';
export function diagnosticUrl(value:string){try{const u=new URL(value);return u.origin+u.pathname;}catch{return 'invalid URL';}}
export type AccessDiagnostic={url:string;status:number;resourceType:string;mainDocument:boolean;sourceResource:boolean};
export type InventoryContinuation={end:boolean;url:string;total?:number;deferred?:boolean;html?:string;unverified?:string};
export class SourceSession {
 lastResponseStatus?:number;
 context?:BrowserContext;page?:Page;stopped=false;pages=0;browserRequests=0;stopReason='Source paused';
 facebookInventoryHtml?:string;facebookScrolls=0;facebookNoProgress=0;
 diagnostics:AccessDiagnostic[]=[];
 constructor(public source:Source,public budget:Budget,public dataDir:string,public options:{visibleChrome?:boolean;accessRecovery?:boolean}={}){if(options.accessRecovery){assertAccessRecoveryCaps(budget.caps);assertRecoveryCooldown(budget.store,source.id);if(!options.visibleChrome&&source.id!=='kijiji')throw new Error('Access recovery requires visible Chrome');}}
 checkSource(){if(!this.options.accessRecovery)this.budget.store.checkSource(this.source.id);}
 async start(){this.budget.check();this.checkSource();this.context=await chromium.launchPersistentContext(join(this.dataDir,this.options.visibleChrome?'chrome-profiles':'profiles',this.source.id),{...(this.options.visibleChrome?{channel:'chrome'}:{}),headless:!this.options.visibleChrome,serviceWorkers:'block',acceptDownloads:false});
 await this.context.route('**/*',async route=>{try{this.budget.check();if(this.stopped)throw new Error('Source stopped');const url=route.request().url(),type=route.request().resourceType();if(['image','media','font'].includes(type))return await route.abort();if(!this.options.visibleChrome){if(!allowedUrl(url,[...this.source.hosts,...this.source.mediaHosts,...(this.source.assetHosts??[])]))return await route.abort();}else if(!/^https:\/\//.test(url))return await route.abort();this.browserRequests++;if(!sessionTraffic(this.budget.caps))this.budget.reserve('requests');await route.continue();}catch(e){if(/cap reached/.test(String(e))&&!this.stopped){this.stopped=true;this.stopReason='Local request allowance reached; remaining work deferred';this.budget.store.event(`${this.source.name}: local request cap reached; browser requests stopped.`);}await route.abort();}});
 this.page=this.context.pages()[0]??await this.context.newPage();
 this.page.on('response',r=>{if(r.status()<400)return;const request=r.request(),mainDocument=request.isNavigationRequest()&&request.frame()===this.page!.mainFrame(),sourceResource=allowedUrl(r.url(),[...this.source.hosts,...this.source.mediaHosts]);const diagnostic={url:diagnosticUrl(r.url()),status:r.status(),resourceType:request.resourceType(),mainDocument,sourceResource};if(this.diagnostics.length<50)this.diagnostics.push(diagnostic);if([403,429,503].includes(r.status())&&(!this.options.visibleChrome||mainDocument||sourceResource&&['xhr','fetch','document'].includes(request.resourceType())))this.warn(`HTTP ${r.status()} on ${mainDocument?'main page':request.resourceType()}: ${diagnostic.url}`,r.status()===403,r.headers()['retry-after']);});}
 warn(reason:string,attention=false,retryAfter?:string){if(!this.stopped){this.stopped=true;this.stopReason='Source access warning: '+reason;pauseAccess(this.budget,this.source.id,reason,attention,retryAfter);}}
 record(kind:'page'|'image'|'resource'){recordSourceAccess(this.budget,this.source,kind);}
 /** Retries and later plans share the same source clock, even after a session closes. */
 async waitForAccess(kind:'page'|'image'){
  await waitForSourceAccess(this.budget,this.source.id,kind,()=>{this.checkSource();if(this.stopped)throw new Error(this.stopReason);});
 }
 async html(url:string,options:{availability?:boolean}={}){this.lastResponseStatus=undefined;if(!allowedUrl(url,this.source.hosts))throw new Error('Source URL not allowed');this.budget.check();this.checkSource();if(this.stopped)throw new Error('Source paused');if(!sessionTraffic(this.budget.caps)&&this.pages>=5)throw new Error('Per-source page cap reached');this.budget.reserve('pages');if(sessionTraffic(this.budget.caps))this.budget.reserve('requests');this.record('page');this.pages++;
 if(this.source.id==='facebook'){this.facebookInventoryHtml=undefined;this.facebookScrolls=0;this.facebookNoProgress=0;}
 await this.waitForAccess('page');
 const started=Date.now();try{const response=await this.page!.goto(url,{waitUntil:'domcontentloaded',timeout:30000});this.lastResponseStatus=response?.status();if(!this.stopped)await timers.setTimeout(4000);if(this.stopped)throw new Error(this.stopReason);
 const missing=response&&[404,410].includes(response.status());
 if(missing&&!options.availability)return null;
 if(!missing)await this.waitForSearchRendering(url);let html=await this.page!.content();if(!missing&&this.source.id==='zumper')html=await completeZumperSearch(this.page!,html,url,async()=>{await this.waitForAccess('page');this.budget.reserve('pages');this.budget.reserve('requests');this.record('page');this.pages++;},()=>{this.budget.check();this.checkSource();if(this.stopped)throw Error(this.stopReason);});const body=await this.page!.locator('body').innerText();if(/unusual traffic|verify (?:you are|you're) human|(?:complete|solve|enter) (?:the |a )?captcha|access denied|too many requests|temporarily unavailable|press (?:and|&) hold/i.test(body)){this.warn('Human verification or traffic warning',true);throw new Error('Source access challenge');}
 // Expired ads can return 404/410 with an explicit closure notice. Retain that
 // evidence for availability checks, without treating the HTTP status as closure.
 if(missing)return html;
 if(response&&response.status()>=400){this.warn(`Unexpected HTTP ${response.status()}`);throw new Error('Source error');}recordAccessSuccess(this.budget,this.source.id,'page',Date.now()-started);return html;}catch(e){if(!this.stopped&&!isLocalScanStop(e)){this.stopped=true;pauseTransport(this.budget,this.source.id,'Navigation transport failed; five-minute backoff');}throw e;}}
 async image(url:string){
  this.budget.check();this.checkSource();if(this.stopped)throw new Error('Source paused');if(!allowedUrl(url,this.source.mediaHosts))throw new Error('Image host not allowed');
  return fetchSourcePhoto(this.budget,this.source,async()=>{
   if(this.stopped)throw new Error('Source paused');
   const r=await this.context!.request.get(url,{timeout:20000,maxRedirects:0});
   if([403,429,503].includes(r.status())){this.warn('Image request received HTTP '+r.status(),r.status()===403,r.headers()['retry-after']);throw new Error('Source paused');}
   if(!r.ok())throw new Error('Image unavailable: '+r.status());
   const bytes=await r.body();if(bytes.length>15*1024*1024)throw new Error('Image exceeds 15MB limit');return bytes;
  });
 }
 async close(){await this.context?.close();this.budget.store.set(`browserRequests:${this.budget.id}:${this.source.id}`,this.browserRequests);}
 /** Wait for the observed dynamic search container, without inventing inventory on timeout. */
 async waitForSearchRendering(url:string){
  if(this.source.id==='easyrent'&&/^\/listings\/?$/.test(new URL(url).pathname)){
   const expected=Number(new URL(url).searchParams.get('_paged')??1);
   await this.waitForFacetPage(expected);return;
  }
  if(this.source.id==='hollyburn'){
   await waitForHollyburnSearch(this.page!,url,()=>{this.budget.check();this.checkSource();if(this.stopped)throw Error(this.stopReason);});return;
  }
  if(this.source.id!=='austeville'||!/^\/vacancies\/?$/.test(new URL(url).pathname)||this.stopped)return;
  await this.page!.waitForFunction(()=>{
   const app=document.getElementById('property-search-app');
   return !!app&&!app.querySelector('.spinner,.spinner-border')&&!!app.textContent?.trim()&&!/^Loading\.{0,3}$/i.test(app.textContent.trim());
  },undefined,{timeout:12000}).catch(()=>{});
  this.budget.check();this.checkSource();
 }
 /** A clicked Next button becomes active before FacetWP finishes replacing rows. */
 async waitForFacetPage(expected:number){
  this.budget.check();this.checkSource();if(this.stopped)throw Error(this.stopReason);
  await this.page!.waitForFunction(wanted=>{
   if(!document.querySelector('.facetwp-template')||document.querySelector('.facetwp-facet.is-loading,.facetwp-template.is-loading'))return false;
   const pager=document.querySelector('.facetwp-pager');
   if(!pager?.querySelector('.facetwp-page'))return wanted===1;
   const active=pager.querySelectorAll('.facetwp-page.active:not(.next):not(.prev):not(.dots)');
   return active.length===1&&Number(active[0].getAttribute('data-page'))===wanted;
  },expected,{timeout:15000});
  this.budget.check();this.checkSource();if(this.stopped)throw Error(this.stopReason);
 }
 /** Click only the source's advertised next page and retain its URL for resumption. */
 async facetContinuation():Promise<InventoryContinuation|null>{
  const page=this.page!,before=page.url(),pager=facetPagination(await page.content(),this.source);
  if(!pager)return null;
  if(pager.exhausted)return {end:true,url:before};
  if(!pager.next)throw Error('EasyRent pagination is incomplete; inventory remains unverified');
  if(!this.budget.remaining('pages'))return {end:false,url:before,deferred:true};
  this.budget.check();this.checkSource();if(this.stopped)throw Error(this.stopReason);
  await this.waitForAccess('page');this.budget.reserve('pages');this.budget.reserve('requests');this.record('page');
  await page.locator(`.facetwp-pager .facetwp-page.next[data-page="${pager.next}"]`).first().click({timeout:10000});
  await this.waitForFacetPage(pager.next);
  this.budget.check();this.checkSource();if(this.stopped)throw Error(this.stopReason);
  const url=page.url();
  if(url===before||!allowedUrl(url,this.source.hosts)||sourceFilteredIntake(this.budget.store)&&!areaSearchRoute(this.budget.store,this.source.id,url))throw Error('EasyRent next page did not retain a resumable geographic search URL; coverage remains incomplete');
  const body=await page.locator('body').innerText();
  if(/unusual traffic|verify (?:you are|you're) human|captcha|access denied|too many requests/i.test(body)){this.warn('Human verification or traffic warning',true);throw Error('Source access challenge');}
  return {end:false,url,html:await page.content()};
 }
 /** Craigslist exposes its result position in the URL after ordinary scrolling. */
 async inventoryContinuation():Promise<InventoryContinuation|null>{
  if(this.source.id==='facebook')return this.facebookContinuation();
  if(this.source.id==='easyrent')return this.facetContinuation();
  if(this.source.id!=='craigslist')return null;
  const page=this.page!,before=page.url(),counts=(await page.locator('.visible-counts').allTextContents()).join(' '),match=counts.match(/([\d,]+)\s*-\s*([\d,]+)\s+of\s+([\d,]+)/i);
  const total=match?Number(match[3].replaceAll(',','')):undefined;
  if(match&&Number(match[2].replaceAll(',',''))>=total!)return {end:true,url:before,total};
  if(!this.budget.remaining('pages'))return {end:false,url:before,total,deferred:true};
  this.budget.check();this.checkSource();if(this.stopped)throw Error(this.stopReason);
  await this.waitForAccess('page');
  this.budget.reserve('pages');this.budget.reserve('requests');this.record('page');
  await page.bringToFront();const box=await page.locator('.cl-search-results .scrolling-container:has(.cl-search-result)').boundingBox();
  if(!box)throw Error('Craigslist results scroller unavailable');
  await page.mouse.move(box.x+box.width/2,Math.min(box.y+200,650));await page.mouse.wheel(0,8000);await timers.setTimeout(4000);
  if(this.stopped)throw Error(this.stopReason);
  const body=await page.locator('body').innerText();
  if(/unusual traffic|verify (?:you are|you're) human|(?:complete|solve|enter) (?:the |a )?captcha|access denied|too many requests/i.test(body)){this.warn('Human verification or traffic warning',true);throw Error('Source access challenge');}
  const url=page.url();return {end:false,url,total,deferred:url===before,html:await page.content()};
 }
 /** Facebook has no resumable page URL. Rewalk ordinary visible results and retain
  * the maximum depth so a later bounded batch can extend beyond the prior window. */
 async facebookContinuation():Promise<InventoryContinuation>{
  const page=this.page!,url=page.url();
  const check=()=>{this.budget.check();this.checkSource();if(this.stopped)throw Error(this.stopReason);};
  check();if(!this.budget.remaining('pages'))return {end:false,url,deferred:true};
  const inspectionVersion=3,inspection=this.budget.store.get<{version?:number;state?:string}>('facebookLocationInspection');
  if((inspection?.version!==inspectionVersion||inspection.state==='inspecting')&&this.budget.remaining('pages')>2){
   this.budget.store.set('facebookLocationInspection',{version:inspectionVersion,at:new Date().toISOString(),state:'inspecting'});
   try{
    const result=await inspectFacebookLocationControls(page,url,async()=>{await this.waitForAccess('page');this.budget.reserve('pages');this.budget.reserve('requests');this.record('page');this.pages++;},check,{apply:true});
    this.budget.store.set('facebookLocationInspection',{version:inspectionVersion,at:new Date().toISOString(),...result});
    if(result.afterUrl&&result.afterUrl!==url){
     const configured=result.applied&&result.verifiedRadiusKm!==undefined&&adoptFacebookRadiusRoute(this.budget.store,url,result.afterUrl,result.verifiedRadiusKm);
     return {end:false,url,unverified:configured?'Verified Facebook radius search URL retained for the next bounded inventory batch':'Facebook location control changed the search URL; the observed scoped route awaits configuration'};
    }
   }catch(error){
    check();
    if(isLocalScanStop(error)||page.url()!==url||await page.locator('[role="dialog"]:visible').count())throw error;
    // A missing optional location control must not disable a usable feed. The
    // original approximate provenance and distant-location exclusions remain.
    this.budget.store.set('facebookLocationInspection',{version:inspectionVersion,at:new Date().toISOString(),inspected:false,reason:'Optional public location control failed; unchanged approximate search retained',detail:String(error).slice(0,800)});
    this.budget.store.event('Facebook optional radius inspection failed with its dialog closed; continuing the unchanged approximate Vancouver feed.');
   }
  }
  this.facebookInventoryHtml??=facebookSearchSnapshot(await page.content(),url).html;
  const started=Date.now();
  const result=await continueFacebookSearch(page,this.facebookInventoryHtml,url,async()=>{
   await this.waitForAccess('page');this.budget.reserve('pages');this.budget.reserve('requests');this.record('page');this.pages++;this.facebookScrolls++;
  },check);
  check();const body=await page.locator('body').innerText();
  if(/unusual traffic|verify (?:you are|you're) human|(?:complete|solve|enter) (?:the |a )?captcha|access denied|too many requests|temporarily unavailable|press (?:and|&) hold/i.test(body)){this.warn('Human verification or traffic warning',true);throw Error('Source access challenge');}
  this.facebookInventoryHtml=result.html;this.facebookNoProgress=result.progressed?0:this.facebookNoProgress+1;
  const key='facebookInventoryDepth:'+hash(url),previous=this.budget.store.get<{maxScrolls:number}>(key);
  this.budget.store.set(key,{maxScrolls:Math.max(previous?.maxScrolls??0,this.facebookScrolls),updatedAt:new Date().toISOString()});
  recordAccessSuccess(this.budget,this.source.id,'page',Date.now()-started);
  return {end:false,url,html:result.html,deferred:true,...(this.facebookNoProgress>=2||!result.recognized?{unverified:result.reason??'Facebook feed did not advance after two ordinary scrolls; coverage remains unverified'}:{})};
 }
 async resource(url:string){this.budget.check();this.budget.store.checkSource(this.source.id);if(this.stopped||!allowedUrl(url,this.source.hosts))throw new Error('Source resource unavailable');this.record('resource');this.budget.reserve('requests');const r=await this.context!.request.get(url,{timeout:20000,maxRedirects:0});if([403,429,503].includes(r.status())){this.warn(`Resource request received HTTP ${r.status()}`,r.status()===403,r.headers()['retry-after']);throw new Error('Source paused');}if(!r.ok())throw new Error(`Resource unavailable: ${r.status()}`);const text=await r.text();if(text.length>5_000_000)throw new Error('Resource exceeds local size limit');return text;}
}
