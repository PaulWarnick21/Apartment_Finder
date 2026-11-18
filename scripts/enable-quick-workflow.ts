import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Store} from '../server/db.ts';
import {criteriaSchema,quickGrades} from '../src/domain.ts';
import {deskCategory} from '../src/desk-category.ts';
import {chatGpt} from '../server/chatgpt.ts';
import {readAccountUsage,validateAccountUsage,closeAccountUsage} from '../server/account-usage.ts';
import {rankSources} from '../server/source-yield.ts';
import {savedSourceYieldStats} from '../server/source-feedback.ts';
import {z} from 'zod';

// Local configuration/migration only: never approve a listing plan or start a worker.
const configSchema=z.object({quickIntake:criteriaSchema.shape.quickIntake.unwrap(),fullReview:z.object({stopAt:z.number().positive().max(100),maxPages:z.number().int().min(2).max(1200),maxPhotos:z.number().int().positive().max(30000),maxAiCalls:z.number().int().positive().max(2000)})});
const config=configSchema.parse(JSON.parse(readFileSync(resolve('private/quick-workflow.json'),'utf8')));
const dir=resolve('data/live'),store=new Store(join(dir,'apartments.sqlite'));
try{
 if(store.db.prepare('SELECT 1 FROM scan_lock WHERE id=1').get()||store.db.prepare("SELECT 1 FROM plans WHERE state IN ('approved','running')").get())throw new Error('Finish or recover the active scan before changing workflows.');
 const connection=await chatGpt(dir).state();if(!connection.sharing||!connection.model)throw new Error('The existing ChatGPT plan/model must be configured for automatic full reviews.');
 const measured=await readAccountUsage() as {accountId:string};validateAccountUsage(measured,measured.accountId,config.fullReview.stopAt);
 const backup=resolve('data/live/backups',`before-quick-workflow-${Date.now()}`);mkdirSync(backup,{recursive:true});await store.backupTo(join(backup,'apartments.sqlite'));copyFileSync('private/settings.json',join(backup,'settings.json'));copyFileSync('private/criteria.md',join(backup,'criteria.md'));
 const decisions=()=>JSON.stringify(store.db.prepare('SELECT id,stage,notes,follow_up,viewing,revision,rescued FROM homes ORDER BY id').all());const before=decisions();
 store.transaction(()=>{
  store.set('criteria',criteriaSchema.parse({...store.criteria,quickIntake:config.quickIntake}));
  store.set('reviewWorkflow',{mode:'quick-first',version:1,enabledAt:new Date().toISOString()});
  store.set('fullReviewPolicy',{...config.fullReview,accountId:measured.accountId,profileId:connection.active,maxPublicResearchRequests:2});
  for(const home of store.homes()){
   if(!['Interested','Ready to Apply','In Progress','Inquiry Sent','Viewing Booked','Applied'].includes(home.stage)||home.fullReview)continue;
   const listing=home.listing,complete=home.quickRank?.eligible===false||listing.galleryComplete&&listing.photos.length>0&&(listing.expectedPhotos===null||listing.photos.length>=listing.expectedPhotos)&&listing.photos.every(p=>p.status==='reviewed'&&!p.attributionPending);
   store.set(`fullReview:${home.id}`,{status:complete?'complete':'paused',detail:complete?'Saved full assessment reused without new requests. Unverified facts remain labelled in the detailed score.':'This previously Interested apartment has incomplete saved evidence. Retry full scoring to finish it.',updatedAt:new Date().toISOString()});
  }
  store.event('Quick-first workflow enabled locally: letter grades for Unreviewed, full scoring on Interested, then Ready to Apply. Existing decisions and evidence retained. No scan started.');
  if(decisions()!==before)throw new Error('User decisions changed during migration.');
 });
 const privateSettings=JSON.parse(readFileSync('private/settings.json','utf8'));writeFileSync('private/settings.json',JSON.stringify({...privateSettings,quickIntake:config.quickIntake},null,2)+'\n');
 const homes=store.homes(),categories=Object.fromEntries([...new Set(homes.map(deskCategory))].map(k=>[k,homes.filter(h=>deskCategory(h)===k).length]));
 const grades=Object.fromEntries(quickGrades.map(k=>[k,homes.filter(h=>deskCategory(h)==='Unreviewed'&&h.quickRank?.grade===k).length]));
 const result={at:new Date().toISOString(),backup,decisionsPreserved:decisions()===before,saved:homes.length,categories,grades,sourcePriority:rankSources(savedSourceYieldStats(store,Date.now(),homes)),workerActive:false,scanStarted:false};
 writeFileSync(resolve('data/quick-workflow-activation.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({backup,decisionsPreserved:result.decisionsPreserved,categories,grades,preferredSource:result.sourcePriority[0]?.source,scanStarted:false}));
}finally{closeAccountUsage();store.close();}
