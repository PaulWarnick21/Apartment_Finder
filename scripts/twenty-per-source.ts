import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Store} from '../server/db.ts';
import {getPlan} from '../server/plans.ts';
import {sources} from '../server/sources.ts';
import {hardFailure} from '../server/regular-worker.ts';
import {isApartmentUnit} from '../server/listing-rental-scope.ts';
import {deskCategory} from '../src/desk-category.ts';
import {assertArchivedOperation} from '../server/archived-operations.ts';

// Retained for historical inspection; the completed session cannot be resumed.
assertArchivedOperation('November 15 twenty-per-source scan',process.argv[2],['status']);
const root=resolve('data/live/twenty-per-source-2026-11-15'),file=join(root,'run.json');mkdirSync(root,{recursive:true});
const store=new Store('data/live/apartments.sqlite'),action=process.argv[2],used=Number(process.argv[3]);
let run:any=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null;
const save=()=>writeFileSync(file,JSON.stringify(run,null,2));
const safe=()=>Number.isFinite(used)&&used>=0&&used<88;
try{
 if(action==='start'){
  if(run)throw Error('This authorized session already exists; inspect or resume its remaining work, never restart its target.');
  if(!safe())throw Error('Fresh weekly usage below 88% required');
  if(store.db.prepare('SELECT 1 FROM scan_lock').get())throw Error('Another scan is active');
  const request=async(path:string,body?:unknown,csrf?:string)=>{const r=await fetch('http://127.0.0.1:4317/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(csrf?{'X-AF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const data=await r.json() as any;if(!r.ok)throw Error(JSON.stringify(data));return data;};
  const state=await request('state?compact=1');if(state.demo||state.aiMode!=='chatgpt'||!state.providerReady)throw Error('Connected ChatGPT plan is not ready');
  await store.backupTo(join(root,'before.sqlite'));
  const caps={purpose:'listings',trafficPolicy:'session',billingMode:'chatgpt',sources:sources.map(s=>s.id),maxPages:960,maxListings:720,maxListingsPerSource:60,maxPhotos:12000,maxAiCalls:2000,maxReservedUsd:0,newListingsOnly:true,unitListingsOnly:true,targetNewListingsPerSource:20,expandedCoverage:false,refreshActiveListings:false,maxRefreshListings:0};
  const plan=await request('plans',caps,state.csrf);
  run={authorization:'User explicitly approved another attempt at 20 new apartments from each retained source, scored, after replacing trial limits. Preserve at least 10% weekly credits; stop conservatively at 88% used. No recurring scan or paid API fallback.',startedAt:new Date().toISOString(),initialUsage:used,stopAt:88,targetPerSource:20,aggregateCaps:caps,plans:[plan.id],baselineIds:(store.db.prepare('SELECT id FROM homes').all() as {id:number}[]).map(r=>r.id)};save();
  store.set(`usageGuard:${plan.id}`,{checkedAt:Date.now(),usedPercent:used,stopAt:88,allowAiThrough:1});
  await request(`plans/${plan.id}/approve`,{confirmation:'APPROVE ONE SCAN'},state.csrf);console.log(JSON.stringify({started:plan.id,caps,model:state.chatgpt.model}));
 }else if(action==='resume'){
  if(!run||!safe())throw Error('An existing authorization and fresh usage below 88% are required');
  const recheckExhausted=process.argv.includes('--recheck-exhausted');
  if(recheckExhausted&&run.finalInventoryRecheckAt)throw Error('The final inventory recheck has already been used in this session');
  if(store.db.prepare('SELECT 1 FROM scan_lock').get())throw Error('Another phase is active');
  const previous=run.plans.map((id:string)=>getPlan(store,id));if(previous.some((p:any)=>['running','approved'].includes(p.state)))throw Error('Previous phase has not stopped');
  const request=async(path:string,body?:unknown,csrf?:string)=>{const r=await fetch('http://127.0.0.1:4317/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(csrf?{'X-AF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const data=await r.json() as any;if(!r.ok)throw Error(JSON.stringify(data));return data;};
  const state=await request('state?compact=1');if(state.demo||state.aiMode!=='chatgpt'||!state.providerReady)throw Error('ChatGPT plan unavailable');
  const alreadyResumed=(homeId:number)=>{if(run.plans.some((id:string)=>store.get(`galleryResumeAttempt:${id}:${homeId}`)))return true;const marker=store.get<{planId?:string}>(`pendingGallery:${homeId}`);return previous.some((p:any)=>p.id===marker?.planId&&p.caps.resumeHomeIds?.includes(homeId));};
  const homes=store.homes().filter(h=>!run.baselineIds.includes(h.id)&&isApartmentUnit(h.listing)),pending=homes.filter(h=>!hardFailure(h.listing,store.criteria)&&!['Closed','Not Interested','Leased'].includes(h.stage)&&((!h.listing.galleryComplete||h.listing.photos.some(p=>p.status==='pending'))&&!alreadyResumed(h.id)||h.listing.photos.some(p=>p.local&&(p.status!=='reviewed'||p.attributionPending))));
  // Excluded floor-plan offers still consume the aggregate attempt allowance,
  // but cannot consume the per-source allowance intended to find actual units.
  const usedTotal=(key:string)=>previous.reduce((sum:number,p:any)=>sum+p.usage[key],0),attempts=(source:string)=>previous.flatMap((p:any)=>p.sources).filter((r:any)=>r.source===source).reduce((sum:number,r:any)=>sum+Math.max(0,(r.attemptedListings??0)-(r.skippedFloorplans??0)),0);
  const candidates=sources.filter(s=>!state.sources.find((r:any)=>r.id===s.id)?.paused&&attempts(s.id)<60&&(homes.filter(h=>h.listing.source===s.id).length<20||pending.some(h=>h.listing.source===s.id)));
  const selected=candidates.filter(s=>{const prior=previous.flatMap((p:any)=>p.sources).filter((r:any)=>r.source===s.id&&r.state!=='pending').at(-1);const q=store.get<{urls:string[];next:string|null;offerings?:unknown[]}>(`discoveryQueue:${s.id}`);return recheckExhausted||!prior||pending.some(h=>h.listing.source===s.id)||!!q?.urls.length||!!q?.next||!!q?.offerings?.length;}).sort((a,b)=>homes.filter(h=>h.listing.source===a.id).length-homes.filter(h=>h.listing.source===b.id).length);
  if(!selected.length)throw Error('No source has remaining accessible work within this session');
  const maxListings=run.aggregateCaps.maxListings-usedTotal('listings'),maxPages=run.aggregateCaps.maxPages-usedTotal('pages'),maxPhotos=run.aggregateCaps.maxPhotos-usedTotal('photos'),maxAiCalls=run.aggregateCaps.maxAiCalls-usedTotal('aiCalls');
  const maxListingsBySource=Object.fromEntries(selected.map(s=>[s.id,60-attempts(s.id)])),targetNewListingsBySource=Object.fromEntries(selected.map(s=>[s.id,Math.min(5,20-homes.filter(h=>h.listing.source===s.id).length,maxListingsBySource[s.id]) ]));
  const caps={...run.aggregateCaps,sources:selected.map(s=>s.id),maxPages,maxListings,maxPhotos,maxAiCalls,maxListingsBySource,targetNewListingsBySource,resumeHomeIds:pending.filter(h=>selected.some(s=>s.id===h.listing.source)).map(h=>h.id)};
  const plan=await request('plans',caps,state.csrf);run.plans.push(plan.id);run.holdAi=false;if(recheckExhausted)run.finalInventoryRecheckAt=new Date().toISOString();run.scheduledResumeHomeIds=[...new Set([...(run.scheduledResumeHomeIds??run.resumedHomeIds??[]),...caps.resumeHomeIds])];save();
  store.set(`usageGuard:${plan.id}`,{checkedAt:Date.now(),usedPercent:used,stopAt:88,allowAiThrough:1});await request(`plans/${plan.id}/approve`,{confirmation:'APPROVE ONE SCAN'},state.csrf);
  console.log(JSON.stringify({resumed:plan.id,targets:targetNewListingsBySource,resumeHomeIds:caps.resumeHomeIds,finalInventoryRecheck:recheckExhausted,remainingCaps:{maxPages,maxListings,maxPhotos,maxAiCalls}}));
 }else if(action==='tick'||action==='status'||action==='hold'){
  if(!run)throw Error('Session not started');
  let plans=run.plans.map((id:string)=>getPlan(store,id));
  if(action==='hold')run.holdAi=true;
  if(action==='tick'||action==='hold'){
   for(const plan of plans.filter((p:any)=>['running','approved'].includes(p.state))){
    store.set(`usageGuard:${plan.id}`,{checkedAt:Date.now(),usedPercent:safe()?used:100,stopAt:88,allowAiThrough:plan.usage.aiCalls+(safe()&&!run.holdAi?1:0)});
    if(!safe())store.db.prepare("UPDATE plans SET state='cancelled',detail='Weekly reserve reached; incomplete work retained' WHERE id=?").run(plan.id);
   }
   run.lastUsage={at:new Date().toISOString(),usedPercent:used};save();plans=run.plans.map((id:string)=>getPlan(store,id));
  }
  const homes=store.homes().filter(h=>!run.baselineIds.includes(h.id)&&isApartmentUnit(h.listing));
  const progress=sources.map(s=>{const units=homes.filter(h=>h.listing.source===s.id&&h.listing.offeringKind==='unit');return {source:s.id,units:units.length,fullyReviewed:units.filter(h=>!hardFailure(h.listing,store.criteria)&&h.listing.galleryComplete&&h.listing.photos.length>0&&(h.listing.expectedPhotos===null||h.listing.photos.length>=h.listing.expectedPhotos)&&h.listing.photos.every(p=>p.status==='reviewed'&&!p.attributionPending)).length,hardFailures:units.filter(h=>hardFailure(h.listing,store.criteria)).length,active:units.filter(h=>deskCategory(h)==='Unreviewed').length};});
  const result={usage:run.lastUsage,active:!!store.db.prepare('SELECT 1 FROM scan_lock').get(),units:homes.length,progress,plans:plans.map((p:any)=>({id:p.id,state:p.state,usage:p.usage,sources:p.sources})),events:store.events().slice(0,3)};
  writeFileSync(join(root,'status.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,totals:Object.fromEntries(['pages','listings','photos','aiCalls','requests'].map(key=>[key,plans.reduce((sum:number,p:any)=>sum+p.usage[key],0)])),events:result.events.slice(0,1),plans:(process.argv.includes('--compact')?result.plans.slice(-1):result.plans).map((p:any)=>({...p,sources:p.sources.filter((s:any)=>s.state!=='pending')}))}));
 }else throw Error('Use start, tick or status');
}finally{store.close();}
