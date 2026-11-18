import {mkdirSync,writeFileSync} from 'node:fs';
import {Store} from '../server/db.ts';
import {sources} from '../server/sources.ts';
import {getPlan} from '../server/plans.ts';
import {readQueue,balanceQueue,saveQueue} from '../server/discovery-queue.ts';
import {inventoryRoutes,resetInventoryCycle} from '../server/inventory-discovery.ts';
import {hardFailure,pendingHomes,pendingCollectionHomes} from '../server/regular-worker.ts';
import {assertFeedbackReady} from '../server/feedback-learning.ts';
import {deskCategory} from '../src/desk-category.ts';
import {checkedInventoryCaughtUp,chooseQuickCatchupPhase,chooseCatchupPhase,phaseSourceVisits,effectiveRunPolicy,type RunPolicy} from '../server/catchup-policy.ts';
import {quickCatchupBatch} from '../server/catchup-batch.ts';
import {catchupAreaWork} from '../server/area-mix-routing.ts';
import {postingAgeRank} from '../server/listing-age.ts';
import {effectiveUsagePolicy,type UsagePolicy} from '../server/usage-guard.ts';
import {type SourceSelectionState} from '../server/source-yield.ts';
import {savedSourceYieldStats} from '../server/source-feedback.ts';
import {assertArchivedOperation} from '../server/archived-operations.ts';

// Keep the original initialization as history, without reusing its expired approval.
if(process.argv[2]==='init')assertArchivedOperation('November 16 catch-up initialization',process.argv[2]);
const store=new Store('data/live/apartments.sqlite'),action=process.argv[2]??'status',used=Number(process.argv[3]);
const key='scanProgramme',directory='data/live/catchup-2026-11-16';mkdirSync(directory,{recursive:true});
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
type Programme=UsagePolicy&RunPolicy&{enabled:boolean;authorizedAt:string;targetDate:string;dailyAt:string;timezone:string;day:string;maintenanceCycle?:boolean;plans:string[];lastSource:Record<string,string>;attemptedGalleries:number[];lastUsage?:{at:string;usedPercent:number};automationId?:string};
let programme=store.get<Programme>(key);
const quick=()=>store.get<{mode:string}>('reviewWorkflow')?.mode==='quick-first';
const save=()=>store.set(key,programme);
const request=async(path:string,body?:unknown,csrf?:string)=>{const r=await fetch('http://127.0.0.1:4317/api/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(csrf?{'x-af-token':csrf}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const result=await r.json() as any;if(!r.ok)throw new Error(JSON.stringify(result));return result;};
const policy=()=>effectiveUsagePolicy(programme??{stopAt:88});
const executionPolicy=()=>programme?effectiveRunPolicy(programme):undefined;
const safe=()=>{const {stopAt}=policy();if(!Number.isFinite(used)||used<0||used>=stopAt)throw new Error(`Fresh measured weekly usage below ${stopAt}% is required; never estimate it.`);};
const active=()=>programme!.plans.map(id=>getPlan(store,id)).find(p=>['approved','running'].includes(p.state));
function coverageRows(){return sources.map(s=>{const q=readQueue(store,s.id),routes=inventoryRoutes(store,s),pending=quick()?pendingCollectionHomes(store,s.id):pendingHomes(store,s.id).filter(h=>!hardFailure(h.listing,store.criteria));return {source:s.id,queued:q.urls.length+(q.offerings?.length??0),pendingEvidence:pending.length,routes:routes.map(({url,status,pages,recognized,detail,checkedAt})=>({url,status,pages,recognized,detail,checkedAt})),extractionIssues:(store.get<any[]>(`candidateFailures:${s.id}`)??[]).filter(f=>f.kind==='parse').length};});}
function status(){
 const homes=store.homes(),rows=coverageRows();
 const plans=programme?.plans.map(id=>getPlan(store,id))??[];const totals=Object.fromEntries(['pages','listings','photos','aiCalls'].map(k=>[k,plans.reduce((n,p)=>n+p.usage[k],0)]));
 const uncovered=!checkedInventoryCaughtUp(rows),last=plans.at(-1);
 const result={programme,creditPolicy:policy(),executionPolicy:executionPolicy(),totals,latestPlan:last&&{id:last.id,state:last.state,detail:last.detail},active:plans.filter(p=>['approved','running'].includes(p.state)).map(p=>({id:p.id,state:p.state,caps:p.caps,usage:p.usage,sources:p.sources})),queue:rows.reduce((n,s)=>n+s.queued,0),activeDesk:homes.filter(h=>!['Excluded','Closed'].includes(deskCategory(h))).length,coverage:rows,phase:rows.some(r=>r.queued)?'catch-up':uncovered?'discovered queue assessed; coverage/evidence gaps remain':'caught up with checked inventory'};
 writeFileSync(directory+'/status.json',JSON.stringify(result,null,2));return result;
}
try{
 if(action==='init'){
  if(programme)throw new Error('Programme already exists; inspect it rather than duplicate authorization');
  safe();await store.backupTo(directory+'/before.sqlite');
  programme={enabled:true,authorizedAt:new Date().toISOString(),targetDate:'2026-11-21',dailyAt:'08:00',timezone:'America/Toronto',day:day(),plans:[],lastSource:{},attemptedGalleries:[],dailyCaps:{pages:600,listings:400,photos:8000,aiCalls:1500},stopAt:88};save();
  store.event('User authorized Vancouver catch-up towards November 21, followed by daily morning new-listing scans. Fresh weekly usage guard, bounded daily work and source pauses required.');
  console.log(JSON.stringify(programme));
 }else if(action==='status'){console.log(JSON.stringify(status()));}
 else if(action==='summary'){
  const s=status(),fresh=store.homes().filter(h=>programme&&h.firstSeen>=programme.authorizedAt),full=fresh.filter(h=>h.listing.galleryComplete&&h.listing.photos.length>0&&h.listing.photos.length>=(h.listing.expectedPhotos??h.listing.photos.length)&&h.listing.photos.every(p=>p.status==='reviewed'&&!p.attributionPending)),filtered=fresh.filter(h=>!full.some(f=>f.id===h.id)&&hardFailure(h.listing,store.criteria));
  console.log(JSON.stringify({at:new Date().toISOString(),totals:s.totals,latestPlan:s.latestPlan,newHomes:fresh.length,fullyAssessed:full.length,factsFiltered:filtered.length,incomplete:fresh.filter(h=>!full.some(f=>f.id===h.id)&&!filtered.some(f=>f.id===h.id)).length,activeDesk:s.activeDesk,queue:s.queue,phase:s.phase,active:s.active.map(p=>({id:p.id,state:p.state,phase:p.caps.phase,source:p.caps.sources[0],usage:p.usage})),sources:s.coverage.map(r=>({source:r.source,queued:r.queued,exhausted:r.routes.filter(x=>x.status==='exhausted').length,routes:r.routes.length,issues:r.extractionIssues}))}));
 }
 else if(action==='stop-phase'){
  if(!programme)throw new Error('Programme not initialized');const p=active();if(p){store.db.prepare("UPDATE plans SET state='cancelled',detail='Phase stopped by operator; completed findings and queued work retained' WHERE id=? AND state IN ('approved','running')").run(p.id);store.event('Stopped current programme phase; recurring authorization and completed work retained.');}console.log(JSON.stringify({stopped:p?.id,workerActive:!!store.db.prepare('SELECT 1 FROM scan_lock').get()}));
 }
 else if(action==='tick'){
  if(!programme)throw new Error('Programme not initialized');const p=active();
  if(p){const limit=policy(),allowed=programme.enabled&&Number.isFinite(used)&&used>=0&&used<limit.stopAt;store.set(`usageGuard:${p.id}`,{checkedAt:Date.now(),usedPercent:allowed?used:100,...limit,allowAiThrough:p.usage.aiCalls+(allowed?1:0)});if(!allowed)store.db.prepare("UPDATE plans SET state='cancelled',detail='Credit limit reached or programme paused; progress retained' WHERE id=?").run(p.id);}
  programme.lastUsage={at:new Date().toISOString(),usedPercent:Number.isFinite(used)?used:100};save();
  console.log(JSON.stringify({plan:p?.id,state:p&&getPlan(store,p.id).state,usage:p&&getPlan(store,p.id).usage,creditPolicy:policy(),executionPolicy:executionPolicy(),active:!!store.db.prepare('SELECT 1 FROM scan_lock').get()}));
 }else if(action==='next'){
  if(!programme?.enabled)throw new Error('Programme not enabled');if(!quick())safe();
  if(active()||store.db.prepare('SELECT 1 FROM scan_lock').get())throw new Error('A phase is active or needs interrupted-run recovery');
  if(programme.day!==day()){programme.maintenanceCycle=checkedInventoryCaughtUp(coverageRows());programme.day=day();programme.attemptedGalleries=[];for(const s of sources)resetInventoryCycle(store,s);save();}
  const history=programme.plans.map(id=>getPlan(store,id)),visits=phaseSourceVisits(history);
  const today=history.filter(p=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(p.created_at))===programme!.day);
  programme.attemptedGalleries=today.flatMap(p=>(p.caps.resumeHomeIds??[]).filter((homeId:number)=>store.get(`galleryResumeAttempt:${p.id}:${homeId}`)));save();
  const remaining=Object.fromEntries(Object.entries(executionPolicy()!.dailyCaps).map(([k,v])=>[k,v-today.reduce((n,p)=>n+p.usage[k],0)]));
  if(remaining.pages<2||remaining.listings<1)throw new Error('Daily allowance reached; resume next morning');
  const available=sources.filter(s=>{try{store.checkSource(s.id);return true;}catch{return false;}});
  const oldest=(phase:'inventory'|'assessment')=>(a:typeof sources[number],b:typeof sources[number])=>(visits[phase][a.id]??'').localeCompare(visits[phase][b.id]??'')||readQueue(store,b.id).urls.length-readQueue(store,a.id).urls.length;
  const inventory=available.filter(s=>inventoryRoutes(store,s).some(r=>['pending','partial'].includes(r.status)&&r.next)).sort(oldest('inventory'));
  const pendingCache=new Map<string,ReturnType<typeof pendingHomes>>();
  const pending=(source:string)=>{if(!pendingCache.has(source))pendingCache.set(source,(quick()?pendingCollectionHomes(store,source):pendingHomes(store,source)).filter(h=>![14,16,17].includes(h.id)&&!programme!.attemptedGalleries.includes(h.id)&&(quick()||!hardFailure(h.listing,store.criteria))&&(quick()?(!h.listing.galleryComplete||h.listing.photos.some(p=>!p.local&&p.status!=='unavailable')):h.listing.photos.some(p=>p.status==='pending'||p.status==='downloaded'||p.attributionPending))).sort((a,b)=>postingAgeRank(a.listing.postedAt,store.criteria.listingAgePriorityMonths)-postingAgeRank(b.listing.postedAt,store.criteria.listingAgePriorityMonths)));return pendingCache.get(source)!;};
  const rankCache=new Map<string,number>();
  const workRank=(s:typeof sources[number])=>{if(!rankCache.has(s.id)){const q=readQueue(store,s.id),dates=[...q.urls.map(url=>q.cards?.[url]?.postedAt),...(q.offerings??[]).map(l=>l.postedAt),...pending(s.id).map(h=>store.postingDetails(h.id).find(p=>p.source===s.id)?.listing.postedAt)];rankCache.set(s.id,Math.min(...dates.map(date=>postingAgeRank(date,store.criteria.listingAgePriorityMonths))));}return rankCache.get(s.id)!;};
  const candidates=available.filter(s=>readQueue(store,s.id).urls.length||readQueue(store,s.id).offerings?.length||pending(s.id).length).sort((a,b)=>workRank(a)-workRank(b)||oldest('assessment')(a,b));
  const allocation=store.get<SourceSelectionState>('sourceAllocation')??{selectionCount:0,lastSelected:{}},yieldStats=savedSourceYieldStats(store);
  const surveyed=today.filter(p=>p.caps.phase==='inventory'&&p.usage.pages>0).flatMap(p=>p.caps.sources);
  const areaWork=quick()?catchupAreaWork(store,inventory.map(s=>s.id),candidates.map(s=>s.id),available.map(source=>{const queue=readQueue(store,source.id);return {source:source.id,routes:inventoryRoutes(store,source),candidates:[...queue.urls.map(url=>queue.cards?.[url]??{}),...(queue.offerings??[]),...pending(source.id).map(home=>home.listing)]};})):undefined;
  const preferred=quick()?chooseQuickCatchupPhase(areaWork!.inventory,areaWork!.candidates,yieldStats,allocation,programme.maintenanceCycle,surveyed):null;
  const choice=quick()?preferred:chooseCatchupPhase(inventory.map(s=>s.id),candidates.map(s=>s.id),available.map(s=>s.id),today.filter(p=>p.caps.phase==='inventory').flatMap(p=>p.caps.sources),today.at(-1)?.caps.phase);
  const source=sources.find(s=>s.id===choice?.source);if(!source){console.log(JSON.stringify({idle:true,reason:areaWork?.reason??'Accessible discovered work drained; inspect coverage gaps separately',status:status().phase}));process.exitCode=0;}
  else{
   const phase=choice!.phase;if(phase==='assessment'&&!quick())assertFeedbackReady(store);
   if(phase==='assessment'&&((!quick()&&remaining.aiCalls<1)||remaining.photos<1))throw new Error('Daily photo/AI allowance reached; resume next morning');
   const peers=(quick()?(phase==='inventory'?areaWork!.inventory:areaWork!.candidates):(phase==='inventory'?inventory:candidates).map(s=>s.id)).filter(id=>phase!=='inventory'||!programme!.maintenanceCycle||surveyed.includes(source.id)||!surveyed.includes(id));
   const batch=quick()?quickCatchupBatch(choice!,peers,remaining as Programme['dailyCaps'],store.get<{scanConcurrency?:number}>('processingPolicy')?.scanConcurrency):null;
   const selected=batch?.sources??[source.id],resumes=phase==='assessment'?[...new Set(selected.flatMap(id=>pending(id).slice(0,10).map(h=>h.id)))]:[];
   const caps={phase,assessmentMode:quick()?'quick':'full',queuePolicy:'balanced',purpose:'listings',trafficPolicy:'session',billingMode:'chatgpt',sources:selected,maxPages:Math.min(phase==='inventory'?8:90,remaining.pages),maxListings:phase==='inventory'?1:Math.min(60,remaining.listings),maxPhotos:phase==='inventory'?0:Math.min(1500,remaining.photos),maxAiCalls:phase==='inventory'||quick()?0:Math.min(200,remaining.aiCalls),maxReservedUsd:0,newListingsOnly:phase==='assessment',unitListingsOnly:true,...(phase==='assessment'?{targetNewListingsPerSource:Math.min(30,remaining.listings),resumeHomeIds:resumes}:{}),...batch,refreshActiveListings:false,expandedCoverage:phase==='assessment'};
   const state=await request('state?compact=1');if(state.demo)throw new Error('Live app required');if(phase==='assessment'&&!quick()&&(!state.providerReady||state.aiMode!=='chatgpt'))throw new Error('Connected ChatGPT plan required; no paid fallback');
   if(phase==='assessment')for(const id of selected){const q=readQueue(store,id);balanceQueue(q,store.criteria.listingAgePriorityMonths);saveQueue(store,id,q);}
   const plan=await request('plans',caps,state.csrf);programme.plans.push(plan.id);for(const id of selected)programme.lastSource[id]=new Date().toISOString();programme.lastUsage={at:new Date().toISOString(),usedPercent:used};save();
   if(!quick())store.set(`usageGuard:${plan.id}`,{checkedAt:Date.now(),usedPercent:used,...policy(),allowAiThrough:1});
   await request(`plans/${plan.id}/approve`,{confirmation:'APPROVE ONE SCAN'},state.csrf);
   // Multi-source workers advance allocation after dispatch; doing it here as
   // well would count the same phase twice and can overwrite newer worker state.
   if(preferred&&selected.length===1){store.set('sourceAllocation',{selectionCount:allocation.selectionCount+1,lastSelected:{...allocation.lastSelected,[source.id]:new Date().toISOString()}});store.set(`sourceAllocation:${plan.id}`,{...preferred,stats:yieldStats});}
   save();console.log(JSON.stringify({started:plan.id,source:source.id,sources:selected,phase,caps,remaining}));
  }
 }else throw new Error('Use init, next, tick, summary, status or stop-phase');
}finally{store.close();}
