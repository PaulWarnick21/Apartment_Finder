import {existsSync,mkdirSync,readFileSync,writeFileSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {Store} from '../server/db.ts';
import {getPlan} from '../server/plans.ts';
import {sources} from '../server/sources.ts';
import {readQueue} from '../server/discovery-queue.ts';
import {areaSearchRoutes,searchAreaExclusion} from '../server/search-area.ts';
import {pendingCollectionHomes} from '../server/regular-worker.ts';
import {inventoryRoutes} from '../server/inventory-discovery.ts';
import type {Caps} from '../src/domain.ts';

const root=resolve('data/live/source-speed-test-2026-11-18');mkdirSync(root,{recursive:true});
const file=join(root,'run.json'),lock=join(root,'supervisor.lock'),store=new Store('data/live/apartments.sqlite');
type Row={executionMode?:'sequential'|'parallel';source:string;state:'pending'|'running'|'complete'|'limited'|'blocked';reason?:string;startedAt?:string;endedAt?:string;plans:string[];admittedIds:number[];admittedAt:Record<number,string>;resumes:Record<number,number>};
type Run={parallelGroup?:string;parallelStartedAt?:string;maxConcurrentSources?:number;authorization:string;state:string;startedAt?:string;endedAt?:string;baselineIds:number[];targetPerSource:number;maxSourceMinutes:number;maxTotalMinutes:number;caps:{pages:number;listings:number;photos:number};rows:Row[]};
let run:Run|undefined=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):undefined;
const save=()=>writeFileSync(file,JSON.stringify(run,null,2));
async function request(path:string,body?:unknown,csrf?:string){const response=await fetch('http://127.0.0.1:4317/api/'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(csrf?{'x-af-token':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const value=await response.json() as any;if(!response.ok)throw Error(JSON.stringify(value));return value;}
function measure(row:Row){
 const plans=row.plans.map(id=>getPlan(store,id));
 const owned=new Set<number>(row.plans.flatMap(id=>store.get<any>(`newListingValidation:${id}`)?.sources?.[row.source]?.newHomeIds??[]));
 const homes=[...owned].filter(id=>!run!.baselineIds.includes(id)).map(id=>store.home(id)).filter((h):h is NonNullable<typeof h>=>!!h);
 for(const h of homes)if(h.quickRank?.eligible&&!h.deskExclusion&&h.listing.photos.some(p=>p.local)&&!row.admittedIds.includes(h.id)){row.admittedIds.push(h.id);row.admittedAt[h.id]=new Date().toISOString();}
 const usage={pages:0,listings:0,photos:0,requests:0,aiCalls:0,addresses:0};for(const p of plans){for(const key of ['pages','listings','photos','requests','aiCalls'] as const)usage[key]+=p.usage[key];usage.addresses+=p.addressLookups;}
 const outcomes:Record<string,number>={};for(const id of row.plans)for(const o of store.get<any>(`newListingValidation:${id}`)?.sources?.[row.source]?.outcomes??[])outcomes[o.result]=(outcomes[o.result]??0)+1;
 const exclusions:Record<string,number>={};for(const h of homes){const reason=h.deskExclusion??(!h.quickRank?.eligible?h.quickRank?.reasons.join('; '):undefined);if(reason)exclusions[reason]=(exclusions[reason]??0)+1;}
 return {...row,admitted:row.admittedIds.length,elapsedSeconds:row.startedAt?Math.round((Date.parse(row.endedAt??new Date().toISOString())-Date.parse(row.startedAt))/1000):0,firstResultSeconds:row.startedAt&&row.admittedIds.length?Math.round((Date.parse(row.admittedAt[row.admittedIds[0]])-Date.parse(row.startedAt))/1000):null,completeGalleries:homes.filter(h=>row.admittedIds.includes(h.id)&&h.listing.galleryComplete&&h.listing.photos.length&&h.listing.photos.every(p=>p.local||p.status==='unavailable')).length,usage,outcomes,exclusions,active:plans.filter(p=>['approved','running'].includes(p.state)).map(p=>({id:p.id,phase:p.caps.phase,usage:p.usage})),lastDetail:plans.at(-1)?.detail};
}
function status(){if(!run)throw Error('Initialize first');const rows=run.rows.map(measure);save();const result={state:run.state,maxConcurrentSources:run.maxConcurrentSources??1,parallelStartedAt:run.parallelStartedAt,startedAt:run.startedAt,endedAt:run.endedAt,targetPerSource:run.targetPerSource,elapsedSeconds:run.startedAt?Math.round((Date.parse(run.endedAt??new Date().toISOString())-Date.parse(run.startedAt))/1000):0,admitted:rows.reduce((sum,r)=>sum+r.admitted,0),rows,updatedAt:new Date().toISOString()};writeFileSync(join(root,'status.json'),JSON.stringify(result,null,2));
 const lines=['# Five-apartment source comparison','',`Status: ${run.state}. Five new desk-eligible apartments per source, zero AI and address calls.`,`Per source: ${run.maxSourceMinutes} minutes / ${run.caps.pages} pages / ${run.caps.listings} attempts / ${run.caps.photos} photos. Concurrency: ${run.maxConcurrentSources??1} source(s), with one shared Chrome slot. Source time excludes waiting to start.`,'','| Source | Mode | Qualified | First result | Source time | Pages / attempts / photos | Outcome |','| --- | --- | ---: | ---: | ---: | --- | --- |',...rows.map(r=>`| ${r.source} | ${r.executionMode??'pending'} | ${r.admitted}/5 | ${r.firstResultSeconds===null?'—':r.firstResultSeconds+'s'} | ${r.elapsedSeconds}s | ${r.usage.pages} / ${r.usage.listings} / ${r.usage.photos} | ${(r.reason??r.state).replaceAll('|','/')} |`),'','Counts require a new home, eligible quick rank, no desk exclusion and a saved photo. Complete gallery counts and candidate failures are recorded separately in status.json. Existing homes and duplicate postings do not satisfy the target. Source scopes and available inventory differ; these are observed intake rates, not controlled website response-time benchmarks.'];writeFileSync(join(root,'comparison.md'),lines.join('\n'));return result;}
async function cancel(row:Row){const active=measure(row).active;if(!active.length)return;const app=await request('state?compact=1');for(const p of active)await request(`plans/${p.id}/cancel`,{},app.csrf);}
function end(row:Row,state:Row['state'],reason:string){row.state=state;row.reason=reason;row.endedAt=new Date().toISOString();save();console.log(JSON.stringify({event:'source-finished',source:row.source,reason,at:row.endedAt,admitted:row.admittedIds.length}));}
async function tick(){
 if(!run||run.state!=='running')return false;
 const s=status();
 if(s.elapsedSeconds>=run.maxTotalMinutes*60){for(const row of run.rows.filter(r=>['pending','running'].includes(r.state))){await cancel(row);end(row,'limited','Aggregate three-hour time limit');}}
 for(const row of run.rows.filter(r=>r.state==='running'))await advance(row);
 for(const row of run.rows.filter(r=>r.state==='pending')){
  if(run.rows.filter(r=>r.state==='running').length>=(run.maxConcurrentSources??1))break;
  if(['apartments','zillow'].includes(row.source)&&run.rows.some(r=>r.state==='running'&&['apartments','zillow'].includes(r.source)))continue;
  await advance(row);
 }
 if(!run.rows.some(r=>['running','pending'].includes(r.state))){run.state=run.rows.every(r=>r.state==='complete')?'complete':'finished-with-shortfalls';run.endedAt=new Date().toISOString();save();status();return false;}
 return true;
}
async function advance(row:Row){
 if(!run)return false;
 if(row.state==='pending'&&existsSync(join(root,'hold-new-sources')))return true;
 const m=measure(row);
 // Let the final in-flight gallery finish rather than cancelling its photographs.
 if(m.active.length){if(m.elapsedSeconds>=run.maxSourceMinutes*60){await cancel(row);end(row,'limited','Twelve-minute source limit; completed work retained');}return true;}
 if(m.admitted>=run.targetPerSource){end(row,'complete','Five qualifying new apartments reached');return true;}
 if(!areaSearchRoutes(store,row.source).length){end(row,'blocked','No supported website geographic filter; broad search not authorized');return true;}
 try{store.checkSource(row.source);}catch(e){end(row,'blocked',String(e));return true;}
 if(m.elapsedSeconds>=run.maxSourceMinutes*60){end(row,'limited','Twelve-minute source limit');return true;}
 const activePlans=store.db.prepare("SELECT id,caps FROM plans WHERE state IN ('running','approved')").all() as Array<{id:string;caps:string}>;
 if(!run.parallelGroup){if(store.db.prepare('SELECT 1 FROM scan_lock').get()||activePlans.length)return true;}
 else {
  if(activePlans.some(p=>JSON.parse(p.caps).parallelGroup!==run!.parallelGroup)||activePlans.length>=3)return true;
  if(['zillow','apartments'].includes(row.source)&&activePlans.some(p=>JSON.parse(p.caps).sources.some((s:string)=>['zillow','apartments'].includes(s))))return true;
  const locked=store.db.prepare('SELECT owner FROM scan_lock').get() as {owner:string}|undefined;
  if(locked&&locked.owner!=='parallel:'+run.parallelGroup)return true;
 }
 const remaining={pages:run.caps.pages-m.usage.pages,listings:run.caps.listings-m.usage.listings,photos:run.caps.photos-m.usage.photos};
 if(remaining.pages<2||remaining.listings<1||remaining.photos<1){end(row,'limited','Per-source page, candidate or photo ceiling reached');return true;}
 const previous=row.plans.length?getPlan(store,row.plans.at(-1)!):undefined;
 if(previous&&previous.usage.listings===0&&/Chrome|browser|Navigation|Access|timeout|time limit|No listing|No rental|filter required|Source paused/i.test(previous.detail)){end(row,'blocked',previous.detail);return true;}
 const q=readQueue(store,row.source),source=sources.find(s=>s.id===row.source)!;
 const owned=new Set<number>(row.plans.flatMap(id=>store.get<any>(`newListingValidation:${id}`)?.sources?.[row.source]?.newHomeIds??[]));
 const pending=pendingCollectionHomes(store,row.source).filter(h=>owned.has(h.id)&&!run!.baselineIds.includes(h.id)&&!searchAreaExclusion(store,h.listing,true)&&(row.resumes[h.id]??0)<1);
 const phase:Caps['phase']=!row.startedAt?'combined':q.urls.length||q.offerings?.length||pending.length?'assessment':'inventory';
 if(phase==='inventory'&&!inventoryRoutes(store,source).some(r=>r.next&&['pending','partial'].includes(r.status))){end(row,'limited','Checked filtered inventory drained; no further accessible route queued');return true;}
 const wanted=run.targetPerSource-m.admitted,resumes=pending.slice(0,Math.min(2,wanted)),target=Math.min(wanted-resumes.filter(h=>!row.admittedIds.includes(h.id)).length,remaining.listings);
 const caps:Caps={...(run.parallelGroup?{parallelGroup:run.parallelGroup}:{}),purpose:'listings',trafficPolicy:'session',billingMode:'chatgpt',assessmentMode:'quick',sources:[row.source],phase,queuePolicy:'balanced',maxPages:Math.min(phase==='inventory'?8:30,remaining.pages),maxListings:Math.min(phase==='inventory'?1:20,remaining.listings),maxPhotos:phase==='inventory'?0:remaining.photos,maxAiCalls:0,maxAddressLookups:0,maxReservedUsd:0,reservePerCallUsd:.1,newListingsOnly:phase!=='inventory',unitListingsOnly:true,...(phase!=='inventory'?{targetNewListingsPerSource:Math.max(1,target),targetNewListingsBySource:{[row.source]:target},resumeHomeIds:resumes.map(h=>h.id)}:{}),expandedCoverage:false,refreshActiveListings:false,maxRefreshListings:0};
 const app=await request('state?compact=1');if(app.demo||app.schedule.enabled)throw Error('Expected live app with daily scans disabled');
 if(app.searchAreaSummary!=='Downtown Vancouver, West Vancouver, North Vancouver')throw Error('Search area changed during benchmark');
 const prior={startedAt:row.startedAt,executionMode:row.executionMode,state:row.state,resumes:{...row.resumes}};
 const plan=await request('plans',caps,app.csrf);row.plans.push(plan.id);row.startedAt??=new Date().toISOString();row.executionMode??=run.parallelGroup?'parallel':'sequential';row.state='running';for(const h of resumes)row.resumes[h.id]=(row.resumes[h.id]??0)+1;save();
 try{await request(`plans/${plan.id}/approve`,{confirmation:'APPROVE ONE SCAN'},app.csrf);}
 catch(error){
  // DB plan state can finish just before its child process releases a slot.
  // A transient admission conflict must never cancel already-running siblings.
  if(!run.parallelGroup||!/three active sources|scan for this source is already active|shared Chrome source lane is already active|Another scan group is running/i.test(String(error)))throw error;
  await request(`plans/${plan.id}/cancel`,{},app.csrf);Object.assign(row,prior);save();
  console.log(JSON.stringify({event:'admission-wait',at:new Date().toISOString(),source:row.source,plan:plan.id,reason:String(error)}));return true;
 }
 console.log(JSON.stringify({event:'batch-started',at:new Date().toISOString(),source:row.source,plan:plan.id,phase,target,admitted:m.admitted}));return true;
}
let owns=false;
try{const action=process.argv[2];
 if(action==='init'){
  if(run)throw Error('Benchmark already initialized; never reset its authorization');
  if(store.db.prepare('SELECT 1 FROM scan_lock').get()||store.db.prepare("SELECT 1 FROM plans WHERE state IN ('running','approved')").get())throw Error('Another scan is active');
  await store.backupTo(join(root,'before.sqlite'));const homes=store.homes();writeFileSync(join(root,'baseline.json'),JSON.stringify(homes));
  const order=['craigslist','rew','zumper','vada','austeville','sunstar','easyrent','kijiji','hollyburn','facebook','zillow','apartments'];
  run={authorization:'User requested investigation followed by one test getting five new qualifying apartments from each of 12 retained sources for timing comparison. Native selected-area filters only, no address lookups or AI calls, no recurring scanning. Each source bounded at12min/60pages/40attempts/400photos; overall3hours,720pages,480attempts,4800photos maximum. Preserve existing homes/ranks/decisions and all source pauses.',state:'prepared',baselineIds:homes.map(h=>h.id),targetPerSource:5,maxSourceMinutes:12,maxTotalMinutes:180,caps:{pages:60,listings:40,photos:400},rows:order.map(source=>({source,state:'pending',plans:[],admittedIds:[],admittedAt:{},resumes:{}}))};save();console.log(JSON.stringify(status()));
 }else if(action==='status')console.log(JSON.stringify(status()));
 else if(action==='loop'){
  if(!run||!['prepared','running'].includes(run.state))throw Error('No prepared/running benchmark');const fd=openSync(lock,'wx');closeSync(fd);owns=true;
  run.startedAt??=new Date().toISOString();run.state='running';save();while(await tick())await sleep(2000);
 }else throw Error('Use init, status or loop');
}catch(e){console.error(String(e));if(run&&owns){for(const row of run.rows.filter(r=>r.state==='running'))await cancel(row).catch(()=>{});run.state='needs-attention';save();status();}process.exitCode=1;}finally{if(owns&&existsSync(lock))unlinkSync(lock);store.close();}
