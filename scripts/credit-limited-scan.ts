import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Store} from '../server/db.ts';
import {getPlan} from '../server/plans.ts';
import {sources} from '../server/sources.ts';
import {assertArchivedOperation} from '../server/archived-operations.ts';
assertArchivedOperation('November 15 credit-limited scan',process.argv[2],['status']);
const root=resolve('data/live/credit-limited-scan-2026-11-15');mkdirSync(root,{recursive:true});
const file=join(root,'run.json'),store=new Store(resolve('data/live/apartments.sqlite'));
const save=(v:unknown)=>writeFileSync(file,JSON.stringify(v,null,2));
let run:any=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null;
const action=process.argv[2],used=Number(process.argv[3]);
try{
 if(action==='start'){
  if(!Number.isFinite(used)||used<0||used>=88)throw Error('Fresh usage below 88% required');
  if(store.db.prepare('SELECT 1 FROM scan_lock').get())throw Error('Another scan active');
  const base='http://127.0.0.1:4317/api/';
  const request=async(path:string,body?:unknown,csrf?:string)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(csrf?{'X-AF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});const data=await r.json() as any;if(!r.ok)throw Error(JSON.stringify(data));return data;};
  const state=await request('state?compact=1');
  if(state.demo||state.aiMode!=='chatgpt'||!state.providerReady)throw Error('ChatGPT provider unavailable');
  if(!run){await store.backupTo(join(root,'before.sqlite'));run={authorization:'User requested up to 20 apartments per source, scored, stopping with 10% weekly usage remaining. Stop conservatively at 88% reported usage. Bounded sequential passes respecting existing per-run and daily source limits; no recurring authorization.',startedAt:new Date().toISOString(),initialUsage:used,targetPerSource:20,aggregateCaps:{pages:180,listings:240,photos:1800,aiCalls:200},plans:[],baselineIds:(store.db.prepare('SELECT id FROM homes').all() as any[]).map(h=>h.id)};save(run);}
  const previous=run.plans.map((id:string)=>getPlan(store,id));if(previous.some((p:any)=>['running','approved'].includes(p.state)))throw Error('Previous pass still active');
  if(previous.filter((p:any)=>p.caps.maxPhotos>0).length>=3)throw Error('Three-pass bound reached');
  const total=(kind:string)=>previous.reduce((n:number,p:any)=>n+p.usage[kind],0);
  const count=(source:string)=>previous.flatMap((p:any)=>p.sources).filter((r:any)=>r.source===source).reduce((n:number,r:any)=>n+(r.newListings??0),0);
  const since=new Date(Date.now()-86400000).toISOString();
  const counts=(source:string,kind:string)=>(store.db.prepare('SELECT count(*) n FROM requests WHERE source=? AND kind=? AND at>?').get(source,kind,since) as any).n;
  const selected=sources.filter(s=>count(s.id)<20&&(!previous.length||(!state.sources.find((x:any)=>x.id===s.id)?.paused&&counts(s.id,'page')<14&&counts(s.id,'image')<(s.dailyImages??100)&&!previous.flatMap((p:any)=>p.sources).some((r:any)=>r.source===s.id&&/request (?:cap|allowance)|Daily|No rental links|no unseen|Fresh discovery checked; 0 candidates/i.test(r.detail)))));
  if(!selected.length)throw Error('No sources can continue within current traffic and access limits');
  const maxListings=Math.min(120,run.aggregateCaps.listings-total('listings'));
  const caps={purpose:'listings',billingMode:'chatgpt',sources:selected.map(s=>s.id),maxPages:Math.min(selected.length*5,run.aggregateCaps.pages-total('pages')),maxListings,maxListingsPerSource:Math.min(...selected.map(s=>20-count(s.id))),maxPhotos:Math.min(1200,run.aggregateCaps.photos-total('photos')),maxAiCalls:Math.min(100,run.aggregateCaps.aiCalls-total('aiCalls')),maxReservedUsd:0,newListingsOnly:true,targetNewListingsPerSource:Math.min(...selected.map(s=>20-count(s.id))),expandedCoverage:false,refreshActiveListings:false,maxRefreshListings:0};
  const plan=await request('plans',caps,state.csrf);run.plans.push(plan.id);save(run);
  store.set(`usageGuard:${plan.id}`,{checkedAt:Date.now(),usedPercent:used,stopAt:88,allowAiThrough:1});
  await request(`plans/${plan.id}/approve`,{confirmation:'APPROVE ONE SCAN'},state.csrf);
  console.log(JSON.stringify({started:plan.id,caps,model:state.chatgpt.model}));
 }else if(action==='tick'||action==='status'){
  if(!run)throw Error('Run not initialized');
  const plans=run.plans.map((id:string)=>getPlan(store,id));
  if(action==='tick'){
   for(const plan of plans.filter((p:any)=>p.state==='running'||p.state==='approved')){
    const safe=Number.isFinite(used)&&used>=0&&used<88;
    store.set(`usageGuard:${plan.id}`,{checkedAt:Date.now(),usedPercent:safe?used:100,stopAt:88,allowAiThrough:plan.usage.aiCalls+(safe?1:0)});
    if(!safe)store.db.prepare("UPDATE plans SET state='cancelled',detail='Stopped to preserve weekly credit reserve' WHERE id=?").run(plan.id);
   }
   run.lastUsage={at:new Date().toISOString(),usedPercent:used};save(run);
  }
  const newHomes=store.homes().filter(h=>!run.baselineIds.includes(h.id));
  const result={usage:run.lastUsage,plans:plans.map((p:any)=>({id:p.id,state:p.state,usage:p.usage,sources:p.sources})),newHomes:newHomes.map(h=>({id:h.id,source:h.listing.source,score:h.score.value,eligible:h.score.eligible,photos:h.listing.photos.length,reviewed:h.listing.photos.filter(p=>p.status==='reviewed').length,complete:h.listing.galleryComplete})),active:!!store.db.prepare('SELECT 1 FROM scan_lock').get()};
  writeFileSync(join(root,'status.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({usage:result.usage,active:result.active,newHomes:result.newHomes.length,worthReviewing:result.newHomes.filter(h=>h.eligible&&h.score>=3).length,plans:result.plans.map((p:any)=>({...p,sources:p.sources.filter((s:any)=>s.state!=='pending')}))}));
 }else throw Error('Use start, tick, or status');
}finally{store.close();}
