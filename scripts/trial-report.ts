import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {Store} from '../server/db.ts';
import {sources} from '../server/sources.ts';
const dir=resolve('data/live'),store=new Store(join(dir,'apartments.sqlite'));
try{
 const rows=JSON.parse(await readFile(join(dir,'initial-trial/extracted.json'),'utf8')) as any[];
 const homes=store.homes().filter(h=>rows.some(r=>r.listing.source===h.listing.source&&r.listing.sourceId===h.listing.sourceId));
 const reports:Record<string,string>={},summary:any[]=[];
 for(const s of sources){const items=homes.filter(h=>h.listing.source===s.id),health=store.health().find(h=>h.source===s.id),photos=items.flatMap(h=>h.listing.photos),reviewed=photos.filter(p=>p.status==='reviewed').length,downloaded=photos.filter(p=>p.local).length,excluded=items.filter(h=>h.score.reasons.length).length;
 const note=items.length?`${items.length} ${s.id==='zumper'?'floor-plan candidates (exact units unconfirmed)':'candidates'} saved; ${reviewed}/${downloaded} retrieved photos reviewed; ${excluded} hard exclusions. ${s.adapter==='pending'?'Recurring discovery adapter remains disabled.':'Further scans await approval.'}`:health?.reason??'No unit results';
 reports[s.id]=note;summary.push({source:s.name,candidates:items.length,downloaded,reviewed,hardExclusions:excluded,status:health?.reason??note});
 }
 store.set('trialSourceReports',reports);store.event('Initial all-source trial finished. Results are ready for review; further scanning awaits approval.');
 const report={checkedAt:new Date().toISOString(),sources:summary,totals:{candidates:homes.length,downloaded:summary.reduce((n,s)=>n+s.downloaded,0),reviewed:summary.reduce((n,s)=>n+s.reviewed,0),hardExclusions:summary.reduce((n,s)=>n+s.hardExclusions,0)},apartments:homes.map(h=>({id:h.id,source:h.listing.source,title:h.listing.title,rent:h.listing.rent,score:h.score.value,range:[h.score.low,h.score.high],eligible:h.score.eligible,view:h.score.view,hardReasons:h.score.reasons,photos:h.listing.photos.length,reviewed:h.listing.photos.filter(p=>p.status==='reviewed').length}))};
 await writeFile(join(dir,'initial-trial/final-report.json'),JSON.stringify(report,null,2));await store.backupTo(resolve('data/backups/after-all-source-trial.sqlite'));
 console.log(JSON.stringify(report,null,2));
}finally{store.close();}
