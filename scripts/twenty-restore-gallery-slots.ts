import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Store,hash} from '../server/db.ts';
import {getPlan} from '../server/plans.ts';
import {reconcileListing} from '../server/listing-integrity.ts';
import type {DownloadedPhoto} from '../server/gallery-downloads.ts';
import {assertArchivedOperation} from '../server/archived-operations.ts';

// Recover captured source entries removed by the old same-content deduplication.
// This is local-only and restricted to homes first added by this authorized attempt.
assertArchivedOperation('November 15 gallery-slot repair',process.argv[2]);
const run=JSON.parse(readFileSync('data/live/twenty-per-source-2026-11-15/run.json','utf8'));
const store=new Store('data/live/apartments.sqlite');
try{
 if(store.db.prepare('SELECT 1 FROM scan_lock').get())throw Error('Wait for the active phase to finish');
 const downloads=Object.assign({},...run.plans.map((id:string)=>store.get<Record<string,DownloadedPhoto>>(`mediaDownloads:${id}`)??{})) as Record<string,DownloadedPhoto>;
 const restored=[],smallerBatches:number[]=[];
 const timedOutSources=new Set(run.plans.flatMap((id:string)=>getPlan(store,id).sources).filter((r:any)=>/TimeoutError|timed out|aborted due to timeout/i.test(r.detail)).map((r:any)=>r.source));
 for(const home of store.homes().filter(h=>!run.baselineIds.includes(h.id))){
  const l=home.listing;
  if(timedOutSources.has(l.source)&&l.photos.some(p=>p.local&&(p.status!=='reviewed'||p.attributionPending))){const key=`galleryBatchLimit:${hash(JSON.stringify(home.id))}`;if(!store.get(key)){store.set(key,3);smallerBatches.push(home.id);}}
  if(!l.galleryComplete||l.expectedPhotos===null||l.photos.length>=l.expectedPhotos)continue;
  const manifest=store.postingDetails(home.id).find(p=>p.source===l.source&&p.sourceId===l.sourceId)?.listing;
  if(!manifest?.galleryComplete||manifest.photos.length<l.expectedPhotos)continue;
  const before=JSON.stringify(l),next=reconcileListing(l,manifest);
  for(const photo of next.photos){const cached=downloads[photo.url];if(!photo.local&&cached?.local&&cached.sourceLocal&&existsSync(join('data/live/media',cached.local))&&existsSync(join('data/live/media',cached.sourceLocal)))Object.assign(photo,cached,{status:'downloaded'});}
  const repaired={...l,photos:next.photos};
  repaired.evidence.galleryCoverage=`Restored ${next.photos.length} captured source gallery entries; repeated image content retains separate source URLs and can reuse saved assessments.`;
  const after=JSON.stringify(repaired),at=new Date().toISOString();
  store.transaction(()=>{
   store.db.prepare('UPDATE homes SET listing=?,revision=revision+1,updated_at=? WHERE id=?').run(after,at,home.id);
   store.db.prepare('INSERT INTO history(home_id,at,event,before_json,after_json) VALUES (?,?,?,?,?)').run(home.id,at,'Restored captured gallery entries after content deduplication',before,after);
   store.set(`pendingGallery:${home.id}`,{source:l.source,sources:[l.source],homeId:home.id,planId:run.plans.at(-1)});
  });
  restored.push({id:home.id,before:l.photos.length,after:next.photos.length,local:next.photos.filter(p=>p.local).length,reviewed:next.photos.filter(p=>p.status==='reviewed').length});
 }
 console.log(JSON.stringify({restored,smallerBatches}));
}finally{store.close();}
