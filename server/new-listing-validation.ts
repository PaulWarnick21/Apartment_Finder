import {listingSchema,type Listing} from '../src/domain.ts';
import type {Store} from './db.ts';
import type {Budget} from './plans.ts';
import {unitIdentity,compatibleUnit} from './listing-integrity.ts';
import {listingUnavailable} from './listing-availability.ts';
type Outcome={url:string;result:'created'|'existing'|'parse-failure'|'unavailable'|'building';homeId?:number;reason?:string};
type SourceProgress={attempts:number;newHomeIds:number[];outcomes:Outcome[]};
type Progress={baselineHomeIds:number[];sources:Record<string,SourceProgress>};
const key=(budget:Budget)=>`newListingValidation:${budget.id}`;
export function initializeNewValidation(budget:Budget){if(!budget.caps.newListingsOnly||budget.store.get(key(budget)))return;budget.store.set(key(budget),{baselineHomeIds:(budget.store.db.prepare('SELECT id FROM homes').all() as {id:number}[]).map(row=>row.id),sources:{}} satisfies Progress);}
function progress(budget:Budget){initializeNewValidation(budget);return budget.store.get<Progress>(key(budget))!;}
function update(budget:Budget,source:string,fn:(value:SourceProgress)=>void){if(!budget.caps.newListingsOnly)return;const current=progress(budget),entry=current.sources[source]??={attempts:0,newHomeIds:[],outcomes:[]};fn(entry);budget.store.set(key(budget),current);}
export function validationAttempt(budget:Budget,source:string){update(budget,source,value=>value.attempts++);}
export function validationOutcome(budget:Budget,source:string,outcome:Outcome){update(budget,source,value=>{value.outcomes.push(outcome);if(outcome.result==='created'&&outcome.homeId&&!value.newHomeIds.includes(outcome.homeId))value.newHomeIds.push(outcome.homeId);});}
export function validationTargetReached(budget:Budget,source:string){return !!budget.caps.newListingsOnly&&(progress(budget).sources[source]?.newHomeIds.length??0)>=(budget.caps.targetNewListingsPerSource??2);}
/** Reuse exactly the store's confirmed-identity rules; ambiguous matches stay separate. */
function existingHome(store:Store,listing:Listing){const post=store.db.prepare('SELECT home_id FROM postings WHERE source=? AND source_id=?').get(listing.source,listing.sourceId) as {home_id:number}|undefined;if(post)return store.resolveHomeId(post.home_id);const identity=unitIdentity(listing);if(!identity)return null;const found=store.db.prepare('SELECT id,listing FROM homes WHERE identity=?').get(identity) as {id:number;listing:string}|undefined;if(!found)return null;const id=store.resolveHomeId(found.id),row=id===found.id?found:store.db.prepare('SELECT id,listing FROM homes WHERE id=?').get(id) as typeof found;return row&&compatibleUnit(listingSchema.parse(JSON.parse(row.listing)),listing)?id:null;}
/** New-only validation never mutates or reprocesses a known apartment, including confirmed cross-posts. */
export function ingestNewCandidate(store:Store,budget:Budget,source:string,listing:Listing){
 if(!budget.caps.newListingsOnly)return store.ingest(listing);
 if(listingUnavailable(listing)){validationOutcome(budget,source,{url:listing.url,result:'unavailable',reason:'Source explicitly marks this rental unavailable'});return null;}
 if(listing.offeringKind==='building'||listing.evidence.nonRental==='true'){validationOutcome(budget,source,{url:listing.url,result:'building',reason:listing.evidence.nonRental==='true'?'Record is explicitly not an apartment rental':'Building advertisement is not a specific apartment offering'});return null;}
 return store.transaction(()=>{const existing=existingHome(store,listing);if(existing!==null){validationOutcome(budget,source,{url:listing.url,result:'existing',homeId:existing});return null;}const result=store.ingest(listing);validationOutcome(budget,source,{url:listing.url,result:'created',homeId:result.id});return result;});
}
export function validationSummary(budget:Budget,source:string){if(!budget.caps.newListingsOnly)return {};const p=progress(budget).sources[source]??{attempts:0,newHomeIds:[],outcomes:[]};return {newListings:p.newHomeIds.length,targetNewListings:budget.caps.targetNewListingsPerSource??2,newHomeIds:p.newHomeIds,attemptedListings:p.attempts,skippedExisting:p.outcomes.filter(o=>o.result==='existing').length,candidateFailures:p.outcomes.filter(o=>o.result==='parse-failure'||o.result==='unavailable'||o.result==='building').length};}
