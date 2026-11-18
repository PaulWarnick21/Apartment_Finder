import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync} from 'node:fs';
import {Store} from '../server/db.ts';
import {getPlan} from '../server/plans.ts';
import {sources} from '../server/sources.ts';
import {hardFailure} from '../server/regular-worker.ts';
import {deskCategory} from '../src/desk-category.ts';
const root='data/live/credit-limited-scan-2026-11-15',run=JSON.parse(readFileSync(root+'/run.json','utf8'));
const store=new Store('data/live/apartments.sqlite'),before=new DatabaseSync(root+'/before.sqlite',{readOnly:true});
try{
 if(store.db.prepare('SELECT 1 FROM scan_lock').get())throw Error('Scan still active; final report deferred');
 const plans=run.plans.map((id:string)=>getPlan(store,id)),homes=store.homes().filter(h=>!run.baselineIds.includes(h.id));
 const changed:any[]=[];
 for(const prior of before.prepare('SELECT * FROM homes').all() as any[]){const now=store.db.prepare('SELECT * FROM homes WHERE id=?').get(prior.id) as any;const fields=['listing','stage','notes','follow_up','viewing','rescued'].filter(key=>prior[key]!==now?.[key]);if(fields.length)changed.push({id:prior.id,fields});}
 const usage=Object.fromEntries(['pages','listings','photos','aiCalls','reservedUsd','requests'].map(kind=>[kind,plans.reduce((n:number,p:any)=>n+p.usage[kind],0)]));
 const result={status:'partial',startedAt:run.startedAt,finishedAt:new Date().toISOString(),initialWeeklyUsedPercent:run.initialUsage,finalUsage:run.lastUsage,targetPerSource:20,usage,photoReviewContinuation:run.photoFinishPlan?{...run.photoFinishPlan,state:getPlan(store,run.photoFinishPlan.id).state}:null,attributionFix:run.attributionFixRetry??null,
  sources:sources.map(s=>({source:s.id,name:s.name,newCandidates:homes.filter(h=>h.listing.source===s.id).length,outcomes:plans.flatMap((p:any)=>p.sources).filter((r:any)=>r.source===s.id),initialSkipped:run.initialSkipped?.[s.id]})),
  homes:homes.map(h=>({id:h.id,source:h.listing.source,offeringKind:h.listing.offeringKind,url:h.listing.url,rent:h.listing.rent,score:h.score.value,category:deskCategory(h),view:h.score.view,reasons:h.score.reasons,hardFailure:hardFailure(h.listing,store.criteria),expectedPhotos:h.listing.expectedPhotos,photoRecords:h.listing.photos.length,downloaded:h.listing.photos.filter(p=>p.local).length,reviewed:h.listing.photos.filter(p=>p.status==='reviewed').length,reviewPending:h.listing.photos.filter(p=>p.local&&(p.status!=='reviewed'||p.attributionPending)).length,galleryComplete:h.listing.galleryComplete})),
  preservation:{baselineHomes:run.baselineIds.length,changedHomes:changed,criteriaUnchanged:JSON.stringify(before.prepare("SELECT value FROM meta WHERE key='criteria'").get())===JSON.stringify(store.db.prepare("SELECT value FROM meta WHERE key='criteria'").get()),duplicateDecisionsUnchanged:JSON.stringify(before.prepare('SELECT * FROM duplicate_decisions ORDER BY a,b').all())===JSON.stringify(store.db.prepare('SELECT * FROM duplicate_decisions ORDER BY a,b').all()),feedbackResolution:'Feedback #22 was separately reviewed before startup; original proposal and rationale retained in offlineFeedbackResolution:22. No criteria changes.'},
  scheduledScansEnabled:false};
 writeFileSync(root+'/report.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({newCandidates:homes.length,units:homes.filter(h=>h.listing.offeringKind==='unit').length,floorplans:homes.filter(h=>h.listing.offeringKind==='floorplan').length,active:result.homes.filter(h=>h.category==='Unreviewed'),incomplete:result.homes.filter(h=>!h.hardFailure&&(!h.galleryComplete||h.reviewPending>0||h.downloaded<h.photoRecords)),sources:result.sources,usage,preservation:result.preservation,finalUsage:result.finalUsage},null,2));
}finally{before.close();store.close();}
