export const availabilityStages = new Set(['Interested','Serious Candidates','Ready to Apply','In Progress','Inquiry Sent','Viewing Booked','Applied']);
export type AvailabilityObservation = {source:string;sourceId:string;url:string;status:'available'|'unavailable'|'unknown';checkedAt:string;runId:string;evidence:string;attempted?:boolean};
export type HomeAvailability = {status:AvailabilityObservation['status'];checkedAt:string;postings:AvailabilityObservation[];detail:string};

/** A live cross-post wins; every confirmed posting must be closed to mark the home closed. */
export function summarizeAvailability(postings:AvailabilityObservation[],possibleDuplicates=false,now=Date.now()):HomeAvailability|undefined {
 if(!postings.some(p=>p.checkedAt))return undefined;
 const latest=postings.map(p=>p.checkedAt).sort().at(-1)!;
 const current=postings.map(p=>({...p,status:now-Date.parse(p.checkedAt)>36*3600000||!p.checkedAt?'unknown' as const:p.status}));
 const available=current.some(p=>p.status==='available');
 const unavailable=current.length>0&&current.every(p=>p.status==='unavailable')&&!possibleDuplicates;
 return {status:available?'available':unavailable?'unavailable':'unknown',checkedAt:latest,postings:current,
  detail:available?'Still advertised on at least one confirmed listing.':unavailable?'All known listings for this apartment are explicitly unavailable.':possibleDuplicates&&current.every(p=>p.status==='unavailable')?'Known listings are unavailable; possible duplicates still need an identity decision.':'Availability could not be verified across all known listings.'};
}
