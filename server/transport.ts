import {chromium,type BrowserContext,type Page} from 'playwright';
import {join} from 'node:path';
import timers from 'node:timers/promises';
import {type Source,allowedUrl} from './sources.ts';
import {Budget,assertAccessRecoveryCaps} from './plans.ts';
import {recordSourceAccess,sessionTraffic} from './traffic-policy.ts';
import {waitForSourceAccess} from './source-pacing.ts';
export function diagnosticUrl(value:string){try{const u=new URL(value);return u.origin+u.pathname;}catch{return 'invalid URL';}}
export type AccessDiagnostic={url:string;status:number;resourceType:string;mainDocument:boolean;sourceResource:boolean};
export class SourceSession {
 context?:BrowserContext;page?:Page;stopped=false;pages=0;browserRequests=0;stopReason='Source paused';
 diagnostics:AccessDiagnostic[]=[];
 constructor(public source:Source,public budget:Budget,public dataDir:string,public options:{visibleChrome?:boolean;accessRecovery?:boolean}={}){if(options.accessRecovery){assertAccessRecoveryCaps(budget.caps);if(!options.visibleChrome)throw new Error('Access recovery requires visible Chrome');}}
 checkSource(){if(!this.options.accessRecovery)this.budget.store.checkSource(this.source.id);}
 async start(){this.budget.check();this.checkSource();this.context=await chromium.launchPersistentContext(join(this.dataDir,this.options.visibleChrome?'chrome-profiles':'profiles',this.source.id),{...(this.options.visibleChrome?{channel:'chrome'}:{}),headless:!this.options.visibleChrome,serviceWorkers:'block',acceptDownloads:false});
 await this.context.route('**/*',async route=>{try{this.budget.check();if(this.stopped)throw new Error('Source stopped');const url=route.request().url(),type=route.request().resourceType();if(['image','media','font'].includes(type))return await route.abort();if(!this.options.visibleChrome){if(!allowedUrl(url,[...this.source.hosts,...this.source.mediaHosts,...(this.source.assetHosts??[])]))return await route.abort();}else if(!/^https:\/\//.test(url))return await route.abort();this.browserRequests++;if(!sessionTraffic(this.budget.caps))this.budget.reserve('requests');await route.continue();}catch(e){if(/cap reached/.test(String(e))&&!this.stopped){this.stopped=true;this.stopReason='Local request allowance reached; remaining work deferred';this.budget.store.event(`${this.source.name}: local request cap reached; browser requests stopped.`);}await route.abort();}});
 this.page=this.context.pages()[0]??await this.context.newPage();
 this.page.on('response',r=>{if(r.status()<400)return;const request=r.request(),mainDocument=request.isNavigationRequest()&&request.frame()===this.page!.mainFrame(),sourceResource=allowedUrl(r.url(),[...this.source.hosts,...this.source.mediaHosts]);const diagnostic={url:diagnosticUrl(r.url()),status:r.status(),resourceType:request.resourceType(),mainDocument,sourceResource};if(this.diagnostics.length<50)this.diagnostics.push(diagnostic);if([403,429,503].includes(r.status())&&(!this.options.visibleChrome||mainDocument||sourceResource&&['xhr','fetch','document'].includes(request.resourceType())))this.warn(`HTTP ${r.status()} on ${mainDocument?'main page':request.resourceType()}: ${diagnostic.url}`,r.status()===403);});}
 warn(reason:string,attention=false){if(!this.stopped){this.stopped=true;this.stopReason='Source access warning: '+reason;this.budget.store.pause(this.source.id,reason,attention);}}
 record(kind:'page'|'image'|'resource'){recordSourceAccess(this.budget,this.source,kind);}
 /** Retries and later plans share the same source clock, even after a session closes. */
 async waitForAccess(kind:'page'|'image'){
  await waitForSourceAccess(this.budget,this.source.id,kind,()=>{this.checkSource();if(this.stopped)throw new Error(this.stopReason);});
 }
 async html(url:string){if(!allowedUrl(url,this.source.hosts))throw new Error('Source URL not allowed');this.budget.check();this.checkSource();if(this.stopped)throw new Error('Source paused');if(!sessionTraffic(this.budget.caps)&&this.pages>=5)throw new Error('Per-source page cap reached');this.budget.reserve('pages');if(sessionTraffic(this.budget.caps))this.budget.reserve('requests');this.record('page');this.pages++;
 await this.waitForAccess('page');
 try{const response=await this.page!.goto(url,{waitUntil:'domcontentloaded',timeout:30000});if(!this.stopped)await timers.setTimeout(4000);if(this.stopped)throw new Error(this.stopReason);if(response&&[404,410].includes(response.status()))return null;const html=await this.page!.content();const body=await this.page!.locator('body').innerText();if(/unusual traffic|verify (?:you are|you're) human|(?:complete|solve|enter) (?:the |a )?captcha|access denied|too many requests|temporarily unavailable|press (?:and|&) hold/i.test(body)){this.warn('Human verification or traffic warning',true);throw new Error('Source access challenge');}if(response&&response.status()>=400){this.warn(`Unexpected HTTP ${response.status()}`);throw new Error('Source error');}return html;}catch(e){if(!this.stopped)this.warn('Navigation failed or exceeded the time limit');throw e;}}
 async image(url:string){this.budget.check();this.budget.store.checkSource(this.source.id);if(this.stopped)throw new Error('Source paused');if(!allowedUrl(url,this.source.mediaHosts))throw new Error('Image host not allowed');await this.waitForAccess('image');this.record('image');this.budget.reserve('photos');this.budget.reserve('requests');const r=await this.context!.request.get(url,{timeout:20000,maxRedirects:0}).catch(e=>{this.warn('Resource request failed or exceeded the time limit');throw e;});if([403,429,503].includes(r.status())){this.warn(`Image request received HTTP ${r.status()}`,r.status()===403);throw new Error('Source paused');}if(!r.ok())throw new Error(`Image unavailable: ${r.status()}`);const bytes=await r.body();if(bytes.length>15*1024*1024)throw new Error('Image exceeds 15MB limit');return bytes;}
 async close(){await this.context?.close();this.budget.store.set(`browserRequests:${this.budget.id}:${this.source.id}`,this.browserRequests);}
 /** Craigslist exposes its result position in the URL after ordinary scrolling. */
 async inventoryContinuation(){
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
 async resource(url:string){this.budget.check();this.budget.store.checkSource(this.source.id);if(this.stopped||!allowedUrl(url,this.source.hosts))throw new Error('Source resource unavailable');this.record('resource');this.budget.reserve('requests');const r=await this.context!.request.get(url,{timeout:20000,maxRedirects:0});if([403,429,503].includes(r.status())){this.warn(`Resource request received HTTP ${r.status()}`,r.status()===403);throw new Error('Source paused');}if(!r.ok())throw new Error(`Resource unavailable: ${r.status()}`);const text=await r.text();if(text.length>5_000_000)throw new Error('Resource exceeds local size limit');return text;}
}
