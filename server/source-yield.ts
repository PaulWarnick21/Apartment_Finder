import type {Home} from '../src/domain.ts';
import {isApartmentUnit} from './listing-rental-scope.ts';

export type SourceYieldStat={source:string;uniqueUnits:number;fullyReviewed:number;factualExclusions:number;incomplete:number;strongMatches:number;provisionalMatches:number;userInterested:number;userReviewed:number;recentInterested:number;recentReviewed:number;positiveSignals:number;signalSample:number;basis:'user-interest'|'confirmed'|'provisional'|'insufficient';weight:number};
export type SourceDecision={homeId:number;interested:boolean;at:string};
export const sourceFeedbackHalfLifeDays=14;
export const sourceFeedbackMaxAgeDays=90;
const interested=new Set(['Interested','Serious Candidates','Ready to Apply','In Progress','Inquiry Sent','Viewing Booked','Applied','Leased']);
const closedNegative=new Set(['Not Interested','Closed']);
export const sourceInterestOutcome=(stage:string):boolean|null=>interested.has(stage)?true:stage==='Not Interested'?false:null;
const complete=(h:Home)=>h.listing.galleryComplete&&h.listing.photos.length>0&&(h.listing.expectedPhotos===null||h.listing.photos.length>=h.listing.expectedPhotos)&&h.listing.photos.every(p=>p.status==='reviewed'&&!p.attributionPending);

/** Attribute a distinct saved home once, to its primary discovery source. Cross-posts
 * and repeat attempts cannot multiply hits. Incomplete evidence is not a negative review. */
export function sourceYieldStats(homes:readonly Home[],options:{now?:number;decisions?:readonly SourceDecision[]}={}):SourceYieldStat[]{
 const distinct=[...new Map(homes.filter(h=>isApartmentUnit(h.listing)).map(h=>[h.id,h])).values()];
 const decisions=new Map<number,SourceDecision>(),now=options.now??Date.now();
 // Older stores without decision history retain their known choices, dated to
 // first discovery rather than a scanner refresh or note edit.
 const evidence=options.decisions??distinct.flatMap(h=>{const outcome=sourceInterestOutcome(h.stage);return outcome===null?[]:[{homeId:h.id,interested:outcome,at:h.firstSeen}];});
 for(const decision of evidence){const prior=decisions.get(decision.homeId);if(!prior||Date.parse(decision.at)>Date.parse(prior.at))decisions.set(decision.homeId,decision);}
 const recency=(decision:SourceDecision)=>{const at=Date.parse(decision.at);if(!Number.isFinite(at))return 0;const age=Math.max(0,(now-at)/86400000);return age>sourceFeedbackMaxAgeDays?0:2**(-age/sourceFeedbackHalfLifeDays);};
 const stats=[...new Set(distinct.map(h=>h.listing.source))].map(source=>{
  const units=distinct.filter(h=>h.listing.source===source),full=units.filter(complete);
  const isProvisional=(h:Home)=>complete(h)&&h.score.eligible&&h.score.value>=3&&!closedNegative.has(h.stage);
  const isInterested=(h:Home)=>decisions.get(h.id)?.interested===true;
  const positives=units.filter(h=>isProvisional(h)||isInterested(h));
  const sample=units.filter(h=>complete(h)||isInterested(h));
  const feedback=units.flatMap(h=>{const decision=decisions.get(h.id);return decision?[decision]:[];});
  return {source,uniqueUnits:units.length,fullyReviewed:full.length,factualExclusions:units.filter(h=>!complete(h)&&h.quickRank?.eligible===false).length,incomplete:units.filter(h=>!complete(h)&&h.quickRank?.eligible!==false).length,strongMatches:full.filter(h=>h.score.eligible&&h.score.value>=4&&!closedNegative.has(h.stage)).length,provisionalMatches:full.filter(isProvisional).length,userInterested:feedback.filter(d=>d.interested).length,userReviewed:feedback.length,recentInterested:feedback.filter(d=>d.interested).reduce((n,d)=>n+recency(d),0),recentReviewed:feedback.reduce((n,d)=>n+recency(d),0),positiveSignals:positives.length,signalSample:sample.length,basis:'insufficient' as SourceYieldStat['basis'],weight:0};
 });
 const reviewed=stats.reduce((sum,s)=>sum+s.userReviewed,0),strong=stats.reduce((sum,s)=>sum+s.strongMatches,0),signals=stats.reduce((sum,s)=>sum+s.positiveSignals,0);
 // User choices take precedence even if every recent decision is negative.
 // Unreviewed apartments, failed scans and unfinished scoring are not rejections.
 const basis:SourceYieldStat['basis']=reviewed?'user-interest':strong?'confirmed':signals?'provisional':'insufficient';
 const successes=reviewed?stats.reduce((sum,s)=>sum+s.recentInterested,0):strong||signals;
 const denominator=stats.reduce((sum,s)=>sum+(reviewed?s.recentReviewed:strong?s.fullyReviewed:s.signalSample),0);
 const prior=reviewed?(successes+1)/(denominator+2):denominator?successes/denominator:0;
 // Eight pooled pseudo-observations temper a lucky small sample. This is allocation,
 // not a confidence claim or a modification to any apartment's score.
 for(const stat of stats){stat.basis=basis;const n=reviewed?stat.recentReviewed:strong?stat.fullyReviewed:stat.signalSample,k=reviewed?stat.recentInterested:strong?stat.strongMatches:stat.positiveSignals;stat.weight=basis==='insufficient'||!n?0:(k+8*prior)/(n+8);}
 return stats;
}

export function rankSources(stats:readonly SourceYieldStat[]){return [...stats].sort((a,b)=>b.weight-a.weight||b.recentInterested-a.recentInterested||(a.basis==='user-interest'?b.recentReviewed-a.recentReviewed:b.fullyReviewed-a.fullyReviewed)||a.source.localeCompare(b.source));}
export type SourceChoice={source:string;mode:'priority'|'exploration';basis:string};
export type SourceSelectionState={selectionCount:number;lastSelected:Record<string,string|number>};
const visit=(value:string|number|undefined)=>typeof value==='number'?value:typeof value==='string'?(Date.parse(value)||Number.NEGATIVE_INFINITY):Number.NEGATIVE_INFINITY;

/** Three bounded priority phases then one exploration phase. The caller persists
 * selectionCount/lastSelected after dispatch and supplies only unpaused work. */
export function chooseSource(candidates:readonly string[],stats:readonly SourceYieldStat[],state:SourceSelectionState):SourceChoice|null{
 const available=[...new Set(candidates)];if(!available.length)return null;
 const ranked=rankSources(stats).filter(s=>available.includes(s.source));
 const leader=ranked.find(s=>s.weight>0&&(s.basis==='user-interest'?s.recentInterested>0:s.basis==='confirmed'?s.strongMatches>0:s.basis==='provisional'&&s.positiveSignals>0));
 const leastRecent=(ids:string[])=>ids.sort((a,b)=>visit(state.lastSelected[a])-visit(state.lastSelected[b])||available.indexOf(a)-available.indexOf(b))[0];
 if(!leader)return {source:leastRecent(available),mode:'exploration',basis:'No supported positive outcomes yet; rotate through available sources'};
 if(available.length>1&&state.selectionCount%4===3)return {source:leastRecent(available.filter(id=>id!==leader.source)),mode:'exploration',basis:'Reserved exploration share for other available sources'};
 return {source:leader.source,mode:'priority',basis:leader.basis==='user-interest'?'Prioritize recent Interested decisions among user-reviewed apartments; older choices carry less weight':leader.basis==='confirmed'?'No user decisions yet; prioritize supported completed strong-match yield':'No user decisions or confirmed strong-match winner yet; prioritize provisional matches'};
}
