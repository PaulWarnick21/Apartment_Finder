import type {Listing} from '../src/domain.ts';
import {createHash} from 'node:crypto';
import {locationQuery} from './location-map.ts';

export type VerifiedLocation={area:string;downtownDistance:'downtown'|'nearby'|'far';checkedAt:string;source:string};
export function verifiedLocationKey(listing:Listing){const query=locationQuery(listing);return query?.street?'verifiedLocation:'+createHash('sha256').update(query.query.toLowerCase().replace(/\s+/g,' ').trim()).digest('hex'):null;}
export function applyVerifiedLocation(listing:Listing,saved:VerifiedLocation|undefined):Listing{
 if(!saved)return listing;
 return {...listing,area:saved.area,downtownDistance:saved.downtownDistance,location:saved.downtownDistance==='downtown'?'downtown':'unknown',evidence:{...listing.evidence,location:`Address match and City of Vancouver boundary: ${saved.area}; checked ${saved.checkedAt}`,locationSource:saved.source}};
}

/** Scoped saved advertising only. No visits, geocoding, or inference of missing facts. */
export function enrichListingContext(input:Listing):Listing{
 const l={...input,evidence:{...input.evidence},monthlyCharges:[...(input.monthlyCharges??[])]};
 const canonical=(value:string)=>/^utilit/i.test(value)?'Utilities':value[0].toUpperCase()+value.slice(1).toLowerCase();
 l.monthlyCharges=l.monthlyCharges.map(c=>({...c,label:canonical(c.label)}));
 const conflicted=new Set<string>();
 const text=input.description;
 const sentences=text.split(/(?:[.!?](?:\s|$)|\n|;)/).map(s=>s.trim()).filter(Boolean);
 // Only this advertised unit can establish its parking terms. Building and
 // floorplan amenities do not prove an included private space for an actual suite.
 if(l.offeringKind==='unit'){
  const claims:{kind:'included'|'extra'|'none';amount:number|null;count:number|null;statement:string}[]=[];
  for(const sentence of sentences){
   if(sentence.length>400||!/\bparking\b/i.test(sentence)||/\b(?:other|some|select|all|various|multiple)\s+(?:units|suites|apartments)|\b(?:show|display|model)\s*(?:unit|suite)|\b(?:visitor|guest|street|shared|communal)\s+parking\b/i.test(sentence))continue;
   const fee=sentence.match(/\bparking(?:\s+(?:spot|space|stall))?\s*(?:is\s+)?(?:available\s+)?(?:for\s+)?(?:(?:an?\s+)?(?:additional|extra)\s+|(?:costs?|fee(?:\s+of)?)\s+)?[:=-]?\s*\$([\d,]+(?:\.\d{1,2})?)(\s*(?:\/\s*(?:mo(?:nth)?|mth)\b|per\s+month\b|monthly\b))?/i);
   if(fee&&!/\b(?:deposit|refundable|one[- ]time|annual|yearly)\b/i.test(sentence)){
    const amount=Number(fee[1].replaceAll(',',''));
    if(amount>0&&amount<=2000)claims.push({kind:'extra',amount:fee[2]?amount:null,count:null,statement:sentence+(fee[2]?'':' (Advertised amount has no stated billing frequency.)')});
    continue;
   }
   if(/\bno parking(?:\s+(?:space|spaces|spot|spots|available))?(?=\s*(?:[,.!?;]|$))|\bparking (?:is )?not available\b/i.test(sentence)){claims.push({kind:'none',amount:null,count:null,statement:sentence});continue;}
   if(/\b(?:optional|extra|additional|available|subject to availability|waitlist|not|building|community|amenit\w*)\b/i.test(sentence))continue;
   const included=/\b(?:comes? with|includes?)\s+(?:(?:one|[12])\s+)?(?:(?:spacious|secure|underground|garage|private|assigned|dedicated)\s+){0,5}parking\b|\bparking(?:\s+(?:spot|space|stall))?\s*(?:is\s+)?included\b/i.test(sentence)
    ||/\b(?:suite|apartment|home|unit)\s+is\s+(?:fully\s+)?furnished\s+with\b[^.!?]{0,100}\butilities\b[^.!?]{0,60}\binternet\b[^.!?]{0,30}\b(?:and\s+)?parking\b/i.test(sentence);
   if(included){const count=sentence.match(/\b(one|[12])\s+(?:(?:spacious|secure|underground|garage|private|assigned|dedicated)\s+){0,5}parking\b/i)?.[1];claims.push({kind:'included',amount:null,count:count?count.toLowerCase()==='one'?1:Number(count):null,statement:sentence});}
  }
  if(claims.length){
   const kinds=new Set(claims.map(c=>c.kind)),costs=new Set(claims.map(c=>c.amount).filter((n):n is number=>n!==null));
   const parkingConflict=l.conflicts.some(c=>/\bparking\b/i.test(c))||kinds.size>1||costs.size>1||l.parking!=='unknown'&&!kinds.has(l.parking)||l.parkingCost!==null&&costs.size>0&&!costs.has(l.parkingCost);
   if(parkingConflict){l.parking='unknown';l.parkingCost=null;l.parkingCount=null;l.conflicts=[...new Set([...l.conflicts,'Parking terms conflict; confirm inclusion and monthly cost for this suite.'])];}
   else {l.parking=claims[0].kind;l.parkingCost=claims[0].kind==='extra'?[...costs][0]??null:null;l.parkingCount=claims.find(c=>c.count!==null)?.count??l.parkingCount;l.evidence.parking=claims.map(c=>c.statement).join('; ');}
  }
  if(/\bstudio\s*(?:\+|and|with)\s*(?:a\s+)?mini[- ]?bedroom\b/i.test(text)&&l.beds!==null&&l.beds>0){l.conflicts=[...new Set([...l.conflicts,'Bedroom layout is described as studio + mini-bedroom; confirm whether the advertised bedroom is a separate enclosed bedroom.'])];}
 }
 for(const sentence of sentences){
  if(sentence.length>400||/optional|not required|waived|deposit|one[- ]time|refundable|annual|yearly|other (?:units|suites)|penthouse suites/i.test(sentence))continue;
  const fee=sentence.match(/\b(?:mandatory|required)\s+(?:monthly\s+)?(utilities|utility|amenity|service|internet|water|heating|storage)(?:\s+(?:fee|charge|package))?\s*(?:of|is|:)?\s*\$([\d,]+(?:\.\d{1,2})?)\s*(?:\/(?:mo(?:nth)?)\b|per month\b|monthly\b)/i)
   ??sentence.match(/\b(utilities|utility|amenity|service|internet|water|heating|storage)\s+(?:fee|charge|package)\s*(?:of|is|:)?\s*\$([\d,]+(?:\.\d{1,2})?)\s*(?:\/(?:mo(?:nth)?)\b|per month\b|monthly\b)[^.!?]{0,60}\b(?:mandatory|required)\b/i);
  if(!fee)continue;const amount=Number(fee[2].replaceAll(',',''));if(!Number.isFinite(amount)||amount<=0||amount>2000)continue;
  const label=canonical(fee[1]);if(conflicted.has(label))continue;
  const existing=l.monthlyCharges.find(c=>c.label.toLowerCase()===label.toLowerCase());
  if(existing&&existing.amount!==amount){conflicted.add(label);l.conflicts=[...l.conflicts,`${label} monthly fee conflicts; confirm with the landlord.`];l.monthlyCharges=l.monthlyCharges.filter(c=>c.label!==label);continue;}
  if(!existing)l.monthlyCharges.push({label,amount,evidence:sentence});
 }
 // A dedicated availability field is preferable; descriptions are used only for explicit dates.
 if(l.available==='Unknown'){
  const dates=sentences.filter(sentence=>sentence.length<=400&&!/\b(?:other|select|some|all|various|multiple)\s+(?:units|suites|apartments)|\b(?:amenit\w*|pool|gym|fitness|parking|storage|building|penthouse|show\s*suite|model\s*(?:unit|suite))\b|\b(?:not|unconfirmed|tentative|may|might)\b/i.test(sentence))
   .flatMap(sentence=>{const found=sentence.match(/\bavailable\s+(?:for (?:move[- ]?in|occupancy)\s*)?(?:on|from|starting)?\s*(now|immediately|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?|20\d{2}-\d{2}-\d{2})\b/i);return found?[found]:[];});
  if(new Set(dates.map(found=>found[1].toLowerCase())).size===1){l.available=dates[0][1];l.evidence.availability=dates[0][0];}
 }
 return l;
}
