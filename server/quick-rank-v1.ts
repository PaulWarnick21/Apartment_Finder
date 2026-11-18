// Frozen November 18 ranking arithmetic: used to preserve ranks from pre-update databases.
import type {Criteria,Listing,QuickRank} from '../src/domain.ts';
import {assessedFacts} from './scoring-facts.ts';
import {isApartmentUnit,sharedRoomEvidence} from './listing-rental-scope.ts';
import {listingUnavailable} from './listing-availability.ts';
import {parkingAssessment} from './parking-assessment.ts';

/** The intake limits are personal configuration, independent of full-score ceilings. */
export function quickIntakeLimits(criteria:Criteria){
 return criteria.quickIntake??{minRent:0,maxRent:criteria.maxRent,minPhotos:0,allowedBeds:[]};
}
const hasConflict=(l:Listing,pattern:RegExp)=>l.conflicts.some(value=>pattern.test(value));
const outsideRegion=(l:Listing)=>/^(?:Calgary|Toronto|Ottawa|Edmonton|Victoria|Kelowna)(?:,?\s+(?:BC|AB|ON|Canada))?$/i.test(l.area.trim())||/[,\n]\s*(?:Calgary|Toronto|Ottawa|Edmonton|Victoria|Kelowna)\s*(?:,\s*(?:BC|AB|ON|Canada)|$)/i.test(l.address);
const advertisedNature=(description:string)=>description.split(/[.!?;\n]/).some(clause=>/\b(?:mountain|ocean|sea|water|forest)\s+(?:and\s+\w+\s+)?views?\b|\bviews?\s+of\s+(?:the\s+)?(?:mountains?|ocean|sea|water|forest)\b/i.test(clause)&&!/\b(?:no|without|not|rooftop|roof deck|amenit\w*|shared|lounge)\b/i.test(clause));

/** Fast local ordering only: no new visual assessment, research or model request.
 * Missing facts are flags, not invented failures. A low grade never rejects a home.
 * Full-review evidence gates deliberately do not control this preliminary rank. */
export function quickRank(input:Listing,criteria:Criteria,homeId=input.homeId):QuickRank {
 const l=assessedFacts(input,criteria,homeId),limits=quickIntakeLimits(criteria);
 const failures:string[]=[],flags:string[]=[],reasons:string[]=[];
 if(!isApartmentUnit(l))failures.push(sharedRoomEvidence(l)?'A whole apartment is required':l.evidence.nonRental==='true'?'Not an apartment rental':'A specific apartment is required, rather than a building or floorplan offer');
 if(listingUnavailable(l))failures.push('The listing explicitly says this apartment is unavailable');
 const rentConflict=hasConflict(l,/\brent\b|\bprice\b/i),bedsConflict=hasConflict(l,/\bbed(?:room)?s?\b/i);
 if(l.rent===null||rentConflict)flags.push(rentConflict?'Conflicting rent needs confirmation':'Monthly rent not confirmed');
 else if(l.rent<limits.minRent||limits.maxRent!==null&&l.rent>limits.maxRent)failures.push('Advertised monthly rent is outside the intake range');
 if(l.beds===null||bedsConflict)flags.push(bedsConflict?'Conflicting bedroom count needs confirmation':'Bedroom count not confirmed');
 else if(limits.allowedBeds.length&&!limits.allowedBeds.includes(l.beds))failures.push('Bedroom count is outside the intake range');
 const attached=new Set(l.photos.map(photo=>photo.url)).size;
 if(attached<limits.minPhotos){
  if(l.galleryComplete||l.expectedPhotos!==null&&l.expectedPhotos<limits.minPhotos)failures.push('Too few photos are attached to the listing');
  else flags.push('Photo count is not yet confirmed; collection remains incomplete');
 }
 if(criteria.requireLaundry){
  if(['shared-only','none'].includes(l.laundry)&&!hasConflict(l,/laundry|washer/i))failures.push('In-unit laundry is required');
  else if(l.laundry!=='in-unit'||hasConflict(l,/laundry|washer/i))flags.push('In-unit laundry not confirmed');
 }
 if(outsideRegion(l))failures.push('The advertised location is outside the Vancouver search region');
 if(l.downtownDistance==='unknown')flags.push('Location and downtown distance not confirmed');
 if(!l.galleryComplete)flags.push('Full gallery collection is not confirmed');

 let value=55;
 const add=(amount:number,reason:string)=>{value+=amount;reasons.push(reason);};
 if(l.rent!==null&&!rentConflict){
  const priceEffect=Math.max(-20,Math.min(20,(criteria.priceAnchor-l.rent)*criteria.priceSlope*30));
  if(Math.abs(priceEffect)>=2)add(priceEffect,priceEffect>0?'Lower advertised rent improves value':'Higher advertised rent reduces value');
 }
 if(l.downtownDistance==='downtown')add(12,'Downtown Vancouver location');
 else if(l.downtownDistance==='nearby')add(-8,'Outside downtown, in a nearby neighbourhood');
 else if(l.downtownDistance==='far')add(-20,'Farther from downtown Vancouver');

 const reviewed=l.photos.filter(p=>p.status==='reviewed'&&p.kind==='interior'&&p.unitCertain&&!p.attributionPending);
 const nature=reviewed.filter(p=>p.scenery==='nature'&&p.quality!==null);
 if(nature.length){
  const quality=Math.max(...nature.map(p=>p.quality!));
  add((quality-2)*8,quality>=4?'Previously reviewed unit-window photos show a strong nature outlook':'Previously reviewed unit-window photos show only a partial nature outlook');
 }else if(reviewed.some(p=>p.scenery==='buildings'))add(-15,'Reviewed unit-window photos show a building-facing outlook; other outlooks remain uncertain');
 else if(advertisedNature(l.title+'\n'+l.description))add(5,'The advertisement claims a nature view; this has not been verified');
 if(!nature.length)flags.push('A qualifying actual-unit nature view is unverified');
 if(l.beds===2&&!bedsConflict){const taper=l.rent===null?0:Math.max(0,Math.min(1,(criteria.secondBedroomZeroBonusRent-l.rent)/Math.max(1,criteria.secondBedroomZeroBonusRent-criteria.secondBedroomFullBonusRent)));if(taper)add(4*taper,'A second bedroom adds flexibility');}
 else if(l.beds===1&&l.workspace===true)add(4,'A workspace is recorded');
 for(const [present,amount,label] of [[l.furnished===true,3,'Furnishing is advertised'],[l.shortLease===true,3,'A short lease is advertised'],[l.openPlan===true,2,'An open layout is recorded'],[l.gas===true,2,'Gas cooking is recorded'],[l.modern===true,5,'Modern interiors are recorded'],[l.modern===false,-5,'Dated interiors are recorded'],[l.cramped===true,-4,'Cramped space is recorded']] as const)if(present)add(amount,label);
 const parking=parkingAssessment(l);if(parking.penalty)add(-parking.penalty*8,parking.label);
 if(l.floorLevel!==null&&!hasConflict(l,/floor|storey|story/i)&&l.floorLevel<=1)add(-10,'The apartment is at street level');
 value=Math.round(Math.max(0,Math.min(100,value)));
 const grade:QuickRank['grade']=value>=85?'S':value>=70?'A':value>=55?'B':value>=40?'C':value>=25?'D':value>=15?'E':'F';
 return {grade,rankValue:value,eligible:failures.length===0,reasons:failures.length?failures:reasons,flags:[...new Set(flags)]};
}
