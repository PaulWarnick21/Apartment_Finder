import type {Store} from './db.ts';
import {randomUUID} from 'node:crypto';
import type {ScanProcesses} from './scan-process.ts';
import {createPlan,approvePlan,getPlan,recoverInterrupted} from './plans.ts';
import {scannerOccupied} from './supervisor-admission.ts';
import {sources} from './sources.ts';
import {areaSearchRoutes,scanAreaExclusion} from './search-area.ts';
import {readQueue} from './discovery-queue.ts';
import {inventoryRoutes} from './inventory-discovery.ts';
import {quickRank} from './quick-rank.ts';
import {availabilityDue,type AvailabilityRun,type AvailabilitySchedule} from './availability-monitor.ts';
import {discoveryAuthorized,discoveryWindowEnd,discoveryLimits,sourceCadence,pauseLowYield,type DiscoverySchedule} from './discovery-schedule-policy.ts';

type Run={plan_id:string;source:string;started_at:string;finished_at:string|null;settled:number};
export type ScheduledSource={since:string;checks:number;dryStreak:number;nextAt:string;paused?:string;lastDetail?:string;cadenceMinutes?:number};
export function ensureDiscoverySchedule(store:Store){store.db.exec(`
 CREATE TABLE IF NOT EXISTS scheduled_discovery_runs(plan_id TEXT PRIMARY KEY REFERENCES plans(id),source TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,settled INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS scheduled_discovery_yield(home_id INTEGER PRIMARY KEY REFERENCES homes(id),source TEXT NOT NULL,first_seen TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS scheduled_discovery_time ON scheduled_discovery_runs(started_at);
 CREATE INDEX IF NOT EXISTS scheduled_discovery_yield_time ON scheduled_discovery_yield(source,first_seen);
`);}
function sourceState(store:Store,source:string,now:Date):ScheduledSource{return store.get<ScheduledSource>('scheduledSource:'+source)??{since:now.toISOString(),checks:0,dryStreak:0,nextAt:now.toISOString()};}
function validHome(store:Store,id:number){
 if(store.resolveHomeId(id)!==id)return undefined;
 const home=store.home(id);return home&&!home.deskExclusion&&quickRank(home.listing,store.criteria,id).eligible&&home.listing.photos.some(p=>p.local)?home:undefined;
}
export function sourceYield(store:Store,source:string,now:Date){
 const since=new Date(now.getTime()-72*3600000).toISOString();
 // Yield checks use an indexed local summary, never materialize every home/gallery each minute.
 const valid=Number((store.db.prepare(`SELECT COUNT(*) AS n FROM scheduled_discovery_yield y JOIN homes h ON h.id=y.home_id LEFT JOIN desk_membership d ON d.home_id=h.id WHERE y.source=? AND y.first_seen>=? AND h.id NOT IN (SELECT alias FROM home_aliases) AND COALESCE(d.category,'')!='Excluded'`).get(source,since) as {n:number}).n);
 const attempts=(store.db.prepare('SELECT p.usage FROM scheduled_discovery_runs r JOIN plans p ON p.id=r.plan_id WHERE r.source=? AND r.started_at>=?').all(source,since) as {usage:string}[]).reduce((n,r)=>n+JSON.parse(r.usage).listings,0);
 return {valid,attempts};
}
/** Count actual use after completion and reserve entire caps while outstanding. Across midnight/restarts. */
export function scheduledUsage(store:Store,now:Date,source?:string){
 const rows=store.db.prepare(`SELECT p.usage,p.caps,p.state FROM scheduled_discovery_runs r JOIN plans p ON p.id=r.plan_id WHERE COALESCE(r.finished_at,r.started_at)>=?${source?' AND r.source=?':''}`).all(new Date(now.getTime()-86400000).toISOString(),...(source?[source]:[])) as {usage:string;caps:string;state:string}[];
 return rows.reduce((total,row)=>{const u=JSON.parse(row.usage),c=JSON.parse(row.caps),reserved=['draft','approved','running'].includes(row.state);for(const k of ['pages','listings','photos'] as const)total[k]+=reserved?c[{pages:'maxPages',listings:'maxListings',photos:'maxPhotos'}[k]]:u[k];return total;},{pages:0,listings:0,photos:0});
}
export function seedScheduledYield(store:Store,now=new Date()){
 ensureDiscoverySchedule(store);
 const rows=store.db.prepare('SELECT id FROM homes WHERE first_seen>=? AND id NOT IN (SELECT alias FROM home_aliases)').all(new Date(now.getTime()-72*3600000).toISOString()) as {id:number}[];
 for(const {id} of rows){const home=validHome(store,id);if(home)store.db.prepare('INSERT OR IGNORE INTO scheduled_discovery_yield VALUES (?,?,?)').run(id,home.listing.source,home.firstSeen);}
}
export function discoveryScheduleStatus(store:Store,now=new Date()){
 ensureDiscoverySchedule(store);return {schedule:store.get<DiscoverySchedule>('scanSchedule'),windowEnd:discoveryWindowEnd(now)?.toISOString()??null,limits:discoveryLimits,usage24h:scheduledUsage(store,now),sources:sources.map(s=>({source:s.id,...sourceState(store,s.id,now),...sourceYield(store,s.id,now),health:store.health().find(h=>h.source===s.id)})),active:store.db.prepare('SELECT plan_id,source,started_at FROM scheduled_discovery_runs WHERE settled=0').all()};
}
type Runner=Pick<ScanProcesses,'hasActive'|'assertCanStart'|'start'>;
/** Deterministic app timer. Construction and configuration never start network work. */
export class DiscoveryScheduler{
 private timer:ReturnType<typeof setInterval>|undefined;
 private busy=false;
 constructor(private store:Store,private runner:Runner,options:{demo?:boolean;timer?:boolean}={}){
  ensureDiscoverySchedule(store);if(!options.demo&&options.timer!==false){this.timer=setInterval(()=>{try{this.tick();}catch(error){store.event('Scheduled discovery needs attention: '+String(error).slice(0,300));}},60000);this.timer.unref();}
 }
 private settle(now:Date){
  const runs=this.store.db.prepare('SELECT * FROM scheduled_discovery_runs WHERE settled=0').all() as Run[];
  for(const run of runs){
   let plan=getPlan(this.store,run.plan_id);
   if(['approved','running'].includes(plan.state)){
    const schedule=this.store.get<DiscoverySchedule>('scanSchedule');
    if(!discoveryAuthorized(schedule,now)||Date.parse(plan.caps.stopAt!)<=now.getTime()){
     if(this.runner.hasActive){this.store.db.prepare("UPDATE plans SET state='cancelled',detail=? WHERE id=?").run('Scheduled window or batch deadline ended; saved work retained.',plan.id);continue;}
     const lock=this.store.db.prepare('SELECT owner,heartbeat FROM scan_lock').get() as {owner:string;heartbeat:string}|undefined;
     if(lock&&(lock.owner===plan.id||plan.caps.parallelGroup&&lock.owner==='parallel:'+plan.caps.parallelGroup)&&now.getTime()-Date.parse(lock.heartbeat)>600000)recoverInterrupted(this.store);
     else if(!lock)this.store.db.prepare("UPDATE plans SET state='interrupted',detail=? WHERE id=?").run('Scheduled worker ended before completion; saved work retained.',plan.id);
     else continue;
     plan=getPlan(this.store,plan.id);
    }else continue;
   }
   if(this.runner.hasActive||this.store.db.prepare('SELECT 1 FROM scan_lock WHERE owner=?').get(plan.id))continue;
   const progress=this.store.get<{sources:Record<string,{newHomeIds:number[]}>}>('newListingValidation:'+plan.id);
   let found=0;
   for(const id of [...(progress?.sources[run.source]?.newHomeIds??[]),...(plan.caps.resumeHomeIds??[])]){
    const h=validHome(this.store,id);if(!h)continue;
    found+=Number(this.store.db.prepare('INSERT OR IGNORE INTO scheduled_discovery_yield VALUES (?,?,?)').run(id,h.listing.source,h.firstSeen).changes);
   }
   const state=sourceState(this.store,run.source,now),q=readQueue(this.store,run.source);
   const continuation=plan.caps.phase==='inventory'&&(q.urls.length||q.offerings?.length)&&!['cancelled','interrupted'].includes(plan.state);
   if(!continuation){state.checks++;state.dryStreak=found?0:state.dryStreak+1;}
   const stats=sourceYield(this.store,run.source,now);
   state.cadenceMinutes=sourceCadence(stats.valid,stats.attempts,state.dryStreak);
   state.nextAt=new Date(now.getTime()+(continuation?0:state.cadenceMinutes*60000)).toISOString();state.lastDetail=plan.detail.slice(0,800);
   if(pauseLowYield(stats.valid,state.checks,state.since,now))state.paused='Fewer than two valid apartments in 72 hours; paused for review.';
   if(plan.state==='cancelled'&&!plan.detail.startsWith('Scheduled window'))state.paused='User cancelled this source; explicit resume required.';
   if(['interrupted'].includes(plan.state))state.nextAt=new Date(now.getTime()+3600000).toISOString();
   this.store.transaction(()=>{this.store.set('scheduledSource:'+run.source,state);this.store.db.prepare('UPDATE scheduled_discovery_runs SET settled=1,finished_at=? WHERE plan_id=?').run(now.toISOString(),plan.id);});
   this.store.event(`Scheduled ${run.source}: ${found} new valid photo-collected apartments; ${state.paused??'next check after '+state.nextAt}`);
  }
 }
 tick(now=new Date()){
  if(this.busy)return;this.busy=true;
  try{
   this.settle(now);
   if(!discoveryAuthorized(this.store.get<DiscoverySchedule>('scanSchedule'),now)||this.runner.hasActive||scannerOccupied(this.store))return;
   // Give the separately authorized noon availability check first access to the source lane.
   if(availabilityDue(this.store.get<AvailabilitySchedule>('availabilitySchedule'),this.store.get<AvailabilityRun>('availabilityRun'),now))return;
   const due=sources.filter(source=>{
    const state=sourceState(this.store,source.id,now);if(state.paused||Date.parse(state.nextAt)>now.getTime()||!areaSearchRoutes(this.store,source.id).length)return false;
    const stats=sourceYield(this.store,source.id,now);if(pauseLowYield(stats.valid,state.checks,state.since,now)){state.paused='Fewer than two valid apartments in 72 hours; paused for review.';this.store.set('scheduledSource:'+source.id,state);return false;}
    try{this.store.checkSource(source.id);}catch{return false;}
    if(source.visibleChrome||['apartments','zillow'].includes(source.id)){const runtime=this.store.get<{lastSeenAt:string}>('browserExtensionRuntime');if(!runtime||now.getTime()-Date.parse(runtime.lastSeenAt)>120000)return false;}
    return true;
   }).sort((a,b)=>sourceState(this.store,a.id,now).nextAt.localeCompare(sourceState(this.store,b.id,now).nextAt));
   const group=randomUUID(),admittedPlans:string[]=[];let sharedChrome=false;
   for(const source of due){
    if(admittedPlans.length>=3)break;
    if(sharedChrome&&['apartments','zillow'].includes(source.id))continue;
    const admitted=this.store.transaction(()=>{
     const foreign=(this.store.db.prepare("SELECT caps FROM plans WHERE state IN ('approved','running')").all() as {caps:string}[]).some(p=>JSON.parse(p.caps).parallelGroup!==group);
     if(foreign||!discoveryAuthorized(this.store.get<DiscoverySchedule>('scanSchedule'),now))return;
     const global=scheduledUsage(this.store,now),own=scheduledUsage(this.store,now,source.id),limit=source.id==='facebook'?discoveryLimits.facebook:discoveryLimits.source;
     const remaining={pages:Math.min(discoveryLimits.global.pages-global.pages,limit.pages-own.pages),listings:Math.min(discoveryLimits.global.listings-global.listings,limit.listings-own.listings),photos:Math.min(discoveryLimits.global.photos-global.photos,limit.photos-own.photos)};
     if(remaining.pages<1||remaining.listings<1||remaining.photos<1)return;
     const queue=readQueue(this.store,source.id);
     const owned=this.store.db.prepare("SELECT DISTINCT h.id FROM homes h JOIN meta m ON m.key='pendingGallery:'||h.id WHERE h.first_seen>=? AND json_extract(h.listing,'$.source')=? AND h.stage='Unreviewed' AND h.id NOT IN (SELECT alias FROM home_aliases)").all(this.store.get<DiscoverySchedule>('scanSchedule')!.authorizedAt,source.id) as {id:number}[];
     const resume=owned.filter(({id})=>{const h=this.store.home(id)!;return !scanAreaExclusion(this.store,h.listing)&&quickRank(h.listing,this.store.criteria,id).eligible&&(this.store.get<number>('scheduledGalleryTries:'+id)??0)<3;}).slice(0,3).map(r=>r.id);
     const phase=queue.urls.length||queue.offerings?.length||resume.length?'assessment':'inventory';
     if(phase==='inventory'){
      // Restart only checked terminal routes; retain unfinished pagination, errors and pauses.
      const routes=inventoryRoutes(this.store,source),key='inventoryCoverage:'+source.id,retained=this.store.get<any[]>(key)??[],merged=new Map(retained.map(r=>[r.url,r]));
      for(const r of routes)if(!r.next&&['exhausted','unverified'].includes(r.status))merged.set(r.url,{...r,next:r.url,visited:[],pages:0,recognized:0,status:'pending',refreshNeeded:false,dynamicPending:false,detail:'Scheduled bounded refresh'});
      this.store.set(key,[...merged.values()]);
     }
     const stopAt=new Date(Math.min(discoveryWindowEnd(now)!.getTime(),now.getTime()+discoveryLimits.batch.minutes*60000)).toISOString();
     const plan=createPlan(this.store,{purpose:'listings',billingMode:'chatgpt',trafficPolicy:'session',assessmentMode:'quick',pacingPolicy:'adaptive',parallelGroup:group,sources:[source.id],phase,queuePolicy:'balanced',maxPages:Math.min(source.id==='facebook'?12:discoveryLimits.batch.pages,remaining.pages),maxListings:Math.min(discoveryLimits.batch.listings,remaining.listings),maxPhotos:phase==='inventory'?0:Math.min(discoveryLimits.batch.photos,remaining.photos),maxAiCalls:0,maxAddressLookups:0,maxReservedUsd:0,stopAt,newListingsOnly:phase==='assessment',unitListingsOnly:true,resumeHomeIds:resume,refreshActiveListings:false,maxRefreshListings:0});
     this.store.set('scheduledPlan:'+plan.id,true);
     this.store.db.prepare('INSERT INTO scheduled_discovery_runs(plan_id,source,started_at) VALUES (?,?,?)').run(plan.id,source.id,now.toISOString());
     this.runner.assertCanStart(plan.id);approvePlan(this.store,plan.id,'APPROVE ONE SCAN');
     for(const id of resume)this.store.set('scheduledGalleryTries:'+id,(this.store.get<number>('scheduledGalleryTries:'+id)??0)+1);
     return plan;
    });
    if(admitted){admittedPlans.push(admitted.id);if(['apartments','zillow'].includes(source.id))sharedChrome=true;}
   }
   for(const id of admittedPlans)try{this.runner.start(id);}catch(error){this.store.db.prepare("UPDATE plans SET state='interrupted',detail=? WHERE id=?").run('Scheduled process failed to launch: '+String(error).slice(0,300),id);}
   return admittedPlans[0];
  }finally{this.busy=false;}
 }
 close(){clearInterval(this.timer);}
}
