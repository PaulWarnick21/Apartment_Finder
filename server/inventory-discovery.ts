import {searchRouteAllowed,intakeSearchUrls,sourceFilteredIntake,areaSearchRoute} from './search-area.ts';
import {load} from 'cheerio';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {hash,type Store} from './db.ts';
import {Budget} from './plans.ts';
import {SourceSession} from './transport.ts';
import {allowedUrl,expandedSource,type Source} from './sources.ts';
import {discoveryCards,listingUrl,nextDiscovery,inventoryEndpoint,inventoryUrls,discoveryEnd,discoveryEmpty,facetPagination} from './source-discovery.ts';
import {mergeDiscovery,readQueue} from './discovery-queue.ts';
import type {ChromeJobClient} from './chrome-jobs.ts';
import type {ScanDependencies,SourceResult} from './regular-worker.ts';
import {prioritizeInventoryAreas} from './area-mix-routing.ts';
import {austevilleScopedFeed,austevilleScopedCards} from './austeville-discovery.ts';
import {isLocalScanStop} from './scan-stop.ts';
import {facebookSearchSnapshot} from './facebook-discovery.ts';

export type InventoryRoute={url:string;next:string|null;visited:string[];pages:number;recognized:number;facebookCardUrls?:string[];status:'pending'|'partial'|'exhausted'|'unverified'|'blocked'|'superseded';supersededBy?:string[];refreshNeeded?:boolean;dynamicPending?:boolean;advertisedTotal?:number;checkedAt?:string;noCardsFailures?:number;retryAt?:string;detail:string};
const noCardsMessage='No listing cards recognized; empty inventory is not established';
const noCardsDelay=(failures:number)=>failures===1?300000:failures===2?900000:3600000;
export function inventoryRoutes(store:Store,source:Source,now=Date.now()):InventoryRoute[]{
 const saved=store.get<InventoryRoute[]>(`inventoryCoverage:${source.id}`)??[];
 const roots=sourceFilteredIntake(store)?intakeSearchUrls(store,source):[source.search,...(source.expandedSearches??[])];
 for(const url of roots)if(!saved.some(r=>r.url===url))saved.push({url,next:url,visited:[],pages:0,recognized:0,status:'pending',detail:'Not yet checked'});
 return saved.filter(route=>route.status!=='superseded'&&searchRouteAllowed(store,route.url)).map(route=>{
  // Only a successfully fetched but unrecognized catalogue receives this retry.
  // Source warnings, authorization stops and other failures keep their own guards.
  if(route.status!=='blocked'||!['Error: '+noCardsMessage,noCardsMessage].includes(route.detail))return route;
  const failures=route.noCardsFailures??1,checked=Date.parse(route.checkedAt??'');
  const retryAt=route.retryAt??(Number.isFinite(checked)?new Date(checked+noCardsDelay(failures)).toISOString():undefined);
  const retained={...route,noCardsFailures:failures,retryAt};
  return retryAt&&Date.parse(retryAt)<=now?{...retained,status:'partial' as const,next:route.next??route.url,dynamicPending:true}:retained;
 });
}
function saveInventoryRoutes(store:Store,source:string,routes:InventoryRoute[]){const retained=store.get<InventoryRoute[]>(`inventoryCoverage:${source}`)??[];const merged=new Map(retained.map(route=>[route.url,route]));for(const route of routes)merged.set(route.url,route);store.set(`inventoryCoverage:${source}`,[...merged.values()]);}

export function resetInventoryCycle(store:Store,source:Source){
 const routes=inventoryRoutes(store,source).map(r=>r.next&&(r.status==='partial'||r.status==='blocked'&&r.visited.length>0)?{...r,status:'partial' as const,refreshNeeded:true,detail:'Refresh newest results, then resume saved pagination'}:{...r,next:r.url,visited:[],pages:0,recognized:0,status:'pending' as const,detail:'New inventory cycle'});
 saveInventoryRoutes(store,source.id,routes);
}
/** Follow only source-advertised regional catalogue links, never guessed URL variants. */
export function regionalRoutes(html:string,source:Source,base:string){
 const $=load(html),urls=new Set<string>();
 $('a[href]').each((_,el)=>{try{const u=new URL($(el).attr('href')!,base),label=$(el).text();
  if(!allowedUrl(u.href,source.hosts)||listingUrl(u.href,expandedSource(source)))return;
  // Numbered pages belong to the current catalogue's frontier, not separate regions.
  if(u.searchParams.has('page'))return;
  const regional=/\b(vancouver|burnaby|richmond|coquitlam|port moody|new westminster|surrey|delta)\b/i.test(label+' '+decodeURIComponent(u.pathname).replaceAll('-',' '))||source.id==='hollyburn'&&/^(?:Vancouver|North Vancouver|West Vancouver)$/i.test(u.searchParams.get('city')??'');
  const metro='(?:vancouver|north-vancouver|west-vancouver|burnaby|richmond|coquitlam|port-moody|new-westminster|surrey|delta)';
  const catalogue=source.id==='apartments'?new RegExp('^/(?:condos/|apartments/)?'+metro+'-bc/?$').test(u.pathname):source.id==='zillow'?new RegExp('^/'+metro+'-bc/rentals/?$').test(u.pathname):source.id==='vada'?/^\/search\/for-rent\/[a-z-]+\/?$/.test(u.pathname):source.id==='sunstar'?/\/property_[a-z_]+\.htm$/i.test(u.pathname):source.id==='hollyburn'?/^\/(?:find-an-apartment\/?|vancouver(?:\/[a-z-]+)*\/?)$/.test(u.pathname):source.id==='zumper'?/^\/apartments-for-rent\/[^/]+$/.test(u.pathname):source.id==='rew'?/^\/rentals\/areas\/[^/]+$/.test(u.pathname):false;
  if(regional&&catalogue){u.hash='';urls.add(u.href);}
 }catch{}});return [...urls];
}
/** Hollyburn's neighbourhood guides advertise searches but contain no unit inventory. */
export function directorySearchRoutes(html:string,source:Source,url:string){
 if(source.id!=='hollyburn'||!/^\/vancouver(?:\/[a-z-]+)*\/?$/.test(new URL(url).pathname))return [];
 const $=load(html);$('header,footer,nav,script,style,template,[hidden],[aria-hidden="true"]').remove();
 return regionalRoutes($.html(),source,url).filter(link=>/^\/find-an-apartment\/?$/.test(new URL(link).pathname)&&/^(?:Vancouver|North Vancouver|West Vancouver)$/i.test(new URL(link).searchParams.get('city')??''));
}
export async function runInventorySource(store:Store,source:Source,budget:Budget,dataDir:string,jobs?:ChromeJobClient,deps:ScanDependencies={}):Promise<SourceResult>{
 if(budget.caps.maxPhotos||budget.caps.maxAiCalls)throw new Error('Inventory-only plans cannot request photos or AI');
 const routes=inventoryRoutes(store,source),queue=readQueue(store,source.id),routeSource=expandedSource(source);
 const chrome=['apartments','zillow'].includes(source.id)&&!deps.session;
 const session=chrome?undefined:deps.session?.(source,budget,dataDir)??new SourceSession(source,budget,dataDir,{visibleChrome:source.visibleChrome});
 const save=()=>saveInventoryRoutes(store,source.id,routes);
 let dynamicCapture:{url:string;html:string}|undefined;
 try{
  if(chrome&&!jobs)throw new Error('Paired Chrome extension required for inventory');
  await session?.start();save();
  while(budget.remaining('pages')){
   const route=prioritizeInventoryAreas(store,source.id,routes.filter(r=>r.next&&['pending','partial'].includes(r.status)))[0];if(!route)break;
   const refreshing=!!route.refreshNeeded,priorNext=route.next,url=refreshing?route.url:route.next!;
   if(!refreshing&&!route.dynamicPending&&route.visited.includes(url)){route.status='unverified';route.next=null;route.detail='Pagination repeated a visited page; coverage needs attention';save();continue;}
   const pagesBefore=budget.remaining('pages');
   try{
    if(sourceFilteredIntake(store)&&!areaSearchRoute(store,source.id,url))throw Error('Geographically filtered source search required; no request made');
    const capture=chrome?await jobs!.request(budget,url,'discovery',store.criteria.maxRent,0):undefined;
    if(capture?.truncated)throw new Error('Inventory capture truncated');
    const rawHtml=capture?.html??(!refreshing&&dynamicCapture?.url===url?dynamicCapture.html:await session!.html(url));if(!rawHtml)throw new Error('Inventory page unavailable');
    // Facebook's full document also contains private account/navigation state.
    const html=source.id==='facebook'?facebookSearchSnapshot(rawHtml,url).html:rawHtml;
    const dir=join(dataDir,'inventory',budget.id);await mkdir(dir,{recursive:true});await writeFile(join(dir,hash(url)+'.html'),html);
    let cards=discoveryCards(html,routeSource,url);
    for(const link of capture?.links??[]){const normalized=listingUrl(link,routeSource,url);if(normalized&&!cards.some(c=>c.url===normalized))cards.push({url:normalized});}
    const endpoint=inventoryEndpoint(html,source);if(endpoint&&session&&!sourceFilteredIntake(store))cards=[...cards,...inventoryUrls(await session.resource(endpoint),source).map(url=>({url}))];
    let scopedFeedChecked=false;
    if(!cards.length&&source.id==='austeville'&&session){
     const feed=austevilleScopedFeed(html,url);
     if(feed){const json=await session.resource(feed.endpoint);await writeFile(join(dir,hash(url)+'.json'),json);cards=austevilleScopedCards(json,source,feed.neighbourhood);scopedFeedChecked=true;}
    }
    const explicitlyEmpty=!cards.length&&(scopedFeedChecked||discoveryEmpty(html,source,url));
    if(!cards.length&&!explicitlyEmpty){
     const searches=directorySearchRoutes(html,source,url).filter(link=>searchRouteAllowed(store,link));
     if(searches.length){
      for(const link of searches)if(!routes.some(r=>r.url===link))routes.push({url:link,next:link,visited:[],pages:0,recognized:0,status:'pending',detail:'Search advertised by a checked neighbourhood guide; awaiting validation'});
      if(!route.visited.includes(url))route.visited.push(url);route.pages+=pagesBefore-budget.remaining('pages');route.checkedAt=new Date().toISOString();route.next=null;route.refreshNeeded=false;route.status='unverified';route.detail='Neighbourhood guide contains no unit inventory; following its advertised apartment search. Inventory coverage remains unverified.';save();continue;
     }
     throw new Error(noCardsMessage);
    }
    mergeDiscovery(store,source.id,queue,cards,url);
    for(const link of regionalRoutes(html,source,url).filter(link=>searchRouteAllowed(store,link)))if(!routes.some(r=>r.url===link))routes.push({url:link,next:link,visited:[],pages:0,recognized:0,status:'pending',detail:'Source-advertised regional inventory; awaiting validation'});
    const continuation=session instanceof SourceSession&&['craigslist','easyrent','facebook'].includes(source.id)&&!refreshing?await session.inventoryContinuation():null;
    if(continuation?.html){const more=discoveryCards(continuation.html,routeSource,continuation.url);mergeDiscovery(store,source.id,queue,more,continuation.url);await writeFile(join(dir,hash(continuation.url)+'-scroll.html'),continuation.html);dynamicCapture={url:continuation.url,html:continuation.html};}
    const next=continuation?(continuation.end||continuation.unverified?null:continuation.url):capture?.next??nextDiscovery(html,source,url);
    const end=discoveryEnd(html,source,url);
    if(!refreshing)route.dynamicPending=!!continuation?.deferred;route.advertisedTotal=continuation?.total??end?.total??route.advertisedTotal;
    if(!route.visited.includes(url))route.visited.push(url);route.pages+=pagesBefore-budget.remaining('pages');
    if(source.id==='facebook'){
     route.facebookCardUrls=[...new Set([...(route.facebookCardUrls??[]),...cards.map(c=>c.url),...discoveryCards(continuation?.html??html,routeSource,continuation?.url??url).map(c=>c.url)])];
     route.recognized=route.facebookCardUrls.length;
    }else route.recognized+=cards.length;
    route.checkedAt=new Date().toISOString();queue.freshCheckedAt=route.checkedAt;
    route.noCardsFailures=0;delete route.retryAt;
    route.next=refreshing&&priorNext?priorNext:next&&allowedUrl(next,source.hosts)&&!listingUrl(next,routeSource)?next:null;route.refreshNeeded=false;
    // No Next link on a dynamic search does not demonstrate full inventory coverage.
    const facet=facetPagination(html,source);
    const finite=continuation?.end||end?.exhausted||['vada','austeville','sunstar'].includes(source.id)||source.id==='easyrent'&&(facet?facet.exhausted:!load(html)('.facetwp-type-pager,.facetwp-pager').length);
    route.status=route.next?'partial':finite||explicitlyEmpty?'exhausted':'unverified';
    route.detail=route.next?'More search pages remain':finite||explicitlyEmpty?'Accessible catalogue traversed; freshness applies only to this check':'Visible results collected; further dynamic/paginated inventory is not verified';
    if(continuation?.unverified)route.detail=continuation.unverified;
    store.set(`discoveryQueue:${source.id}`,queue);save();
   }catch(e){
    route.detail=String(e);route.checkedAt=new Date().toISOString();
    if(isLocalScanStop(e)){
     // The current page may have loaded only its first dynamic window. Keep its
     // existing frontier/refresh state so the next approved batch retries it whole.
     route.status='partial';route.pages+=pagesBefore-budget.remaining('pages');save();break;
    }
    const noCards=e instanceof Error&&e.message===noCardsMessage;
    if(noCards){route.noCardsFailures=(route.noCardsFailures??0)+1;route.retryAt=new Date(Date.now()+noCardsDelay(route.noCardsFailures)).toISOString();}
    route.status='blocked';route.pages+=pagesBefore-budget.remaining('pages');save();
    // A rendered search shell is a route-level coverage gap. Keep its evidence
    // and let other configured routes continue; source warnings still propagate.
    if(noCards){
     store.event(`${source.name}: inventory route has no recognizable listing cards at ${url}; retry after ${route.retryAt}. Other configured routes may continue. Coverage remains incomplete.`);
     continue;
    }
    throw e;
   }
  }
  return {source:source.id,state:routes.every(r=>r.status==='exhausted')?'complete':'partial',detail:`Inventory only: ${routes.reduce((n,r)=>n+r.pages,0)} pages, ${queue.urls.length} queued links; ${routes.filter(r=>r.status==='exhausted').length}/${routes.length} routes exhausted. ${routes.some(r=>r.status==='blocked')?`${routes.filter(r=>r.status==='blocked').length} routes retained for later validation; coverage remains incomplete. `:''}No photo downloads or AI calls.`};
 }finally{await session?.close();}
}
