/** Recovery never clears website pauses or treats an empty parser result as exhaustion. */
export type SourceRecovery={failures:number;retryAt:number;detail:string};
export function sourceRecovery(detail:string,previous:SourceRecovery|undefined,now=Date.now()):SourceRecovery|undefined{
 if(!/timeout|timed out|failed|error|paused|challenge|warning|not recognized|no (?:rental links|listing cards)|disconnected|not connected|could not|interrupted|stalled|awaiting its turn/i.test(detail))return undefined;
 const failures=(previous?.failures??0)+1;
 // A persistent parser/connection problem gets only one probe per hour after two retries.
 const delay=failures===1?300000:failures===2?900000:3600000;
 return {failures,retryAt:now+delay,detail};
}
export function recoveryReady(recovery:SourceRecovery|undefined,health:{needs_attention?:number;paused_until?:string|null}|undefined,now=Date.now()){
 return !health?.needs_attention&&!(Date.parse(health?.paused_until??'')>now)&&(!recovery||recovery.retryAt<=now);
}
