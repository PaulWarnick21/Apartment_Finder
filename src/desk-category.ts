import type {Home} from './domain';
export function deskCategory(home:Pick<Home,'score'|'stage'|'rescued'>){
 if(home.score.value<3||(!home.score.eligible&&!home.rescued))return 'Excluded';
 if(['Not Interested','Closed','Leased'].includes(home.stage))return 'Closed';
 if(home.stage==='Interested')return 'Interested';
 if(['In Progress','Inquiry Sent','Viewing Booked','Applied'].includes(home.stage))return 'In Progress';
 return 'Unreviewed';
}
