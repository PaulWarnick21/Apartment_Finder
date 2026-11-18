import type {Criteria,Listing} from '../src/domain.ts';
import {correctStudioBedrooms,studioTitleEvidence} from '../src/bedrooms.ts';
import {assessedFacts} from './scoring-facts.ts';

/** Current factual eligibility is independent of a preserved historical rank. */
export function bedroomIntakeExclusion(input:Listing,criteria:Criteria,homeId=input.homeId){
 const allowed=criteria.quickIntake?.allowedBeds??[];
 if(!allowed.length)return undefined;
 const listing=assessedFacts(correctStudioBedrooms(input),criteria,homeId);
 if(listing.beds===null)return undefined;
 const user=(homeId===undefined?undefined:criteria.userAssessments[`home:${homeId}`])??criteria.userAssessments[input.source+':'+input.sourceId];
 if(user?.beds===undefined&&!studioTitleEvidence(input.title)&&listing.conflicts.some(value=>/\bbed(?:room)?s?\b/i.test(value)))return undefined;
 if(allowed.includes(listing.beds))return undefined;
 return listing.beds===0?'Studio apartment — excluded by your bedroom requirements.':'Bedroom count is outside your intake requirements.';
}
