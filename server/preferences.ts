import {z} from 'zod';
import {criteriaSchema,type Criteria} from '../src/domain.ts';
import {hash,type Store} from './db.ts';
import {rebuildLearning} from './feedback-learning.ts';

const changesSchema=z.object({
 maxRent:criteriaSchema.shape.maxRent.optional(),
 rentBasis:criteriaSchema.shape.rentBasis.optional(),
 requireLaundry:z.boolean().optional(),
 bonuses:z.object({workspace:z.number().min(0).max(1).optional(),shortLease:z.number().min(0).max(1).optional(),modern:z.number().min(0).max(1).optional(),openPlan:z.number().min(0).max(1).optional(),gas:z.number().min(0).max(1).optional(),north:z.number().min(0).max(1).optional(),furnished:z.number().min(0).max(1).optional(),secondBedroom:z.number().min(0).max(1).optional(),extraParking:z.number().min(0).max(1).optional()}).strict().optional()
}).strict();
export const preferencesRevision=(criteria:Criteria)=>hash(JSON.stringify(criteria));
export function patchPreferences(store:Store,input:unknown){
 const patch=z.object({revision:z.string().regex(/^[a-f0-9]{64}$/),changes:changesSchema}).strict().parse(input);
 return store.transaction(()=>{
  const current=store.criteria;
  if(preferencesRevision(current)!==patch.revision)throw new Error('Preferences changed while this form was open. Reload Current Preferences, review your changes, and save again.');
  const next=criteriaSchema.parse({...current,...patch.changes,bonuses:{...current.bonuses,...patch.changes.bonuses}});
  store.set('criteria',rebuildLearning(store,next).criteria);
  store.event('Preferences updated; scores recalculated locally.');
  return {ok:true,revision:preferencesRevision(store.criteria),criteria:store.criteria};
 });
}
