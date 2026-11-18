import type {Criteria,Listing,QuickRank} from '../src/domain.ts';
import {assessedFacts} from './scoring-facts.ts';
import {quickRank as legacyQuickRank} from './quick-rank-v1.ts';
import {correctStudioBedrooms} from '../src/bedrooms.ts';
import {bedroomIntakeExclusion} from './bedroom-intake.ts';
import {parkingAssessment} from './parking-assessment.ts';
export {quickIntakeLimits} from './quick-rank-v1.ts';

/** Future intake only. Arithmetic remains local; address lookup is a separate bounded step. */
export function quickRank(input:Listing,criteria:Criteria,homeId=input.homeId):QuickRank{
 input=correctStudioBedrooms(input);
 const rank=legacyQuickRank(input,criteria,homeId),l=assessedFacts(input,criteria,homeId),bedroomFailure=bedroomIntakeExclusion(input,criteria,homeId);
 if(bedroomFailure){rank.eligible=false;rank.reasons=[bedroomFailure,...rank.reasons.filter(reason=>!/Bedroom count is outside/.test(reason))];}
 const flags=[...rank.flags];
 const locationVerified=l.evidence.addressLookupStatus==='verified'&&l.downtownDistance!=='unknown';
 if(!locationVerified)flags.push(l.evidence.addressLookupDetail||'Exact address location has not been verified');
 const complete=l.galleryComplete&&l.photos.length>=2&&(l.expectedPhotos===null||l.photos.length>=l.expectedPhotos)
  &&l.photos.every(p=>p.local&&p.status==='reviewed'&&!p.attributionPending);
 const strongView=l.photos.some(p=>p.status==='reviewed'&&p.kind==='interior'&&p.unitCertain&&!p.attributionPending&&p.scenery==='nature'&&(p.quality??0)>=4);
 const conflictingView=l.photos.some(p=>p.status==='reviewed'&&p.kind==='interior'&&p.unitCertain&&(p.scenery==='buildings'||p.scenery==='nature'&&(p.quality??0)<4));
 const premium=l.rent!==null&&l.rent+(l.parkingCost??0)>=criteria.premiumRentThreshold;
 const exceptional=l.photos.some(p=>p.kind==='interior'&&p.unitCertain&&p.scenery==='nature'&&(p.quality??0)>=4.5)&&l.modern===true&&l.openPlan===true&&l.cramped===false;
 const confident=rank.eligible&&flags.length===0&&locationVerified&&complete&&strongView&&!conflictingView&&l.allOutlooksCovered
  &&l.rent!==null&&l.beds!==null&&l.floorLevel!==null&&l.floorLevel>=Math.max(3,criteria.preferredMinFloor??3)
  &&l.modern===true&&l.cramped===false&&l.conflicts.length===0&&parkingAssessment(l).penalty===0
  &&(l.parking==='included'||l.parking==='extra'&&l.parkingCost!==null)&&(!premium||exceptional);
 const isS=rank.rankValue>=92&&confident;
 if(rank.rankValue>=85&&!isS)flags.push('S requires an exceptional overall fit, a verified address, complete saved photo review and a convincing actual-unit nature view without major unresolved concerns');
 return {...rank,grade:isS?'S':rank.grade==='S'?'A':rank.grade,rankValue:isS?rank.rankValue:Math.min(91,rank.rankValue),flags:[...new Set(flags)]};
}
