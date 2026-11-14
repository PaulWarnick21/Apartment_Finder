import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Store} from './db.ts';
import {Budget,claimPlan,getPlan,assertAccessRecoveryCaps} from './plans.ts';
import {ChromeJobs} from './chrome-jobs.ts';
import {sourceById} from './sources.ts';
import {discoverSource,nextDiscovery} from './source-discovery.ts';

/** Explicit, single-page recovery only. Never called by a regular scan or startup. */
export async function recoverZillowChrome(store:Store,id:string,dataDir:string,jobs:ChromeJobs){
 const plan=getPlan(store,id);assertAccessRecoveryCaps(plan.caps);if(plan.caps.sources[0]!=='zillow')throw new Error('Zillow recovery only');
 claimPlan(store,id);const budget=new Budget(store,id,plan.caps);let state='partial',detail='Zillow recovery did not complete.';
 try{
  const source=sourceById('zillow'),page=await jobs.request(budget,source.search,'discovery',null,0,true);
  const urls=discoverSource(page.html,source);if(page.truncated||!urls.length)throw new Error('No Zillow rental links recognized; source pause retained');
  const folder=join(dataDir,'chrome-scans',id);await mkdir(folder,{recursive:true});await writeFile(join(folder,'discovery.json'),JSON.stringify(page));
  budget.check(); // Cancellation during snapshot storage must not clear a source pause.
  store.set('discoveryQueue:zillow',{urls,next:nextDiscovery(page.html,source)});
  store.db.prepare('UPDATE source_health SET paused_until=NULL,needs_attention=0,reason=NULL,last_success=? WHERE source=?').run(new Date().toISOString(),'zillow');
  state='complete';detail=`Explicit normal-Chrome recovery succeeded: ${urls.length} rental links discovered. No listings imported or AI calls made.`;
 }catch(e){detail=String(e instanceof Error?e.message:e);}finally{
  jobs.fail('Recovery finished');if(getPlan(store,id).state!=='cancelled')store.db.prepare('UPDATE plans SET state=?,detail=? WHERE id=?').run(state,detail,id);
  store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(id);store.event(detail);
 }
}
