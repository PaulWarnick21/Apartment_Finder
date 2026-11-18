import type {Store} from './db.ts';
import {rebuildLearning} from './feedback-learning.ts';

export const learningVersion='nice-view-desk-v1';
/** Purely local migration: retain ratings and decisions, rebuild derived calibration once. */
export function applyLocalUpgrades(store:Store){
 if(store.get('learningVersion')===learningVersion)return false;
 return store.transaction(()=>{
  const before=store.criteria;
  store.set('learningBefore:'+learningVersion,before);
  store.set('criteria',rebuildLearning(store,{...before,requireNiceViewForDesk:true,interiorTradeoff:{...before.interiorTradeoff,enabled:false}}).criteria);
  store.set('learningVersion',learningVersion);
  store.event('Local scoring update applied: the main desk requires a confirmed nice actual-unit nature view. Poor and unconfirmed views remain available in Excluded. Ratings, photos and user stages retained.');
  return true;
 });
}
