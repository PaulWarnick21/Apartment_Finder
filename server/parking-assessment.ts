import type {Listing} from '../src/domain.ts';

/** Unit advertising supports confidence, not a guarantee about unadvertised spaces. */
export function parkingAssessment(l:Listing):{penalty:number;label:string}{
 const unknown={penalty:0,label:'Parking Unsure'};
 if(l.offeringKind!=='unit'||l.conflicts.some(c=>/parking/i.test(c)))return unknown;
 const text=[l.evidence.parking??'',l.description].join('\n');
 const clauses=text.split(/\n|[.!?;]|\s+-\s+/).filter(s=>/\bparking\b/i.test(s)&&! /\b(?:bicycle|bike|visitor|guest)\s+parking|\b(?:other|some|select|all)\s+(?:units|suites|apartments)/i.test(s));
 const likely=clauses.some(s=>/\bparking\b.{0,60}\b(?:wait[- ]?list|probably unavailable|likely unavailable)|\b(?:wait[- ]?list)\b.{0,40}\bparking\b/i.test(s));
 const notIncluded=clauses.some(s=>/\bno parking included\b|\bparking\s+(?:is\s+)?not included\b/i.test(s));
 const absent=clauses.some(s=>/\bno parking(?:\s+(?:spaces?|spots?|stalls?))?(?:\s+available)?\s*$|\bparking(?:\s+(?:spaces?|spots?|stalls?))?\s+(?:is\s+|are\s+)?(?:not available|unavailable)\b|\bstreet parking only\b/i.test(s)&&! /\b(?:may|might|probably|likely|possibly|not sure|uncertain)\b/i.test(s));
 if(l.parking==='included'||l.parking==='extra'&&!likely)return unknown;
 if(absent||l.parking==='none'&&!notIncluded&&!likely)return {penalty:1,label:'Parking unavailable (confirmed)'};
 if(likely)return {penalty:.75,label:'Parking likely unavailable'};
 if(notIncluded)return {penalty:.5,label:'No parking included; separate availability unconfirmed'};
 return unknown;
}
