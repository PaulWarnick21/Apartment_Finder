import type {Store} from './db.ts';

/** Rename the previous Ready to Apply stage once; later final approvals stay final. */
export function migrateSeriousCandidates(store:Store){
 const key='seriousCandidatesStageV1';if(store.get(key))return false;
 return store.transaction(()=>{
  if(store.get(key))return false;
  const rows=store.db.prepare("SELECT id,revision FROM homes WHERE stage='Ready to Apply'").all() as {id:number;revision:number}[];
  const renamed=new Map(rows.map(row=>[row.id,row.revision]));
  const rename=(value:Record<string,unknown>)=>{if(value.stage==='Ready to Apply')value.stage='Serious Candidates';return value;};
  // Historical stage names and merge restore snapshots must retain their old meaning.
  for(const row of store.db.prepare('SELECT id,before_json,after_json FROM history').all() as {id:number;before_json:string|null;after_json:string|null}[]){
   const before=row.before_json?rename(JSON.parse(row.before_json)):null,after=row.after_json?rename(JSON.parse(row.after_json)):null;
   if(before?.stage==='Serious Candidates'||after?.stage==='Serious Candidates')store.db.prepare('UPDATE history SET before_json=?,after_json=? WHERE id=?').run(before?JSON.stringify(before):null,after?JSON.stringify(after):null,row.id);
  }
  for(const row of store.db.prepare('SELECT id,keep_id,snapshot,merged_revision FROM home_merges').all() as {id:number;keep_id:number;snapshot:string;merged_revision:number}[]){
   const snapshot=JSON.parse(row.snapshot);rename(snapshot.keep);rename(snapshot.duplicate);
   store.db.prepare('UPDATE home_merges SET snapshot=?,merged_revision=? WHERE id=?').run(JSON.stringify(snapshot),row.merged_revision+(renamed.get(row.keep_id)===row.merged_revision?1:0),row.id);
  }
  store.db.prepare("UPDATE homes SET stage='Serious Candidates',revision=revision+1 WHERE stage='Ready to Apply'").run();
  store.db.prepare("UPDATE desk_membership SET category='Serious Candidates' WHERE category='Ready to Apply'").run();
  store.set(key,{at:new Date().toISOString(),renamedHomeIds:rows.map(row=>row.id)});
  store.event(`Added the final review stage: ${rows.length} existing Ready to Apply apartment(s) moved to Serious Candidates. Future Ready to Apply decisions require this review step.`);
  return true;
 });
}
