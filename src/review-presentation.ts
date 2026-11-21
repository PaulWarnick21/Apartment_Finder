import type {Home} from './domain';

/** A provisional numeric score must never stand in for an unfinished full review. */
export function fullReviewComplete(home:Pick<Home,'reviewMode'|'fullReview'>){
 if(home.reviewMode==='quick')return false;
 return home.fullReview?home.fullReview.status==='complete':true;
}
export function quickPresentation(home:Pick<Home,'reviewMode'|'fullReview'|'quickRank'>){
 return !!(home.quickRank||home.reviewMode==='quick'||home.fullReview)&&!fullReviewComplete(home);
}
export function reviewLabel(home:Pick<Home,'reviewMode'|'fullReview'|'quickRank'|'score'>){
 return quickPresentation(home)?`Quick rank ${home.quickRank?.grade??'Pending'}`:`Score ${home.score.value.toFixed(1)} / 5`;
}
export function reviewDecisions(home:Pick<Home,'stage'|'reviewMode'|'fullReview'|'quickRank'|'deskExclusion'|'revisitLater'>):{stage:Home['stage'];label:string;disabled?:boolean;revisitLater?:boolean}[]{
 if(home.deskExclusion&&['Unreviewed','Interested','Serious Candidates','Ready to Apply'].includes(home.stage))return [{stage:'Not Interested',label:'Not Interested'}];
 if(home.stage==='Unreviewed')return home.quickRank&&!home.quickRank.eligible?[{stage:'Not Interested',label:'Not Interested'}]:[{stage:'Interested',label:'Interested'},{stage:'Not Interested',label:'Not Interested'}];
 if(home.stage==='Interested')return [{stage:'Serious Candidates',label:'Serious Candidates',disabled:!fullReviewComplete(home)},...(fullReviewComplete(home)?[{stage:'Interested' as const,label:home.revisitLater?'Review Now':'Revisit Later',revisitLater:!home.revisitLater}]:[]),{stage:'Not Interested',label:'Not Interested'}];
 if(home.stage==='Serious Candidates')return [{stage:'Ready to Apply',label:'Ready to Apply',disabled:!fullReviewComplete(home)},...(fullReviewComplete(home)?[{stage:'Serious Candidates' as const,label:home.revisitLater?'Review Now':'Revisit Later',revisitLater:!home.revisitLater}]:[]),{stage:'Not Interested',label:'Not Interested'}];
 if(home.stage==='Ready to Apply')return [{stage:'In Progress',label:'In Progress'},{stage:'Not Interested',label:'Not Interested'}];
 if(['In Progress','Inquiry Sent','Viewing Booked','Applied'].includes(home.stage))return [{stage:'Closed',label:'Close'}];
 return [];
}

export const fullReviewLabels={queued:'Full scoring queued',running:'Full scoring in progress',paused:'Full scoring paused',failed:'Full scoring needs attention',complete:'Full scoring complete',cancelled:'Full scoring cancelled'} as const;
