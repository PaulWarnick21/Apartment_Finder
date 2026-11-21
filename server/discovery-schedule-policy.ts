export type DiscoverySchedule={version:1;enabled:boolean;timeZone:'America/Toronto';authorizedAt:string;notBefore:string};
export const discoveryLimits={global:{pages:600,listings:300,photos:6000},source:{pages:150,listings:100,photos:1800},facebook:{pages:40,listings:30,photos:600},batch:{pages:20,listings:12,photos:400,minutes:8}} as const;
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',weekday:'short',hour:'2-digit',hourCycle:'h23'});
export function discoveryWindowOpen(now:Date){const parts=formatter.formatToParts(now),hour=Number(parts.find(p=>p.type==='hour')!.value),day=parts.find(p=>p.type==='weekday')!.value;return hour>=21||hour<3||['Mon','Tue','Wed','Thu'].includes(day)&&hour>=5&&hour<13;}
export function discoveryWindowEnd(now:Date){
 if(!discoveryWindowOpen(now))return null;
 let next=new Date(Math.floor(now.getTime()/60000)*60000+60000);
 for(let minute=0;minute<24*60;minute++,next=new Date(next.getTime()+60000))if(!discoveryWindowOpen(next))return next;
 throw Error('Scheduled window must have a finite end');
}
export function discoveryAuthorized(schedule:DiscoverySchedule|undefined,now:Date){return schedule?.version===1&&schedule.enabled&&schedule.timeZone==='America/Toronto'&&Number.isFinite(Date.parse(schedule.authorizedAt))&&Date.parse(schedule.notBefore)<=now.getTime()&&discoveryWindowOpen(now);}
export function sourceCadence(valid72h:number,attempts72h:number,dryStreak:number){
 let minutes=valid72h>=6&&(!attempts72h||valid72h/attempts72h>=.1)?30:valid72h>=2?120:valid72h===1?360:360;
 if(dryStreak>=2)minutes=Math.max(minutes,120);if(dryStreak>=3)minutes=Math.max(minutes,360);if(dryStreak>=6)minutes=Math.max(minutes,1440);
 return minutes;
}
export function pauseLowYield(valid72h:number,checks:number,since:string,now:Date){return valid72h<2&&checks>=3&&now.getTime()-Date.parse(since)>=72*3600000;}
