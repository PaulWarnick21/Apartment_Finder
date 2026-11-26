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
export type YieldSample={at:string;found:number;attempts:number};
/** Recent batches only: seeded historical homes must not inflate current conversion. */
export function recentSourceYield(samples:YieldSample[]){
 const sum=(rows:YieldSample[])=>rows.reduce((s,r)=>({found:s.found+r.found,attempts:s.attempts+r.attempts}),{found:0,attempts:0});
 const recent=sum(samples.slice(-3)),baseline=sum(samples.slice(-9,-3));
 const rate=recent.attempts?recent.found/recent.attempts:0,priorRate=baseline.attempts?baseline.found/baseline.attempts:0;
 const dropped=recent.attempts>=12&&baseline.attempts>=12&&baseline.found>=3&&rate<=priorRate/2;
 const low=recent.attempts>=12&&rate<.1;
 const dry=samples.length>=3&&samples.slice(-3).every(s=>s.found===0);
 return {recent,baseline,rate,priorRate,dropped,low,dry,significant:dropped||low||dry,
  productive:(samples.at(-1)?.found??0)>0&&!dropped&&!low};
}
export function sourceCadence(productive:boolean,weakStreak:number){
 return productive?0:weakStreak<=1?30:weakStreak===2?60:120;
}
export function pauseLowYield(valid72h:number,checks:number,since:string,now:Date){return valid72h<2&&checks>=3&&now.getTime()-Date.parse(since)>=72*3600000;}
