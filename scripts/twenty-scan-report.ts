import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync} from 'node:fs';
import {Store} from '../server/db.ts';
import {getPlan} from '../server/plans.ts';
import {sources} from '../server/sources.ts';
import {hardFailure} from '../server/regular-worker.ts';
import {isApartmentUnit,sharedRoomEvidence} from '../server/listing-rental-scope.ts';
import {deskCategory} from '../src/desk-category.ts';

const root='data/live/twenty-per-source-2026-11-15';
const run=JSON.parse(readFileSync(root+'/run.json','utf8'));
const store=new Store('data/live/apartments.sqlite');
const before=new DatabaseSync(root+'/before.sqlite',{readOnly:true});
try{
 if(store.db.prepare('SELECT 1 FROM scan_lock').get())throw Error('A scan is still active; final report deferred');
 const plans=run.plans.map((id:string)=>getPlan(store,id));
 if(plans.some((p:any)=>['running','approved'].includes(p.state)))throw Error('A phase has not finished');
 const homes=store.homes().filter(h=>!run.baselineIds.includes(h.id));
 const excludedNonApartments=homes.filter(h=>!isApartmentUnit(h.listing)).map(h=>({id:h.id,source:h.listing.source,title:h.listing.title,url:h.listing.url,reason:sharedRoomEvidence(h.listing)??h.listing.offeringKind}));
 const rows=homes.filter(h=>isApartmentUnit(h.listing)).map(h=>{
  const l=h.listing,hard=hardFailure(l,store.criteria);
  const full=l.galleryComplete&&l.photos.length>0&&l.photos.every(p=>p.status==='reviewed'&&!p.attributionPending)&&(l.expectedPhotos===null||l.photos.length>=l.expectedPhotos);
  return {id:h.id,source:l.source,offeringKind:l.offeringKind,url:l.url,title:l.title,rent:l.rent,score:h.score.value,category:deskCategory(h),view:h.score.view,reasons:h.score.reasons,flags:h.score.flags,hardFailure:hard,assessment:hard?'hard-filtered':full?'fully-reviewed':'provisional',expectedPhotos:l.expectedPhotos,photoRecords:l.photos.length,downloaded:l.photos.filter(p=>p.local).length,reviewed:l.photos.filter(p=>p.status==='reviewed'&&!p.attributionPending).length,reviewPending:l.photos.filter(p=>p.local&&(p.status!=='reviewed'||p.attributionPending)).length,galleryComplete:l.galleryComplete,galleryEvidence:l.evidence.gallery,galleryCoverage:l.evidence.galleryCoverage};
 });
 const changed:any[]=[];
 for(const prior of before.prepare('SELECT * FROM homes').all() as any[]){
  const now=store.db.prepare('SELECT * FROM homes WHERE id=?').get(prior.id) as any;
  const fields=['listing','stage','notes','follow_up','viewing','rescued'].filter(key=>prior[key]!==now?.[key]);
  if(fields.length)changed.push({id:prior.id,fields});
 }
 const usage=Object.fromEntries(['pages','listings','photos','aiCalls','reservedUsd','requests'].map(key=>[key,plans.reduce((n:number,p:any)=>n+p.usage[key],0)]));
 const sourceRows=sources.map(s=>{
  const own=rows.filter(h=>h.source===s.id&&h.offeringKind==='unit');
  const outcomes=plans.flatMap((p:any)=>p.sources.map((r:any)=>({...r,planId:p.id}))).filter((r:any)=>r.source===s.id&&r.state!=='pending');
  const q=store.get<{urls:string[];next:string|null;offerings?:unknown[]}>(`discoveryQueue:${s.id}`);
  const lastDiscovery=store.get(`discoverySummary:${s.id}`),unitDiscoveryExclusions=plans.map((p:any)=>({planId:p.id,exclusions:store.get(`unitDiscoveryExclusions:${p.id}:${s.id}`)})).filter((p:any)=>p.exclusions);
  return {source:s.id,name:s.name,target:20,newUnits:own.length,fullyReviewed:own.filter(h=>h.assessment==='fully-reviewed').length,hardFiltered:own.filter(h=>h.hardFailure).length,provisional:own.filter(h=>h.assessment==='provisional').length,attempts:outcomes.reduce((n:number,r:any)=>n+(r.attemptedListings??0),0),skippedExisting:outcomes.reduce((n:number,r:any)=>n+(r.skippedExisting??0),0),skippedFloorplans:outcomes.reduce((n:number,r:any)=>n+(r.skippedFloorplans??0),0),candidateFailures:outcomes.reduce((n:number,r:any)=>n+(r.candidateFailures??0),0),lastDiscovery,unitDiscoveryExclusions,health:store.db.prepare('SELECT * FROM source_health WHERE source=?').get(s.id)??null,queue:{urls:q?.urls.length??0,offerings:q?.offerings?.length??0,next:q?.next??null},outcomes};
 });
 const result={status:sourceRows.every(s=>s.newUnits>=20)&&rows.every(h=>h.assessment!=='provisional')?'complete':'partial',startedAt:run.startedAt,finishedAt:new Date().toISOString(),initialWeeklyUsedPercent:run.initialUsage,finalUsage:run.lastUsage,stopAtWeeklyUsedPercent:run.stopAt,targetPerSource:20,usage,totals:{newUnits:rows.filter(h=>h.offeringKind==='unit').length,fullyReviewed:rows.filter(h=>h.assessment==='fully-reviewed').length,hardFiltered:rows.filter(h=>h.hardFailure).length,provisional:rows.filter(h=>h.assessment==='provisional').length},sources:sourceRows,homes:rows,plans:plans.map((p:any)=>({id:p.id,state:p.state,usage:p.usage,detail:p.detail})),preservation:{baselineHomes:run.baselineIds.length,changedHomes:changed,criteriaUnchanged:JSON.stringify(before.prepare("SELECT value FROM meta WHERE key='criteria'").get())===JSON.stringify(store.db.prepare("SELECT value FROM meta WHERE key='criteria'").get()),duplicateDecisionsUnchanged:JSON.stringify(before.prepare('SELECT * FROM duplicate_decisions ORDER BY a,b').all())===JSON.stringify(store.db.prepare('SELECT * FROM duplicate_decisions ORDER BY a,b').all())}};
 Object.assign(result,{executionState:'finished',sourceTargetsMet:sourceRows.filter(s=>s.newUnits>=s.target).length,excludedNonApartments,finalInventoryRecheckAt:run.finalInventoryRecheckAt});
 writeFileSync(root+'/report.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({...result,homes:undefined,plans:undefined,sources:sourceRows.map(s=>({...s,outcomes:s.outcomes.slice(-1)}))}));
}finally{before.close();store.close();}
