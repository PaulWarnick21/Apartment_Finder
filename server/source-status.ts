import type {Store} from './db.ts';
import {sources} from './sources.ts';
import {deskCategory} from '../src/desk-category.ts';

/** Historical evidence and runnable app support are independent of access cooldowns. */
export function sourceStatuses(store:Store,now=Date.now()){
 const homes=store.homes(),health=store.health(),reports=store.get<Record<string,string>>('trialSourceReports')??{};
 return sources.map(source=>{
  const rows=homes.filter(h=>h.postings.some(p=>p.source===source.id));
  const state=health.find(h=>h.source===source.id);
  const paused=!!state&&(!!state.needs_attention||Date.parse(state.paused_until??'')>now);
  const ready=source.adapter!=='pending';
  const candidates=rows.length,reviewedPhotos=rows.reduce((n,h)=>n+h.listing.photos.filter(p=>p.status==='reviewed').length,0);
  const active=rows.filter(h=>!['Excluded','Closed'].includes(deskCategory(h))).length;
  return {id:source.id,name:source.name,ready,paused,health:state,
   trialRecorded:!!reports[source.id],candidates,reviewedPhotos,active,
   status:candidates?`${candidates} saved listings · ${reviewedPhotos} photos reviewed · ${active} in the active desk`:'No saved listings yet',
   scanMethod:ready?(['apartments','zillow'].includes(source.id)?'App scan through Chrome':'App scan'):(reports[source.id]?'Assisted scan only':'Not yet tested'),
   scanDetail:ready?'Included in approved scan plans. The next run checks current access and full-gallery coverage.':reports[source.id]?'The assisted test worked. Discovery is not yet connected to Plan a scan.':'Access and extraction still need a bounded test.'};
 });
}
