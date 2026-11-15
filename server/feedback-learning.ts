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
 for(const [field,value] of Object.entries(conditionCorrections(reason)) as ['modern'|'cramped',boolean|null][]){l[field]=value;l.evidence[field]=`User assessment in feedback #${feedbackId}: ${reason}`;}
 return l;
}
/** Explicit corrections have field-level history; silence about a field is not a reversal. */
export function conditionCorrections(reason:string){
 const facts:Partial<Pick<Listing,'modern'|'cramped'>>={};
 const normalized=reason.replace(/[’‘]/g,"'");
 for(const clause of normalized.split(/[.!?;\n]+/)){
  const condition=/\b(?:kitchen|interiors?|bathrooms?|cabinets?|appliances?)\b/i.test(clause);
  const unsure=/\b(?:not sure|uncertain|unconfirmed|unknown|can't tell|cannot tell|cannot confirm|can't confirm|could be|might be|may be)\b/i.test(clause);
  if(condition&&/\b(?:dated|modern|updated|renovated|condition)\b/i.test(clause)){
   const notDated=/\b(?:not|isn't|aren't|no longer)\s+(?:(?:a|that|really|particularly)\s+)?dated\b/i.test(clause);
   const notModern=/\b(?:not|isn't|aren't|no longer)\s+(?:(?:a|that|really|particularly)\s+)?(?:modern|updated|renovated)\b/i.test(clause);
   const positive=/\b(?:modern|updated|renovated)\b/i.test(clause)&&!notModern;
   if(unsure)facts.modern=null;
   else if(positive)facts.modern=/\bdated\b/i.test(clause)&&!notDated?null:true;
   else if(/\bdated\b/i.test(clause))facts.modern=notDated?null:false;
   else if(notModern)facts.modern=null;
  }
  if(/\bcramped\b|looks (?:a bit |too )?tight\b|\b(?:apartment|unit|rooms?|space|layout)\b.{0,30}\bspacious\b/i.test(clause)){
   if(unsure)facts.cramped=null;
   else if(/\b(?:not|isn't|aren't|no longer)\s+(?:(?:that|really|particularly)\s+)?cramped\b|\b(?:apartment|unit|rooms?|space|layout)\b.{0,30}\bspacious\b/i.test(clause))facts.cramped=false;
   else facts.cramped=true;
  }
 }
 return facts;
}
/** A local exception still calibrates that apartment, but must not teach a global preference. */
export function feedbackScope(reason:string):'general'|'one-off'{
 return /\b(?:one[- ]off|exception|only (?:this|that|this particular|that particular) (?:apartment|unit|home|listing)|(?:this|that) (?:apartment|unit|home|listing) only|do not generalize|don't generalize|not a general preference|not for other (?:apartments|units|homes)|personal (?:connection|circumstance)|friend(?:'s)? (?:building|apartment))\b/i.test(reason)?'one-off':'general';
}
export type LearningRow={id:number;home_id:number;user_score:number;reason:string;listing_json:string;score_json:string};
export function learningFromRows(rows:LearningRow[],base:Criteria,postings:{home_id:number;source:string;source_id:string}[]=[]){
 let criteria=criteriaSchema.parse({...base,learnedExamples:[],userAssessments:{}});const ruleChanges:string[]=[];
 for(const row of rows){if(feedbackScope(row.reason)==='one-off')continue;const parsed=explicitPreferences(criteria,row.reason);criteria=parsed.criteria;ruleChanges.push(...parsed.changes);}
 const latest=new Map<number,typeof rows[number]>();for(const row of rows)latest.set(row.home_id,row);
 for(const row of rows){
  const corrections=conditionCorrections(row.reason);if(!Object.keys(corrections).length)continue;
  const key=`home:${row.home_id}`;
  criteria.userAssessments[key]={...(criteria.userAssessments[key]??{}),...corrections,feedbackId:row.id};
 }
 // Source aliases keep old callers and immutable snapshots compatible with stable home identity.
 for(const row of rows){const l=listingSchema.parse(JSON.parse(row.listing_json)),facts=criteria.userAssessments[`home:${row.home_id}`];if(facts)criteria.userAssessments[l.source+':'+l.sourceId]=facts;}
 for(const posting of postings){const facts=criteria.userAssessments[`home:${posting.home_id}`];if(facts)criteria.userAssessments[posting.source+':'+posting.source_id]=facts;}
 const examples=[...latest.values()].map(row=>{
  const listing=feedbackFacts(listingSchema.parse(JSON.parse(row.listing_json)),row.reason,row.id);listing.homeId=row.home_id;
  return {feedbackId:row.id,homeId:row.home_id,key:listing.source+':'+listing.sourceId,scope:feedbackScope(row.reason),originalScore:JSON.parse(row.score_json).value,target:row.user_score,baseline:scoreBase(listing,criteria).value,features:feedbackFeatures(assessedFacts(listing,criteria))};
 });
 return {criteria:criteriaSchema.parse({...criteria,learnedExamples:examples}),ruleChanges:[...new Set(ruleChanges)]};
}
export function rebuildLearning(store:Store,base=store.criteria){
 const rows=store.db.prepare("SELECT id,home_id,user_score,reason,listing_json,score_json FROM rating_feedback WHERE status!='reverted' ORDER BY id").all() as LearningRow[];
 const postings=store.db.prepare('SELECT home_id,source,source_id FROM postings').all() as {home_id:number;source:string;source_id:string}[];
 return learningFromRows(rows,base,postings);
}
export function assertFeedbackReady(store:Store){
 const row=store.db.prepare("SELECT home_id,status FROM rating_feedback WHERE origin='app' AND status IN ('pending','reviewing','failed','needs-attention') AND id IN (SELECT MAX(id) FROM rating_feedback WHERE status!='reverted' GROUP BY home_id) ORDER BY id LIMIT 1").get() as {home_id:number;status:string}|undefined;
 if(row)throw new Error(`Finish the feedback review for apartment #${row.home_id} before scanning so new apartments use your latest preferences (${row.status}).`);
}
