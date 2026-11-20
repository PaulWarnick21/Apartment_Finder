import type {Store} from './db.ts';
import type {Listing} from '../src/domain.ts';
import {availabilityStages,type AvailabilityObservation} from '../src/availability.ts';
import {availabilityPostings,observationKey,type SavedPosting} from './availability-store.ts';
import {inspectAvailability} from './availability-parser.ts';
import {Budget,createPlan,approvePlan,claimPlan} from './plans.ts';
import {releaseScan} from './scan-concurrency.ts';
import {sourceById,allowedUrl,type Source} from './sources.ts';
import {SourceSession} from './transport.ts';
import type {ChromeJobClient} from './chrome-jobs.ts';

export type AvailabilitySchedule={enabled:boolean;timeZone:'America/Toronto';hour:12;authorizedAt:string;notBefore:string};
export type AvailabilityRun={day:string;state:'running'|'complete'|'partial'|'deferred';startedAt:string;finishedAt?:string;planId?:string;homes:number;postings:number;checked:number;unknown:number;detail:string};
type Target=SavedPosting&{homeId:number;listing:Listing};
type Session=Pick<SourceSession,'start'|'html'|'close'>;
export type AvailabilityDependencies={session?:(source:Source,budget:Budget,dataDir:string)=>Session;inspect?:typeof inspectAvailability};
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
  const plan=createPlan(store,{purpose:'availability',assessmentMode:'quick',trafficPolicy:'session',pacingPolicy:'conservative',sources:[...new Set(selected.map(p=>p.source))],maxPages:Math.min(selected.length,dailyAvailabilityLimits.maxPages),maxListings:Math.max(1,targets.length>1200?1200:targets.length),maxPhotos:0,maxAiCalls:0,maxReservedUsd:0,maxAddressLookups:0,stopAt:new Date(now.getTime()+dailyAvailabilityLimits.maxMinutes*60000).toISOString()});
  approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);result.planId=plan.id;store.set('availabilityRun',result);
  return {targets,selected,budget:new Budget(store,plan.id,plan.caps)};
 });
 if(!prepared)return;
 const {targets,selected,budget}=prepared;
 const sessions=new Map<string,Session>(),failedSources=new Map<string,string>();
 const save=(p:Target,finding:Pick<AvailabilityObservation,'status'|'evidence'>,attempted=true)=>store.set(observationKey(p),{source:p.source,sourceId:p.sourceId,url:p.url,...finding,checkedAt:new Date().toISOString(),runId:budget.id,attempted});
 let fatal='';
 try{
  for(const p of selected){
   budget.check();if(!budget.remaining('pages'))break;
   const currentId=store.resolveHomeId(p.homeId),current=store.db.prepare('SELECT stage FROM homes WHERE id=?').get(currentId) as {stage:string}|undefined;
   if(!current||!availabilityStages.has(current.stage))continue;
   let finding:Pick<AvailabilityObservation,'status'|'evidence'>;
   try{
    store.checkSource(p.source);if(failedSources.has(p.source))throw Error(failedSources.get(p.source)!);
    const source=sourceById(p.source);if(!allowedUrl(p.url,source.hosts))throw Error('Saved URL is outside the allowed source hosts');
    let html:string|null;
    if(!deps.session&&['apartments','zillow'].includes(p.source)){
     if(!jobs)throw Error('The app and paired Chrome extension must be running');
     const page=await jobs.request(budget,p.url,'listing',null,0,false,{factsOnly:true});
     if(page.truncated)throw Error('Listing capture was truncated');html=page.html;
    }else{
     let session=sessions.get(p.source);
     if(!session){session=deps.session?.(source,budget,dataDir)??new SourceSession(source,budget,dataDir,{visibleChrome:source.visibleChrome});sessions.set(p.source,session);await session.start();}
     html=await session.html(p.url);
     if(session instanceof SourceSession&&session.page&&new URL(session.page.url()).pathname!==new URL(p.url).pathname)throw Error('Listing redirected to a different page; saved apartment availability is unverified');
    }
    finding=(deps.inspect??inspectAvailability)(html,source,p.listing);result.checked++;
   }catch(error){const reason=String(error).slice(0,500);failedSources.set(p.source,reason);finding={status:'unknown',evidence:reason};}
   save(p,finding);if(finding.status==='unknown')result.unknown++;store.set('availabilityRun',result);
  }
 }catch(error){fatal=String(error).slice(0,500);}
 finally{
  for(const session of sessions.values())try{await session.close();}catch{fatal||='Source session cleanup failed';}
  // No stale successful observation can conceal an incomplete duplicate check today.
  for(const p of targets)if(store.get<AvailabilityObservation>(observationKey(p))?.runId!==budget.id){save(p,{status:'unknown',evidence:fatal||'Daily allowance reached or apartment left the monitored stages; not checked.'},false);result.unknown++;}
  result.state=result.unknown||fatal?'partial':'complete';result.finishedAt=new Date().toISOString();
  result.detail=`Checked ${result.checked}/${result.postings} known listings for ${result.homes} apartments; ${result.unknown} unverified.${fatal?' '+fatal:''}`;
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
