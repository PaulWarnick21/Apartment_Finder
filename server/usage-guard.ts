import type {Store} from './db.ts';

/** A supervised run fails closed if its external account-usage monitor disappears. */
export type UsageCheckpoint={checkedAt:number;usedPercent:number;stopAt:number;allowAiThrough:number;expiresAt?:number};
export type UsagePolicy={stopAt:number;scheduledLimit?:{stopAt:number;effectiveAt:string;reason:string};usageOverride?:{stopAt:number;authorizedAt:string;expiresAt:string;reason:string}};
/** Temporary user authorization cannot silently extend into another day/week. */
export function effectiveUsagePolicy(policy:UsagePolicy,now=Date.now()){
 const override=policy.usageOverride;
 if(override&&Date.parse(override.authorizedAt)<=now&&now<Date.parse(override.expiresAt)){
  if(!Number.isFinite(override.stopAt)||override.stopAt<=0||override.stopAt>100)throw Error('Invalid authorized usage limit');
  return {stopAt:override.stopAt,expiresAt:Date.parse(override.expiresAt)};
 }
 const scheduled=policy.scheduledLimit;
 if(scheduled){
  const effectiveAt=Date.parse(scheduled.effectiveAt);
  if(!Number.isFinite(effectiveAt)||!Number.isFinite(scheduled.stopAt)||scheduled.stopAt<=0||scheduled.stopAt>100)throw Error('Invalid scheduled usage limit');
  if(now>=effectiveAt)return {stopAt:scheduled.stopAt};
 }
 if(!Number.isFinite(policy.stopAt)||policy.stopAt<=0||policy.stopAt>100)throw Error('Invalid usage limit');
 return {stopAt:policy.stopAt};
}
export function usageCheckpoint(store:Store,id:string,now=Date.now()){
 const value=store.get<UsageCheckpoint>(`usageGuard:${id}`);
 if(value===undefined||value===null)return null;
 if(!Number.isFinite(value.checkedAt)||now-value.checkedAt>90000||value.checkedAt>now+5000||
    !Number.isFinite(value.usedPercent)||value.usedPercent<0||value.usedPercent>100||
    !Number.isFinite(value.stopAt)||value.stopAt<=0||value.stopAt>100||
    value.expiresAt!==undefined&&(!Number.isFinite(value.expiresAt)||now>=value.expiresAt)||
    !Number.isInteger(value.allowAiThrough)||value.allowAiThrough<0)
  throw new Error('Account usage checkpoint unavailable or stale; scan stopped');
 if(value.usedPercent>=value.stopAt)throw new Error('Weekly usage reserve reached; scan stopped');
 return value;
}
