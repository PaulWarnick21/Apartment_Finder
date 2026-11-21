import type {Store} from './db.ts';
import type {Listing} from '../src/domain.ts';
import {availabilityStages,type AvailabilityObservation} from '../src/availability.ts';
import {availabilityPostings,observationKey,type SavedPosting} from './availability-store.ts';
import {inspectAvailability,availabilityRedirectMatches} from './availability-parser.ts';
import {crossPostKey,crossPostLimits,crossPostSearchRoutes,crossPostCardMatches,savedCrossPosts,sameRentalEvidence,mergeLiveCrossPost,refreshFromLivePosting,type CrossPostCheck} from './availability-crossposts.ts';
import {extractSourceOfferings} from './regular-worker.ts';
import {discoveryCards} from './source-discovery.ts';
import {Budget,createPlan,approvePlan,claimPlan} from './plans.ts';
import {releaseScan} from './scan-concurrency.ts';
import {sources,sourceById,allowedUrl,type Source} from './sources.ts';
import {SourceSession} from './transport.ts';
import type {ChromeJobClient} from './chrome-jobs.ts';

export type AvailabilitySchedule={enabled:boolean;timeZone:'America/Toronto';hour:12;authorizedAt:string;notBefore:string};
export type AvailabilityRun={day:string;state:'running'|'complete'|'partial'|'deferred';startedAt:string;finishedAt?:string;planId?:string;homes:number;postings:number;checked:number;unknown:number;searchPages?:number;unresolvedHomes?:number;detail:string};
type Target=SavedPosting&{homeId:number;listing:Listing};
type Session=Pick<SourceSession,'start'|'html'|'close'|'lastResponseStatus'>;
export type AvailabilityDependencies={session?:(source:Source,budget:Budget,dataDir:string)=>Session;inspect?:typeof inspectAvailability;searchRoutes?:typeof crossPostSearchRoutes};
export const dailyAvailabilityLimits={maxPages:240,maxMinutes:60,maxPhotos:0,maxAiCalls:0};

export function localAvailabilityDay(now:Date){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const get=(type:string)=>parts.find(p=>p.type===type)!.value;
 return {day:`${get('year')}-${get('month')}-${get('day')}`,hour:Number(get('hour'))};
}
export function availabilityDue(schedule:AvailabilitySchedule|undefined,last:AvailabilityRun|undefined,now=new Date()){
 if(!schedule?.enabled||Date.parse(schedule.notBefore)>now.getTime())return false;
 const {day,hour}=localAvailabilityDay(now);
 return hour>=12&&!(last?.day===day&&last.state!=='deferred');
}
export function availabilityTargets(store:Store):Target[]{
 const stages=[...availabilityStages];
 const ids=store.db.prepare(`SELECT id FROM homes WHERE stage IN (${stages.map(()=>'?').join(',')}) AND id NOT IN (SELECT alias FROM home_aliases)`).all(...stages) as {id:number}[];
 return ids.map(({id})=>store.home(id)!).flatMap(h=>{
  const details=store.postingDetails(h.id);
  return availabilityPostings(store,h.id).map(p=>({...p,homeId:h.id,listing:details.find(d=>d.source===p.source&&d.sourceId===p.sourceId)?.listing??{...h.listing,source:p.source,sourceId:p.sourceId,url:p.url}}));
 }).sort((a,b)=>{
  const checked=(p:Target)=>{const observation=store.get<AvailabilityObservation>(observationKey(p));return observation?.attempted===false?'':observation?.checkedAt??'';};
  return checked(a).localeCompare(checked(b))||a.source.localeCompare(b.source)||a.homeId-b.homeId;
 });
}
/** Uses the existing exclusive source lock and all normal pacing/cooldown checks. */
export async function runAvailabilityCheck(store:Store,dataDir:string,jobs?:ChromeJobClient,deps:AvailabilityDependencies={}){
 const now=new Date(),last=store.get<AvailabilityRun>('availabilityRun');
 if(!availabilityDue(store.get<AvailabilitySchedule>('availabilitySchedule'),last,now))return;
 const day=localAvailabilityDay(now).day;
 const result:AvailabilityRun={day,state:'running',startedAt:now.toISOString(),homes:0,postings:0,checked:0,unknown:0,detail:''};
 const prepared=store.transaction(()=>{
  if(!availabilityDue(store.get<AvailabilitySchedule>('availabilitySchedule'),store.get<AvailabilityRun>('availabilityRun'),now))return;
  if(store.db.prepare('SELECT 1 FROM scan_lock').get()||store.db.prepare("SELECT 1 FROM plans WHERE state IN ('approved','running')").get()){
   store.set('availabilityRun',{...result,state:'deferred',detail:'Waiting for the active scan or assessment to finish; no source requests made.'});return;
  }
  const targets=availabilityTargets(store);result.homes=new Set(targets.map(p=>p.homeId)).size;result.postings=targets.length;
  if(!targets.length){store.set('availabilityRun',{...result,state:'complete',finishedAt:now.toISOString(),detail:'No Interested or later active apartments to check.'});return;}
  // Snapshot all known duplicates; excess pages remain explicit unknowns and get priority tomorrow.
  const selected=targets;
  const plan=createPlan(store,{purpose:'availability',assessmentMode:'quick',trafficPolicy:'session',pacingPolicy:'conservative',sources:sources.map(s=>s.id),maxPages:dailyAvailabilityLimits.maxPages,maxListings:Math.max(1,targets.length>1200?1200:targets.length),maxPhotos:0,maxAiCalls:0,maxReservedUsd:0,maxAddressLookups:0,stopAt:new Date(now.getTime()+dailyAvailabilityLimits.maxMinutes*60000).toISOString()});
  approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);result.planId=plan.id;store.set('availabilityRun',result);
  return {targets,selected,budget:new Budget(store,plan.id,plan.caps)};
 });
 if(!prepared)return;
 const {targets,selected,budget}=prepared;
 const sessions=new Map<string,Session>(),failedSources=new Map<string,string>();
 const save=(p:Target,finding:Pick<AvailabilityObservation,'status'|'evidence'>,attempted=true)=>store.set(observationKey(p),{source:p.source,sourceId:p.sourceId,url:p.url,...finding,checkedAt:new Date().toISOString(),runId:budget.id,attempted});
 const fresh=new Map<string,Listing>();
 const fetchPage=async(sourceId:string,url:string,listing?:Listing,kind:'search'|'listing'='listing')=>{
  budget.check();store.checkSource(sourceId);if(failedSources.has(sourceId))throw Error(failedSources.get(sourceId)!);
  const source=sourceById(sourceId);if(!allowedUrl(url,source.hosts))throw Error('Saved URL is outside the allowed source hosts');
  let html:string|null,httpStatus:number|undefined,finalUrl=url;
  if(!deps.session&&['apartments','zillow'].includes(sourceId)){
   if(!jobs)throw Error('The app and paired Chrome extension must be running');
   const page=await jobs.request(budget,url,kind==='search'?'discovery':'listing',null,0,false,{factsOnly:true});
   if(page.truncated)throw Error('Listing capture was truncated');html=page.html;
  }else{
   let session=sessions.get(sourceId);
   if(!session){session=deps.session?.(source,budget,dataDir)??new SourceSession(source,budget,dataDir,{visibleChrome:source.visibleChrome});sessions.set(sourceId,session);await session.start();}
   html=await session.html(url,{availability:true});httpStatus=session.lastResponseStatus;
   if(session instanceof SourceSession&&session.page){finalUrl=session.page.url();if(listing?!availabilityRedirectMatches(html,source,listing,finalUrl):kind==='search'&&new URL(finalUrl).pathname!==new URL(url).pathname)throw Error('Listing redirected to a different page; saved apartment availability is unverified');}
  }
  return {html,httpStatus,source,finalUrl};
 };
 const visit=async(p:Target)=>{
  let finding:Pick<AvailabilityObservation,'status'|'evidence'>;
  try{
   const {html,httpStatus,source}=await fetchPage(p.source,p.url,p.listing);
   finding=(deps.inspect??inspectAvailability)(html,source,p.listing,httpStatus);result.checked++;
   if(finding.status==='available'&&html)try{const live=extractSourceOfferings(source,html,p.url).find(l=>l.sourceId===p.sourceId);if(live)fresh.set(observationKey(p),live);}catch{/* No factual refresh without a scoped parse. */}
  }catch(error){const reason=String(error).slice(0,500);failedSources.set(p.source,reason);finding={status:'unknown',evidence:reason};}
  save(p,finding);if(finding.status==='unknown')result.unknown++;store.set('availabilityRun',result);
  return finding;
 };
 let fatal='';
 try{
  for(const p of selected){
   budget.check();if(!budget.remaining('pages'))break;
   const currentId=store.resolveHomeId(p.homeId),current=store.db.prepare('SELECT stage FROM homes WHERE id=?').get(currentId) as {stage:string}|undefined;
   if(!current||!availabilityStages.has(current.stage))continue;
   await visit(p);
  }
  // Expiry is a trigger to check other sources, not an apartment-level verdict.
  for(const id of new Set(targets.map(p=>store.resolveHomeId(p.homeId)))){
   const home=store.home(id);if(!home||!availabilityStages.has(home.stage))continue;
   const observations=()=>availabilityPostings(store,id).map(p=>store.get<AvailabilityObservation>(observationKey(p))).filter((p):p is AvailabilityObservation=>!!p&&p.runId===budget.id);
   if(!observations().some(p=>p.status==='unavailable'))continue;
   const checkedAt=new Date().toISOString(),urls=observations().map(p=>p.url);
   const record=(state:CrossPostCheck['state'],detail:string)=>store.set(crossPostKey(id),{checkedAt,state,urls:[...new Set(urls)],detail} satisfies CrossPostCheck);
   record('incomplete','An expired posting was found; checking other sources before drawing an apartment-wide conclusion.');
   let live=observations().find(p=>p.status==='available');
   if(live){const update=fresh.get(observationKey(live));if(update&&observations().some(p=>p.source===home.listing.source&&p.sourceId===home.listing.sourceId&&p.status==='unavailable'))refreshFromLivePosting(store,id,update,live.checkedAt);record('live-found','Another confirmed posting is still advertised.');continue;}
   const startPages=budget.remaining('pages'),room=()=>budget.remaining('pages')>0&&startPages-budget.remaining('pages')<crossPostLimits.pagesPerHome;
   const peers=savedCrossPosts(store,id);let pending=false;
   for(const peer of peers){
    if(!room()){pending=true;break;}budget.check();
    const p={source:peer.listing.source,sourceId:peer.listing.sourceId,url:peer.listing.url,listing:peer.listing,homeId:id};
    urls.push(p.url);result.postings++;const finding=await visit(p);if(finding.status==='unknown')pending=true;
    if(finding.status!=='available')continue;
    const update=fresh.get(observationKey(p));if(!update||!sameRentalEvidence(home.listing,update)){pending=true;continue;}
    try{mergeLiveCrossPost(store,id,peer.homeId,update,store.get<AvailabilityObservation>(observationKey(p))!);live=store.get<AvailabilityObservation>(observationKey(p));break;}catch{pending=true;}
   }
   if(live){record('live-found','Matching live cross-post merged; current advertised facts updated.');continue;}
   const known=observations();
   if(!pending&&known.length===availabilityPostings(store,id).length&&known.every(p=>p.status==='unavailable')&&new Set(known.map(p=>p.source)).size>=2){record('checked','All confirmed postings were explicitly unavailable on multiple sources.');continue;}
   // No verified alternative in saved records: inspect a bounded set of supported
   // public source searches. A partial inventory can find a match, never prove absence.
   for(const route of (deps.searchRoutes??crossPostSearchRoutes)(store,home.listing)){
    if(!room())break;budget.check();urls.push(route.url);
    try{
     const {html,source}=await fetchPage(route.source,route.url,undefined,'search');result.searchPages=(result.searchPages??0)+1;
     if(!html)continue;
     const candidates=discoveryCards(html,source,route.url).filter(card=>crossPostCardMatches(home.listing,card)).slice(0,crossPostLimits.detailsPerSearch);
     for(const card of candidates){
      if(!room())break;budget.check();urls.push(card.url);
      const page=await fetchPage(route.source,card.url);if(!page.html)continue;
      for(const candidate of extractSourceOfferings(source,page.html,card.url)){
       if(!availabilityRedirectMatches(page.html,source,candidate,page.finalUrl)||!sameRentalEvidence(home.listing,candidate)||inspectAvailability(page.html,source,candidate,page.httpStatus).status!=='available')continue;
       const existing=store.db.prepare('SELECT home_id FROM postings WHERE source=? AND source_id=?').get(candidate.source,candidate.sourceId) as {home_id:number}|undefined;
       const peerId=existing?store.resolveHomeId(existing.home_id):undefined;
       const observation:AvailabilityObservation={source:candidate.source,sourceId:candidate.sourceId,url:candidate.url,status:'available',checkedAt:new Date().toISOString(),runId:budget.id,evidence:'Same unit found still advertised during cross-source expiry verification.',attempted:true};
       if(peerId!==undefined)mergeLiveCrossPost(store,id,peerId,candidate,observation);
       else store.transaction(()=>{
        const current=store.home(id);if(!current||!availabilityStages.has(current.stage)||!sameRentalEvidence(current.listing,candidate))throw Error('Apartment changed during verification');
        store.db.prepare('INSERT INTO postings(source,source_id,home_id,url,fingerprint) VALUES (?,?,?,?,?)').run(candidate.source,candidate.sourceId,id,candidate.url,'');
        store.db.prepare('INSERT INTO posting_details(source,source_id,home_id,listing,captured_at) VALUES (?,?,?,?,?)').run(candidate.source,candidate.sourceId,id,JSON.stringify(candidate),observation.checkedAt);
        store.set(observationKey(candidate),observation);refreshFromLivePosting(store,id,candidate,observation.checkedAt);
       });
       live=observation;break;
      }
      if(live)break;
     }
    }catch(error){failedSources.set(route.source,String(error).slice(0,500));}
    if(live)break;
   }
   if(live)record('live-found','Matching live posting found on another source; advertised facts updated.');
   else {result.unresolvedHomes=(result.unresolvedHomes??0)+1;record('incomplete','Other-source checks did not establish a live replacement. Coverage is incomplete; the apartment is not confirmed unavailable.');}
  }
 }catch(error){fatal=String(error).slice(0,500);}
 finally{
  for(const session of sessions.values())try{await session.close();}catch{fatal||='Source session cleanup failed';}
  // No stale successful observation can conceal an incomplete duplicate check today.
  for(const p of targets)if(store.get<AvailabilityObservation>(observationKey(p))?.runId!==budget.id){save(p,{status:'unknown',evidence:fatal||'Daily allowance reached or apartment left the monitored stages; not checked.'},false);result.unknown++;}
  result.state=result.unknown||result.unresolvedHomes||fatal?'partial':'complete';result.finishedAt=new Date().toISOString();
  result.detail=`Checked ${result.checked}/${result.postings} known listings for ${result.homes} apartments; ${result.unknown} unverified. ${result.searchPages??0} cross-source search pages; ${result.unresolvedHomes??0} apartments need further expiry verification.${fatal?' '+fatal:''}`;
  store.set('availabilityRun',result);store.db.prepare('UPDATE plans SET state=?,detail=? WHERE id=?').run(result.state,result.detail,budget.id);releaseScan(store,budget.id);
  store.event('Daily availability check: '+result.detail);
 }
 return result;
}

export class AvailabilityMonitor{
 private timer:ReturnType<typeof setInterval>|undefined;
 private active:Promise<unknown>|undefined;
 constructor(private store:Store,private dataDir:string,private jobs:ChromeJobClient,demo=false){
  // Constructor/startup is offline. Authorization is separate from discovery schedules.
  if(!demo){this.timer=setInterval(()=>this.tick(),60000);this.timer.unref();}
 }
 private tick(){if(this.active)return;this.active=runAvailabilityCheck(this.store,this.dataDir,this.jobs).catch(error=>this.store.event('Availability check could not start: '+String(error).slice(0,300))).finally(()=>{this.active=undefined;});}
 async close(){clearInterval(this.timer);if(this.active){const run=this.store.get<AvailabilityRun>('availabilityRun');if(run?.state==='running'&&run.planId){this.store.db.prepare("UPDATE plans SET state='cancelled' WHERE id=?").run(run.planId);this.jobs.fail('Availability check stopped with the app',run.planId);}await this.active;}}
}
