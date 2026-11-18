/** Apply the user's November 18 clarification locally, preserving original feedback. */
import {writeFileSync} from 'node:fs';
import {Store} from '../server/db.ts';
import {criteriaSchema} from '../src/domain.ts';
import {rebuildLearning} from '../server/feedback-learning.ts';
if(!process.argv.includes('--apply'))throw Error('Use --apply only after the user confirms the initial-move exception.');
const store=new Store('data/live/apartments.sqlite');
try{
 if(store.db.prepare("SELECT 1 FROM plans WHERE state IN ('approved','running') UNION SELECT 1 FROM scan_lock UNION SELECT 1 FROM parallel_scan_members").get())throw Error('Wait for active scans before applying this scoring change.');
 const backup=`data/live/initial-move-before-${Date.now()}.sqlite`;await store.backupTo(backup);
 store.transaction(()=>{
  const row=store.db.prepare('SELECT * FROM rating_feedback WHERE home_id=89 ORDER BY id DESC LIMIT 1').get() as any;
  if(!row||row.status!=='needs-attention'||!/short.term/i.test(row.reason)||!/view-first ceiling/.test(row.error))throw Error('Feedback changed; inspect before resolving.');
  store.set(`feedbackResolutionOriginal:${row.id}`,row);
  const next=rebuildLearning(store,criteriaSchema.parse({...store.criteria,initialMoveShortTermException:true})).criteria;
  store.set('criteria',next);
  const original=JSON.parse(row.review_json),resolution='User explicitly authorized a nice, reasonably priced, furnished short-term exception for the initial move. Implemented an evidence-based alternative fit capped at 3.5, preserving hard requirements and the 4.0+ nature-view gate. Conflicting rent or missing listing facts remain uncertain and do not block other assessments.';
  const review={...original,interpretation:resolution,unresolved:[],changes:[],outcome:'User clarification applied; initial-move exception enabled. Original rating and review retained in history.'};
  store.db.prepare("UPDATE rating_feedback SET status='applied',error='',review_json=? WHERE id=?").run(JSON.stringify(review),row.id);
  store.set(`feedbackResolution:${row.id}`,{at:new Date().toISOString(),reason:resolution,backup});
  store.event(`Resolved feedback #${row.id} for apartment #89 from the user's explicit initial-move clarification; waiting full assessments may resume.`);
 });
 writeFileSync('private/settings.json',JSON.stringify(store.criteria,null,2)+'\n');
 console.log(JSON.stringify({enabled:store.criteria.initialMoveShortTermException,feedbackResolved:89,backup}));
}finally{store.close();}
