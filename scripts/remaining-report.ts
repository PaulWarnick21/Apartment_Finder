import {writeFile,mkdir} from 'node:fs/promises';
import {Store} from '../server/db.ts';
import {sources} from '../server/sources.ts';
const store=new Store('data/live/apartments.sqlite');
try{
 const homes=store.homes(),reports=store.get<Record<string,string>>('trialSourceReports')??{};
 const report=sources.map(s=>{const rows=homes.filter(h=>h.postings.some(p=>p.source===s.id));const reviewed=rows.reduce((n,h)=>n+h.listing.photos.filter(p=>p.status==='reviewed').length,0);const pending=rows.filter(h=>!h.score.reasons.length&&h.listing.photos.length>0&&(!h.listing.galleryComplete||h.listing.photos.some(p=>p.status!=='reviewed'))).length;return {source:s.id,candidates:rows.length,ids:rows.map(h=>h.id),reviewedPhotos:reviewed,pending,active:rows.filter(h=>h.score.eligible).length,excluded:rows.filter(h=>!h.score.eligible).map(h=>({id:h.id,reasons:h.score.reasons,flags:h.score.flags})),scores:rows.map(h=>({id:h.id,score:h.score.value,view:h.score.view}))};});
 for(const id of ['zillow','rew','facebook','apartments']){const r=report.find(r=>r.source===id)!;reports[id]=`${r.candidates} trial candidates captured; ${r.reviewedPhotos} photos reviewed; ${r.active} meet current desk filters. ${r.pending?'Some gallery work remains.':'Hard failures excluded before photo retrieval.'}`;}
 reports.zumper='Three trial candidates contain interior photographs, not only floor plans. Photos are representative; exact-suite views remain unverified.';
 store.set('trialSourceReports',reports);await mkdir('data/live/remaining-trial',{recursive:true});await writeFile('data/live/remaining-trial/coverage.json',JSON.stringify({at:new Date().toISOString(),sources:report},null,2));
 console.log(JSON.stringify(report.map(({source,candidates,reviewedPhotos,pending,active})=>({source,candidates,reviewedPhotos,pending,active})),null,2));
}finally{store.close();}
