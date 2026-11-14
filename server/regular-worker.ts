import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Store,hash} from './db.ts';
import {Budget,claimPlan,getPlan} from './plans.ts';
import {SourceBudget} from './source-budget.ts';
import {SourceSession} from './transport.ts';
import {sourceById,type Source} from './sources.ts';
import {discoverSource,inventoryEndpoint,inventoryUrls,nextDiscovery} from './source-discovery.ts';
import {parseListing} from './parsers.ts';
import {extractTrial} from './trial-extraction.ts';
import {extractRemaining} from './remaining-extraction.ts';
import {extractZumper} from './zumper-extraction.ts';
import {reviewGallery} from './gallery-review.ts';
import {storePhoto} from './photo-storage.ts';
import type {Listing,Criteria} from '../src/domain.ts';
import type {ChromeJobs} from './chrome-jobs.ts';
import {runApartmentsSource} from './apartments-worker.ts';
export type SourceResult={source:string;state:'complete'|'partial'|'paused'|'pending';detail:string};
export function hardFailure(l:Listing,c:Criteria){return c.maxRent!==null&&l.rent!==null&&l.rent>=c.maxRent||c.requireLaundry&&['none','shared-only','hookups'].includes(l.laundry);}
export function knownUrl(store:Store,source:string,url:string){return !!store.db.prepare('SELECT 1 FROM postings WHERE source=? AND url=?').get(source,url);}
export function pendingHomes(store:Store,source:string){return store.homes().filter(h=>h.listing.source===source&&!!store.get(`pendingGallery:${h.id}`)&&!['Closed','Leased','Not Interested'].includes(h.stage));}
function locate(l:Listing){if(l.location!=='unknown')return;const area=l.area!=='Unknown'?l.area:l.address;const text=area+' '+l.title;if(/\b(Coal Harbour|West End|Yaletown|Downtown Vancouver)\b/i.test(text)){l.location='downtown';l.evidence.location=text;}else if(/\b(North Vancouver|West Vancouver|Burnaby|Richmond|Coquitlam|Port Moody|Surrey|New Westminster)\b/i.test(text)){l.location='outside';l.evidence.location=text;}}
export function extractSource(source:Source,html:string,url:string,xml?:string){let l:Listing;if(source.id==='craigslist')l=parseListing(html,url,source);else if(['zillow','rew','facebook'].includes(source.id))l=extractRemaining(source.id as 'zillow'|'rew'|'facebook',html,url);else if(source.id==='zumper')l=extractZumper(html,url);else l=extractTrial(html,url,source,xml);if(!l.title||l.rent===null)throw new Error('Listing title or rent missing; extraction needs review');locate(l);return l;}
type Queue={urls:string[];next:string|null};
type Session=Pick<SourceSession,'start'|'html'|'resource'|'image'|'close'|'stopped'>;
export type ScanDependencies={session?:(source:Source,budget:Budget,dataDir:string)=>Session;review?:typeof reviewGallery;apartments?:typeof runApartmentsSource};
export async function runWebSource(store:Store,source:Source,budget:Budget,dataDir:string,deps:ScanDependencies={}):Promise<SourceResult>{
 const session=deps.session?.(source,budget,dataDir)??new SourceSession(source,budget,dataDir,{visibleChrome:source.visibleChrome});
 const key=`discoveryQueue:${source.id}`,queue=store.get<Queue>(key)??{urls:[],next:null};let partial=false;
 const snapshot=async(url:string,html:string)=>{const dir=join(dataDir,'snapshots',budget.id);await mkdir(dir,{recursive:true});await writeFile(join(dir,hash(url)+'.html'),html.slice(0,5_000_000));};
 try{await session.start();const pending=pendingHomes(store,source.id);queue.urls=[...new Set([...pending.map(h=>h.listing.url),...queue.urls.filter(url=>!knownUrl(store,source.id,url))])];
 if(!queue.urls.length){const url=queue.next??source.search,html=await session.html(url);if(!html)throw new Error('Discovery page unavailable');await snapshot(url,html);let urls=discoverSource(html,source,url);const endpoint=inventoryEndpoint(html,source);if(endpoint)urls=[...urls,...inventoryUrls(await session.resource(endpoint),source)];if(!urls.length)throw new Error('No rental links recognized; discovery requires attention');queue.urls=[...new Set(urls)].filter(url=>!knownUrl(store,source.id,url));queue.next=nextDiscovery(html,source,url);store.set(key,queue);}
 while(queue.urls.length&&budget.remaining('listings')&&budget.remaining('pages')){
  budget.check();const url=queue.urls[0];budget.reserve('listings');let home=pending.find(h=>h.listing.url===url);
  if(!home?.listing.galleryComplete){const html=await session.html(url);if(!html){queue.urls.shift();store.set(key,queue);continue;}await snapshot(url,html);
   // Only the site's documented Juicebox gallery resource; it still consumes request allowance.
   const xml=source.id==='sunstar'&&/juicebox/i.test(html)?await session.resource(new URL('config.xml',url).href):undefined;
   const listing=extractSource(source,html,url,xml);home=store.home(store.ingest(listing).id)!;
  }
  const l=home.listing;
  queue.urls.shift();store.set(key,queue);
  try{if(!hardFailure(l,store.criteria)&&!['Not Interested','Closed','Leased'].includes(home.stage)){
   for(const p of l.photos){if(p.local)continue;try{Object.assign(p,await storePhoto(await session.image(p.url),dataDir));p.status='downloaded';}catch(e){if(session.stopped||!/Image unavailable: (404|410)/.test(String(e)))throw e;p.status='unavailable';p.note='Image no longer available from the source.';}}
   if(l.galleryComplete&&l.photos.length&&l.photos.every(p=>p.local)&&budget.remaining('aiCalls'))await(deps.review??reviewGallery)(l,budget,dataDir);
   if(!l.galleryComplete||!l.photos.length||l.photos.some(p=>p.status!=='reviewed'))partial=true;
  }}finally{store.db.prepare('UPDATE homes SET listing=?,revision=revision+1,updated_at=? WHERE id=?').run(JSON.stringify(l),new Date().toISOString(),home.id);if(!hardFailure(l,store.criteria)&&(!l.galleryComplete||!l.photos.length||l.photos.some(p=>p.status!=='reviewed')))store.set(`pendingGallery:${home.id}`,{source:source.id,homeId:home.id,planId:budget.id});else store.db.prepare('DELETE FROM meta WHERE key=?').run(`pendingGallery:${home.id}`);}
 }
 const more=queue.urls.length>0||!!queue.next;return {source:source.id,state:partial||more?'partial':'complete',detail:partial?'Saved progress; gallery review remains incomplete.':more?'Bounded inventory slice saved; more listings remain queued.':'Discovered listings processed; previously saved apartments skipped.'};
 }finally{await session.close();}
}
/** The only coordinator: one approval, one lock, sequential sources and shared total caps. */
export async function runRegularPlan(store:Store,id:string,dataDir:string,jobs?:ChromeJobs,deps:ScanDependencies={}){
 const plan=claimPlan(store,id),budget=new Budget(store,id,plan.caps),results:SourceResult[]=plan.caps.sources.map((source:string)=>({source,state:'pending',detail:'Awaiting its turn.'}));store.set(`sourceResults:${id}`,results);
 try{if(plan.caps.purpose!=='listings')throw new Error('Access checks use their dedicated runner');if(plan.caps.maxAiCalls&&plan.caps.billingMode!=='chatgpt')throw new Error('Regular scans require ChatGPT plan access; paid API fallback is disabled');
 for(let i=0;i<results.length;i++){budget.check();const source=sourceById(results[i].source),share=new SourceBudget(budget,results.length-i);
  try{store.checkSource(source.id);if(!share.remaining('pages')||!share.remaining('listings'))throw new Error('Approved allowance exhausted before this source; no requests made');
   results[i]=source.id==='apartments'?await(deps.apartments??runApartmentsSource)(store,share,dataDir,jobs):await runWebSource(store,source,share,dataDir,deps);
   if(results[i].state==='complete')store.db.prepare('INSERT INTO source_health(source,last_success) VALUES (?,?) ON CONFLICT(source) DO UPDATE SET last_success=excluded.last_success').run(source.id,new Date().toISOString());
  }catch(e){const detail=e instanceof Error?e.message:String(e);results[i]={source:source.id,state:/paused|challenge|warning/i.test(detail)?'paused':'partial',detail};}
  store.set(`sourceResults:${id}`,results);store.event(`${source.name}: ${results[i].detail}`);
 }
 }catch(e){store.event(`Scan stopped: ${String(e)}`);}finally{jobs?.fail('Scan stopped');const state=getPlan(store,id).state==='cancelled'?'cancelled':results.every(r=>r.state==='complete')?'complete':'partial';const detail=results.map(r=>`${sourceById(r.source).name}: ${r.state} — ${r.detail}`).join('\n');store.db.prepare('UPDATE plans SET state=?,detail=? WHERE id=?').run(state,detail,id);store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(id);store.event(`Scan ${state}; ${results.filter(r=>r.state!=='pending').length}/${results.length} sources handled.`);}
}
