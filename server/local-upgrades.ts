import type {Store} from './db.ts';
import {rebuildLearning} from './feedback-learning.ts';

export const learningVersion='interior-tradeoff-v2';
/** Purely local migration: retain ratings and decisions, rebuild derived calibration once. */
export function applyLocalUpgrades(store:Store){
 if(store.get('learningVersion')===learningVersion)return false;
 return store.transaction(()=>{
  const before=store.criteria;
  store.set('learningBefore:'+learningVersion,before);
  store.set('criteria',rebuildLearning(store,before).criteria);
  store.set('learningVersion',learningVersion);
  store.event('Local scoring update applied: consistent view/price rules and context-aware feedback. Ratings, photos and user stages retained.');
  return true;
 });
}
