import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Store} from './db.ts';
import {Budget,claimPlan,getPlan,assertAccessRecoveryCaps,assertRecoveryCooldown} from './plans.ts';
import {sourceById} from './sources.ts';
import {SourceSession} from './transport.ts';
import {discoverSource} from './source-discovery.ts';
import {areaSearchRoutes,sourceFilteredIntake} from './search-area.ts';

/** Explicit one-page check using Kijiji's existing scanner profile, never a fallback identity. */
export async function recoverKijijiSource(store:Store,id:string,dataDir:string,makeSession=(budget:Budget)=>new SourceSession(sourceById('kijiji'),budget,dataDir,{accessRecovery:true})){
 const plan=getPlan(store,id);assertAccessRecoveryCaps(plan.caps);
 if(plan.caps.sources[0]!=='kijiji')throw Error('Kijiji recovery requires a Kijiji-only plan');
 assertRecoveryCooldown(store,'kijiji');
 const source=sourceById('kijiji'),route=areaSearchRoutes(store,'kijiji')[0];
 if(sourceFilteredIntake(store)&&!route)throw Error('Configure a geographic search before checking source access');
 const url=route?.url??source.search;
 claimPlan(store,id);const budget=new Budget(store,id,plan.caps);let session:SourceSession|undefined,state='partial',detail='Kijiji recovery did not complete.';
 try{
  session=makeSession(budget);await session.start();const html=await session.html(url);
  const folder=join(dataDir,'access-checks',id);await mkdir(folder,{recursive:true});
  if(html)await writeFile(join(folder,'discovery.html'),html);
  await writeFile(join(folder,'diagnostics.json'),JSON.stringify(session.diagnostics));
  const urls=html?discoverSource(html,source,url):[];
  if(session.stopped||!urls.length)throw Error('No usable Kijiji rental results recognized; source pause retained');
  budget.check();
  store.db.prepare('UPDATE source_health SET paused_until=NULL,needs_attention=0,reason=NULL,last_success=? WHERE source=?').run(new Date().toISOString(),'kijiji');
  state='complete';detail=`Kijiji recovery succeeded: ${urls.length} rental links recognized using the existing scanner profile. No apartments imported, photos downloaded or AI calls made.`;
 }catch(error){detail=error instanceof Error?error.message:String(error);}
 finally{
  await session?.close().catch(()=>{});
  if(getPlan(store,id).state!=='cancelled')store.db.prepare('UPDATE plans SET state=?,detail=? WHERE id=?').run(state,detail,id);
  store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(id);store.event(detail);
 }
}
