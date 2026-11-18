import {z} from 'zod';
import {hash,type Store} from './db.ts';
import {sourceFilteredIntake} from './search-area.ts';
import type {AreaMixPolicy} from './area-mix.ts';

export function areaMixSettings(store:Store){
 const policy=store.get<AreaMixPolicy>('areaMixPolicy');
 return {enabled:!!policy&&sourceFilteredIntake(store),downtownPercent:policy?Math.round(policy.downtownShare*100):null,revision:hash(JSON.stringify(policy??null))};
}
/** This is intake allocation, not scoring criteria. A changed target starts a
 * future-only counting window without rewriting a saved apartment or decision. */
export function updateAreaMixSettings(store:Store,input:unknown){
 const patch=z.object({revision:z.string().regex(/^[a-f0-9]{64}$/),downtownPercent:z.number().int().min(0).max(100)}).strict().parse(input);
 return store.transaction(()=>{
  const current=areaMixSettings(store);
  if(current.revision!==patch.revision)throw Error('Area target changed while this form was open. Reload current settings and try again.');
  if(!sourceFilteredIntake(store))throw Error('Configure geographic source searches before setting an area target.');
  const busy=store.db.prepare("SELECT 1 FROM plans WHERE (state IN ('approved','running') OR id IN (SELECT plan_id FROM parallel_scan_members)) AND json_extract(caps,'$.purpose')='listings' AND COALESCE(json_extract(caps,'$.assessmentMode'),'quick')='quick' LIMIT 1").get();
  if(busy)throw Error('A listing scan is running or approved. Finish it before changing the area target.');
  if(current.downtownPercent===patch.downtownPercent)return current;
  const previous=store.get<AreaMixPolicy>('areaMixPolicy');
  const configuredAt=new Date(Math.max(Date.now(),(Date.parse(previous?.configuredAt??'')||0)+1)).toISOString();
  const policy:AreaMixPolicy={downtownShare:patch.downtownPercent/100,configuredAt,baselineHomeIds:(store.db.prepare('SELECT id FROM homes').all() as {id:number}[]).map(home=>home.id)};
  store.set('areaMixPolicy',policy);
  store.event(`New-listing target updated: ${patch.downtownPercent}% Downtown Vancouver, ${100-patch.downtownPercent}% North/West Vancouver, with checked-inventory fallback. Existing apartments and scan scheduling unchanged.`);
  return areaMixSettings(store);
 });
}
