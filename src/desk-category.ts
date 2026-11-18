import type {Home} from './domain';
import {fullReviewComplete} from './review-presentation';
export function deskCategory(home:Pick<Home,'score'|'stage'|'rescued'|'reviewMode'|'quickRank'|'fullReview'|'deskExclusion'>){
 if(home.deskExclusion&&!['Not Interested','Closed','Leased'].includes(home.stage))return 'Excluded';
 if(home.reviewMode){
  if(['Not Interested','Closed','Leased'].includes(home.stage))return 'Closed';
  if(home.stage==='Interested')return fullReviewComplete(home)?'Interested':'Scoring in Progress';
  if(home.stage==='Ready to Apply')return 'Ready to Apply';
  if(['In Progress','Inquiry Sent','Viewing Booked','Applied'].includes(home.stage))return 'In Progress';
  return home.quickRank?.eligible===false?'Excluded':'Unreviewed';
 }
 if(home.score.value<3||(!home.score.eligible&&!home.rescued))return 'Excluded';
 if(['Not Interested','Closed','Leased'].includes(home.stage))return 'Closed';
 if(home.stage==='Interested')return 'Interested';
 if(home.stage==='Ready to Apply')return 'Ready to Apply';
 if(['In Progress','Inquiry Sent','Viewing Booked','Applied'].includes(home.stage))return 'In Progress';
 return 'Unreviewed';
}
