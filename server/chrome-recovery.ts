import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Store} from './db.ts';
import {Budget,claimPlan,getPlan,assertAccessRecoveryCaps} from './plans.ts';
import {ChromeJobs} from './chrome-jobs.ts';
import {sourceById} from './sources.ts';
import {discoverSource,listingUrl} from './source-discovery.ts';
import {areaSearchRoutes,sourceFilteredIntake} from './search-area.ts';

/** Explicit, single-page recovery only. Never called by a regular scan or startup. */
export async function recoverChromeSource(store:Store,id:string,dataDir:string,jobs:ChromeJobs){
 const plan=getPlan(store,id);assertAccessRecoveryCaps(plan.caps);const sourceId=plan.caps.sources[0];if(!['apartments','zillow'].includes(sourceId))throw new Error('Chrome recovery supports Apartments.com and Zillow only');
 const source=sourceById(sourceId),route=areaSearchRoutes(store,sourceId)[0];
 if(sourceFilteredIntake(store)&&!route)throw new Error('Configure a geographic search before checking source access');
 const url=route?.url??source.search;
 claimPlan(store,id);const budget=new Budget(store,id,plan.caps);let state='partial',detail=`${source.name} recovery did not complete.`;
 try{
  const page=await jobs.request(budget,url,'discovery',null,0,true);
  const urls=[...new Set([...discoverSource(page.html,source,url),...page.links.map(link=>listingUrl(link,source,url)).filter((link):link is string=>!!link)])];
  const folder=join(dataDir,'chrome-scans',id);await mkdir(folder,{recursive:true});await writeFile(join(folder,'discovery.json'),JSON.stringify(page));
  if(page.truncated||!urls.length)throw new Error(`No complete ${source.name} rental results recognized; source pause retained`);
  budget.check(); // Cancellation during snapshot storage must not clear a source pause.
  // An access check must not replace the saved inventory/frontier or import homes.
  store.db.prepare('UPDATE source_health SET paused_until=NULL,needs_attention=0,reason=NULL,last_success=? WHERE source=?').run(new Date().toISOString(),sourceId);
  state='complete';detail=`${source.name} normal-Chrome recovery succeeded: ${urls.length} rental links recognized. Existing inventory retained; no listings imported or AI calls made.`;
 }catch(e){detail=String(e instanceof Error?e.message:e);}finally{
  jobs.fail('Recovery finished',id);if(getPlan(store,id).state!=='cancelled')store.db.prepare('UPDATE plans SET state=?,detail=? WHERE id=?').run(state,detail,id);
  store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(id);store.event(detail);
 }
}
export const recoverZillowChrome=recoverChromeSource;
