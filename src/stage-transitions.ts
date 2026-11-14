import {stages,type Home} from './domain';
export type Stage=Home['stage'];
export function stageGroup(stage:Stage){
 if(stage==='Unreviewed'||stage==='Interested')return stage;
 if(['In Progress','Inquiry Sent','Viewing Booked','Applied'].includes(stage))return 'In Progress';
 return 'Closed';
}
export function canTransition(from:Stage,to:Stage){
 if(from===to)return true;
 const a=stageGroup(from),b=stageGroup(to);
 if(a==='Closed')return false;
 if(b==='Closed')return to!=='Leased'||a==='In Progress';
 return a==='Unreviewed'&&b==='Interested'||a==='Interested'&&b==='In Progress'||a==='In Progress'&&b==='In Progress';
}
export function stageOptions(from:Stage){return stages.filter(to=>canTransition(from,to));}
