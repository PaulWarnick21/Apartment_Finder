import type {Criteria} from './domain';
export function editedPreferences(before:Criteria,after:Criteria){
 const changes:Record<string,unknown>={};
 for(const key of ['maxRent','rentBasis','requireLaundry'] as const)if(before[key]!==after[key])changes[key]=after[key];
 const bonuses:Record<string,number>={};for(const key of Object.keys(after.bonuses) as (keyof Criteria['bonuses'])[])if(before.bonuses[key]!==after.bonuses[key])bonuses[key]=after.bonuses[key];
 if(Object.keys(bonuses).length)changes.bonuses=bonuses;return changes;
}
