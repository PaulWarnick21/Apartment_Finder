import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {criteriaSchema} from '../src/domain.ts';
import {rebuildLearning} from '../server/feedback-learning.ts';
import {scoreListing} from '../server/scoring.ts';

const apply=process.argv[2]==='--apply';
if(!['--apply','--preview'].includes(process.argv[2]))throw Error('Use --preview or --apply');
const store=new Store('data/live/apartments.sqlite');
try{
 const before=store.criteria;
 if(before.fullViewPenaltyCap===1){console.log(JSON.stringify({alreadyApplied:true}));}
 else{
  const through=Math.max(Number(store.db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM rating_feedback').get()!.id),...before.learnedExamples.map(e=>e.feedbackId),0);
  const criteria=criteriaSchema.parse({...rebuildLearning(store,{...before,fullViewPenaltyCap:1,legacyViewFeedbackThrough:through,buildingViewPenalty:1}).criteria,requireNiceViewForDesk:false});
  const homes=store.homes(),changes=homes.filter(h=>h.fullReview?.status==='complete').map(h=>({id:h.id,stage:h.stage,before:h.score.value,after:scoreListing(h.listing,criteria,h.id).value})).filter(h=>h.before!==h.after);
  let backup:string|undefined;
  if(apply){
   backup=join('data/live','view-relaxation-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(backup,{recursive:true});
   await store.backupTo(join(backup,'before.sqlite'));
   writeFileSync(join(backup,'criteria-before.json'),JSON.stringify(before,null,2));
   if(existsSync('private/settings.json'))writeFileSync(join(backup,'private-settings-before.json'),readFileSync('private/settings.json'));
   store.transaction(()=>{
    store.set('criteria',criteria);
    store.set('fullViewRelaxationV1',{at:new Date().toISOString(),cap:1,legacyFeedbackThrough:through});
    store.event('User preference applied: full scoring uses at most a 1-point poor-view deduction, replacing stacked view ceilings and exclusions. Unknown views remain uncertain; historical ratings and user decisions are retained. Recalculated from saved evidence without scans or AI.');
   });
   writeFileSync('private/settings.json',JSON.stringify(criteria,null,2));
   const after=store.homes();
   for(const h of homes){const current=after.find(a=>a.id===h.id)!;for(const key of ['stage','notes','followUp','viewing','revisitLater','revision','quickRank'] as const)if(JSON.stringify(h[key])!==JSON.stringify(current[key]))throw Error(`Unexpected change to ${key} for #${h.id}`);}
  }
  console.log(JSON.stringify({applied:apply,backup,cap:criteria.fullViewPenaltyCap,changedCompletedScores:changes.length,changes},null,2));
 }
}finally{store.close();}
