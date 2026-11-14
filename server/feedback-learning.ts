import {criteriaSchema,listingSchema,type Criteria,type Listing} from '../src/domain.ts';
import type {Store} from './db.ts';
import {scoreBase} from './scoring.ts';
import {scoringFacts,feedbackFeatures,assessedFacts} from './scoring-facts.ts';

/** Only user feedback is passed here, never listing copy or model-generated instructions. */
export function explicitPreferences(criteria:Criteria,reason:string){
 const next=structuredClone(criteria),changes:string[]=[];
 const distance=reason.match(/\b(?:max out at|maximum(?: score)?(?: of)?|cap(?:ped)?(?: at)?)\s*(\d(?:\.\d)?)/i);
 if(/far (?:out of|from)|farther (?:out of|from)/i.test(reason)&&/downtown/i.test(reason)&&distance){const n=Number(distance[1]);if(n>=.1&&n<=5){next.farFromDowntownCeiling=n;changes.push(`Far-from-downtown ceiling ${n}, except great verified views`);}}
 const floor=reason.match(/(?:at least|minimum(?: of)?)\s*(\d{1,2}|five|ten)\s*(?:floors?|storeys?|stories)/i);
 if(floor){const n=Number(({five:5,ten:10} as Record<string,number>)[floor[1].toLowerCase()]??floor[1]);if(n>=1&&n<=100){next.preferredMinFloor=n;changes.push(`Prefer floor ${n} or higher`);}}
 if(/street[- ]level views should be avoided|avoid (?:the )?street[- ]level/i.test(reason)){next.streetLevelCeiling=2.9;changes.push('Street-level views below the review threshold');}
 return {criteria:criteriaSchema.parse(next),changes};
}
export function feedbackFacts(input:Listing,reason:string,feedbackId:number){
 const l=scoringFacts(input);
 if(/\bdated (?:kitchen|interiors?|bathroom)\b|kitchen is dated/i.test(reason)&&!/not (?:a )?dated|isn.t dated/i.test(reason)){l.modern=false;l.evidence.modern=`User assessment in feedback #${feedbackId}: ${reason}`;}
 if(/\bcramped\b|looks (?:a bit |too )?tight\b/i.test(reason)&&!/not cramped|isn.t cramped/i.test(reason)){l.cramped=true;l.evidence.cramped=`User assessment in feedback #${feedbackId}: ${reason}`;}
 return l;
}
export function rebuildLearning(store:Store,base=store.criteria){
 const rows=store.db.prepare("SELECT id,home_id,user_score,reason,listing_json,score_json FROM rating_feedback WHERE status!='reverted' ORDER BY id").all() as {id:number;home_id:number;user_score:number;reason:string;listing_json:string;score_json:string}[];
 let criteria=criteriaSchema.parse({...base,learnedExamples:[],userAssessments:{}});const ruleChanges:string[]=[];
 for(const row of rows){const parsed=explicitPreferences(criteria,row.reason);criteria=parsed.criteria;ruleChanges.push(...parsed.changes);}
 const latest=new Map<number,typeof rows[number]>();for(const row of rows)latest.set(row.home_id,row);
 for(const row of rows){
  const original=listingSchema.parse(JSON.parse(row.listing_json)),listing=feedbackFacts(original,row.reason,row.id),key=listing.source+':'+listing.sourceId;
  const facts={...(criteria.userAssessments[key]??{}),feedbackId:row.id};
  if(listing.evidence.modern?.startsWith('User assessment'))facts.modern=listing.modern!;
  if(listing.evidence.cramped?.startsWith('User assessment'))facts.cramped=listing.cramped!;
  if(facts.modern!==undefined||facts.cramped!==undefined)criteria.userAssessments[key]=facts;
 }
 const examples=[...latest.values()].map(row=>{
  const listing=feedbackFacts(listingSchema.parse(JSON.parse(row.listing_json)),row.reason,row.id);
  return {feedbackId:row.id,homeId:row.home_id,key:listing.source+':'+listing.sourceId,originalScore:JSON.parse(row.score_json).value,target:row.user_score,baseline:scoreBase(listing,criteria).value,features:feedbackFeatures(assessedFacts(listing,criteria))};
 });
 return {criteria:criteriaSchema.parse({...criteria,learnedExamples:examples}),ruleChanges:[...new Set(ruleChanges)]};
}
export function assertFeedbackReady(store:Store){
 const row=store.db.prepare("SELECT home_id,status FROM rating_feedback WHERE origin='app' AND status IN ('pending','reviewing','failed','needs-attention') AND id IN (SELECT MAX(id) FROM rating_feedback WHERE status!='reverted' GROUP BY home_id) ORDER BY id LIMIT 1").get() as {home_id:number;status:string}|undefined;
 if(row)throw new Error(`Finish the feedback review for apartment #${row.home_id} before scanning so new apartments use your latest preferences (${row.status}).`);
}
