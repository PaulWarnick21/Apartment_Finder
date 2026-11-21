import type {Criteria,Listing,Score} from '../src/domain.ts';
import {assessedFacts,feedbackFeatures,sameCalibrationContext} from './scoring-facts.ts';
import {listingUnavailable} from './listing-availability.ts';
import {sharedRoomEvidence} from './listing-rental-scope.ts';
import {parkingAssessment} from './parking-assessment.ts';
import {quickRank} from './quick-rank.ts';
import {mainlandExclusion} from './mainland-location.ts';
const clamp=(n:number)=>Math.min(5,Math.max(.1,n));
const round=(n:number)=>Math.round(n*10)/10;
export function scoreBase(input:Listing,c:Criteria,homeId=input.homeId):Score {
  const l=assessedFacts(input,c,homeId);let limit=5;
  const relaxedView=c.fullViewPenaltyCap!==null;
  const flags:string[]=[],reasons:string[]=[],adjustments:{label:string;value:number}[]=[];
  // Full scoring explains the same configured hard requirements as quick intake.
  // The grade itself never contributes to the detailed numerical score.
  if(c.quickIntake){const intake=quickRank(l,c,homeId);if(!intake.eligible)reasons.push(...intake.reasons);flags.push(...intake.flags);}
  const mainlandFailure=mainlandExclusion(input,c.mainlandOnly);if(mainlandFailure&&!reasons.includes(mainlandFailure))reasons.push(mainlandFailure);
  if(l.offeringKind==='building')reasons.push('Building advertisement; an individual apartment offering is required');
  if(sharedRoomEvidence(l))reasons.push('Shared accommodation; a whole apartment is required');
  if(listingUnavailable(l))reasons.push('Source explicitly marks this rental unavailable');
  if(l.evidence.nonRental==='true')reasons.push('Not an apartment rental');
  const add=(label:string,value:number)=>adjustments.push({label,value});
  const reviewed=l.photos.filter(p=>p.status==='reviewed');
  const complete=l.galleryComplete && l.photos.length>0 && reviewed.length===l.photos.length && (l.expectedPhotos===null || l.photos.length>=l.expectedPhotos);
  const hasInteriorPhoto=reviewed.some(p=>p.kind==='interior');
  // Several supported interior benefits can make a weak-view home worth a look.
  // Furniture alone, marketing copy, and representative suites do not qualify.
  const interiorBenefits=[l.furnished===true,l.openPlan===true,l.modern===true,l.beds!==null&&l.beds<2&&l.workspace===true].filter(Boolean).length;
  const interiorTradeoff=!relaxedView&&!c.requireNiceViewForDesk&&c.interiorTradeoff.enabled&&l.rent!==null&&interiorBenefits>=3&&reviewed.some(p=>p.kind==='interior'&&p.unitCertain);
  if(!hasInteriorPhoto){
    if(complete&&reviewed.every(p=>p.kind==='floorplan'))reasons.push('Floor plans only; apartment photos required');
    else if(complete&&reviewed.every(p=>['floorplan','exterior','amenity'].includes(p.kind)))reasons.push('No apartment interior photos');
    else flags.push('Apartment photos unverified');
  }
  const views=reviewed.filter(p=>p.kind==='interior'&&p.unitCertain&&p.scenery==='nature'&&p.quality!==null);
  const quality=views.length? Math.max(...views.map(p=>p.quality!)):null;
  const buildingWindows=reviewed.some(p=>p.kind==='interior'&&p.unitCertain&&p.scenery==='buildings');
  const noNature=complete&&l.allOutlooksCovered&&!views.length&&reviewed.some(p=>p.kind==='interior'&&p.unitCertain&&p.scenery==='buildings');
  let base=c.baseScore,spread=0;
  const cost=l.rent===null?null:l.rent+(l.parking==='extra'?(l.parkingCost??0):0);
  // The initial-move exception is narrower than the general interior trade-off.
  // Use supported lease/furnishing, reviewed interiors and an advertised non-premium
  // price. It never supplies missing facts or relaxes the 4.0+ nature-view gate.
  const initialMoveException=c.initialMoveShortTermException&&l.offeringKind==='unit'
    &&l.furnished===true&&l.shortLease===true&&l.modern===true&&l.cramped!==true
    &&!!l.evidence.interiorAssessment&&complete&&reviewed.some(p=>p.kind==='interior'&&p.unitCertain&&!p.attributionPending)
    &&!reviewed.some(p=>p.attributionPending)&&cost!==null&&cost>1&&cost<c.premiumRentThreshold
    &&!l.conflicts.some(text=>/\b(?:rent|price|furnish\w*|lease|term|interior|condition|photo attribution)\b/i.test(text));
  const bedroomValue=cost===null?0:Math.max(0,Math.min(1,(c.secondBedroomZeroBonusRent-cost)/Math.max(1,c.secondBedroomZeroBonusRent-c.secondBedroomFullBonusRent)));
  const secondBedroomBonus=c.bonuses.secondBedroom*bedroomValue;
  if(l.rent!==null) base+=(c.priceAnchor-(cost??l.rent))*c.priceSlope;
  else {flags.push('Rent Unsure');spread+=.6;}
  const rentLimit=c.quickIntake?c.quickIntake.maxRent:c.maxRent;
  if(rentLimit!==null && l.rent!==null&&(!c.quickIntake||!l.conflicts.some(text=>/\brent\b|\bprice\b/i.test(text)))){
    const exceeds=(amount:number)=>c.quickIntake?amount>rentLimit:amount>=rentLimit;
    if(!c.quickIntake&&exceeds(l.rent) || (c.rentBasis==='with-parking'&&cost!==null&&exceeds(cost))) reasons.push('Rent exceeds the configured ceiling');
    else if(c.rentBasis==='unresolved'&&cost!==null&&exceeds(cost)) flags.push('Budget basis needs confirmation');
  }
  // Keep the location cost visible, apply it once, and retain larger distance penalties.
  // Transit access alone does not erase being outside the preferred downtown core.
  const outsideCore=l.downtownDistance!=='downtown'&&(l.downtownDistance==='far'||l.downtownDistance==='nearby'||l.location==='outside'||l.location==='near-transit');
  if(outsideCore){
    const deduction=l.location==='near-transit'?c.transitPenalty:l.location==='outside'||l.downtownDistance==='far'?c.outsidePenalty:c.transitPenalty/2;
    add('Outside Downtown Core',-Math.max(c.outsideDowntownMinPenalty,deduction));
  }else if(l.location==='unknown'&&l.downtownDistance==='unknown'){flags.push('Location Unsure');spread+=.5;}
  const viewContribution=quality===null?0:relaxedView?Math.max(0,quality-3)*c.viewWeight:(quality-3)*c.viewWeight;
  if(quality!==null)base+=viewContribution;
  else {flags.push('View Unverified');spread+=.8;}
  if(views.some(p=>(p.quality??0)>=4&&!p.attributionPending&&p.natureTypes?.includes('mountains')))add('Confirmed mountain outlook',c.mountainViewBonus);
  if(!complete) flags.push('Photo review pending');
  if(!relaxedView&&noNature&&!interiorTradeoff&&!initialMoveException)reasons.push('Confirmed absence of a qualifying nature outlook');
  if(c.requireLaundry && ['shared-only','none'].includes(l.laundry)&&(!c.quickIntake||!l.conflicts.some(text=>/laundry|washer/i.test(text))))reasons.push('In-unit laundry is required');
  if(c.requireLaundry && ['unknown','hookups'].includes(l.laundry))flags.push('Laundry Unsure');
  if(l.parking==='unknown' || l.parking==='extra'&&l.parkingCost===null) {flags.push('Parking Unsure');spread+=.15;}
  if(l.parkingCount!==null&&l.parkingCount>1&&l.parking==='included')add('Additional parking',c.bonuses.extraParking);
  if(l.beds===0 && !(c.studioExceptionMax!==null&&l.rent!==null&&l.rent<=c.studioExceptionMax&&quality!==null&&quality>=4&&complete))add('Studio',-c.studioPenalty);
  if(l.beds!==null&&l.beds>=2){if(secondBedroomBonus>0)add('Second bedroom',Math.round(secondBedroomBonus*100)/100);else flags.push('Second-bedroom bonus withheld at this rent');}
  else if(l.workspace===true)add('Usable workspace',c.bonuses.workspace);
  else if(l.workspace===null)flags.push('Workspace Unsure');
  for(const [field,label] of [['shortLease','Short lease'],['modern','Modern interiors'],['openPlan','Open layout'],['gas','Gas cooking'],['north','North-facing'],['furnished','Furnished']] as const)if(l[field]===true)add(label,c.bonuses[field]);
  if(l.north===null)flags.push('Orientation Unsure');
  if(l.lease==='Unknown')flags.push('Lease Term Unsure');
  if(l.beds===null)flags.push('Bedrooms Unsure');
  if(l.internet==='Unknown')flags.push('Internet Unsure');
  if(l.conflicts.length)flags.push('Conflicting listing details');
  if(l.rent!==null&&l.rent<=1||l.evidence.rentPlaceholder==='true')reasons.push('Placeholder price; actual monthly rent must be confirmed');
  if(l.modern===false)add('Dated interiors',-c.datedInteriorPenalty);
  if(l.cramped===true)add('Cramped layout',-c.crampedPenalty);
  if(c.preferredMinFloor!==null){if(l.floorLevel===null)flags.push('Floor Height Unsure');else if(l.floorLevel<c.preferredMinFloor)add('Below preferred floor height',-c.lowFloorPenalty);}
  const nonViewRaw=base-viewContribution+adjustments.reduce((sum,a)=>sum+a.value,0);
  if(relaxedView){
    // One evidence-based deduction replaces every historical view ceiling/exclusion.
    // Missing or representative outlooks do not establish a bad actual-unit view.
    const reliableView=!l.conflicts.some(t=>/\b(?:view|outlook|photo attribution)\b/i.test(t));
    const poor=quality!==null&&quality<4&&views.some(p=>!p.attributionPending);
    const buildings=quality===null&&reviewed.some(p=>p.kind==='interior'&&p.unitCertain&&!p.attributionPending&&p.scenery==='buildings');
    if(reliableView&&(poor||buildings))add(buildings?'Building-facing outlook (limited deduction)':'Limited nature outlook (limited deduction)',-Math.min(c.fullViewPenaltyCap!,buildings?c.buildingViewPenalty:Math.max(0,3-quality!)*c.viewWeight));
    if(buildingWindows)flags.push(noNature?'No qualifying nature outlook':'Building-facing window photos; other outlooks unverified');
    if(quality!==null&&quality<4)flags.push('Limited actual-unit nature view');
  }else if(!views.length&&buildingWindows)add('Building-facing outlook; no confirmed nature',-c.buildingViewPenalty);
  const raw=base+adjustments.reduce((a,b)=>a+b.value,0);
  let low=clamp(raw-spread),high=clamp(raw+spread),value=clamp(raw);
  const representativeQuality=Math.max(0,...reviewed.filter(p=>p.kind==='interior'&&p.scenery==='nature').map(p=>p.quality??0));
  const unverifiedCeiling=representativeQuality>=3.5?c.goodUnverifiedViewCeiling:c.unverifiedViewCeiling;
  if(!relaxedView&&quality===null){limit=Math.min(limit,unverifiedCeiling);if(value>unverifiedCeiling){
    add('Unverified nature view ceiling',Math.round((unverifiedCeiling-value)*100)/100);
    flags.push('A strong-match score requires a confirmed unit nature view');
    value=unverifiedCeiling;low=Math.min(low,value);high=Math.min(high,value);
  }}
  const partialCeiling=(q:number)=>{
    const weakViewCost=cost===null?0:Math.max(0,cost-c.partialViewPriceAnchor)*c.partialViewPriceSlope*Math.min(1,Math.max(0,(3.5-q)*2));
    return c.partialNatureCeiling+(q-3)*c.viewWeight-weakViewCost+(l.furnished===true?c.bonuses.furnished:0)+(l.shortLease===true?c.bonuses.shortLease:0)+(l.gas===true?c.bonuses.gas:0)+(l.beds!==null&&l.beds>=2?secondBedroomBonus:0);
  };
  if(!relaxedView&&quality!==null&&quality>2&&quality<4){
    const ceiling=partialCeiling(quality);
    limit=Math.min(limit,clamp(ceiling));
    flags.push('Partial nature view limits overall fit');
    if(value>ceiling){add('Partial nature view ceiling',Math.round((ceiling-raw)*100)/100);value=clamp(ceiling);low=Math.min(low,value);high=Math.min(high,value);}
  }
  if(!relaxedView&&quality!==null&&quality<=2){
    // A worse glimpse must never outrank the better partial view immediately above it.
    // Tighten the old glimpse cap rather than relaxing the user's partial-view standard.
    const ceiling=clamp(Math.min(l.modern===false?3.1:3.3,partialCeiling(2)));
    limit=Math.min(limit,ceiling);
    flags.push('Nature glimpse only; buildings dominate');
    if(value>ceiling){add(l.modern===false?'Building-dominated glimpse and dated interiors':'Building-dominated nature glimpse',Math.round((ceiling-raw)*100)/100);value=ceiling;low=Math.min(low,ceiling);}
  }
  if(!relaxedView&&!views.length&&buildingWindows){
    limit=Math.min(limit,2.9);
    flags.push('Building-facing window photos; nature unverified');
    if(value>2.9){add('Building-facing view ceiling',Math.round((2.9-raw)*100)/100);value=2.9;low=Math.min(low,2.9);}
  }
  const representativeBuildings=reviewed.some(p=>p.kind==='interior'&&!p.unitCertain&&p.scenery==='buildings');
  const anyNatureWindows=reviewed.some(p=>p.kind==='interior'&&p.scenery==='nature');
  if(!relaxedView&&!buildingWindows&&representativeBuildings&&!anyNatureWindows){
    limit=Math.min(limit,2.9);
    flags.push('Representative windows face buildings; exact-unit view unverified');
    if(value>2.9){add('Poor representative views; not a promising match',Math.round((2.9-raw)*100)/100);value=2.9;low=Math.min(low,2.9);}
  }
  if(interiorTradeoff||initialMoveException){
    // A second, deliberately modest valuation of the same supported facts. Keep
    // it available as views improve so a better view can never lower this score.
    // All costs, location/condition deductions and subsequent hard caps still apply.
    const ceiling=initialMoveException?3.5:c.interiorTradeoff.ceiling,alternative=nonViewRaw-c.interiorTradeoff.viewPenalty;
    limit=Math.max(limit,ceiling);
    const candidate=Math.min(ceiling,clamp(alternative));
    if(candidate>value){
      add(initialMoveException?'Furnished short-term initial-move fit':'Interior strengths offset weak outlook',Math.round((candidate-value)*100)/100);
      value=candidate;
      low=Math.min(value,Math.max(low,Math.min(ceiling,clamp(alternative-spread))));
      high=Math.max(high,Math.min(ceiling,clamp(alternative+spread)));
      flags.push(noNature?'No qualifying nature outlook; interior trade-off':'Worth a look for interior strengths; view remains a compromise');
    }
  }
  if(initialMoveException&&(quality===null||quality<4))flags.push('Initial-move furnished short-term exception; nature view remains a compromise');
  const cap=(ceiling:number,label:string)=>{limit=Math.min(limit,ceiling);if(value>ceiling){add(label,Math.round((ceiling-value)*100)/100);value=ceiling;}low=Math.min(low,value);high=Math.min(high,ceiling);};
  if(!relaxedView&&c.requireNiceViewForDesk){
    const niceView=views.some(p=>p.quality!>=4&&!p.attributionPending)
      &&!l.conflicts.some(text=>/\b(?:view|outlook|photo attribution)\b/i.test(text));
    if(!niceView&&!initialMoveException){
      const label=quality!==null&&quality<4?'View below the nice-nature standard':'Nice actual-unit nature view not confirmed';
      cap(2.9,label);
      reasons.push(label+(c.quickIntake?'; full-score preference not met':'; review manually in Excluded'));
    }
  }
  if(!relaxedView&&c.farFromDowntownCeiling!==null&&l.downtownDistance==='far'&&(quality===null||quality<c.greatViewThreshold))cap(c.farFromDowntownCeiling,'Far from downtown without a great verified view');
  if(c.streetLevelCeiling!==null&&l.floorLevel!==null&&l.floorLevel<=1)cap(c.streetLevelCeiling,'Street-level outlook ceiling');
  if(!relaxedView&&c.expensiveWeakViewRent!==null&&cost!==null&&cost>=c.expensiveWeakViewRent&&(quality??representativeQuality)<=3){const second=l.beds!==null&&l.beds>=2&&quality!==null&&quality>2?.1*bedroomValue:0;cap(c.expensiveWeakViewCeiling+second,'High rent with a modest outlook');}
  // 4.0 itself belongs to the strong-match band. Bonuses and learned ratings must
  // never cross it without a good actual-unit outlook and supported elevation.
  const strongView=complete&&views.some(p=>p.quality!>=4&&!p.attributionPending)
    &&l.floorLevel!==null&&l.floorLevel>=3
    &&!l.conflicts.some(text=>/\b(?:floor|storey|story|view|outlook|photo attribution)\b/i.test(text));
  const strongEvidence=complete&&l.floorLevel!==null&&l.floorLevel>=3&&!l.conflicts.some(text=>/\b(?:floor|storey|story|photo attribution)\b/i.test(text));
  if(relaxedView?!strongEvidence:!strongView){
    cap(3.9,relaxedView?'4.0+ requires complete photos and supported floor height':'4.0+ requires a confirmed good elevated nature view');
    if(quality===null||quality<4)flags.push('Good unit-window nature view not confirmed');
    if(l.floorLevel===null)flags.push('Floor Height Unsure');
    else if(l.floorLevel<3)flags.push('Below third floor; elevated view requirement not met');
    if(!complete)flags.push('Complete photo review required for 4.0+');
    if(l.conflicts.some(text=>/\b(?:floor|storey|story|view|outlook|photo attribution)\b/i.test(text)))flags.push('View or floor evidence conflicts; strong-match rating withheld');
  }
  // Premium prices need exceptional supported unit quality, not bedroom count or
  // luxury marketing. Existing photo assessments cover kitchen/bath condition together.
  const exceptional=(relaxedView?strongEvidence:strongView&&(quality??0)>=4.5)&&l.modern===true&&l.cramped===false
    &&l.openPlan===true&&!!l.evidence.interiorAssessment
    &&reviewed.filter(p=>p.kind==='interior').every(p=>p.unitCertain&&!p.attributionPending);
  if(!exceptional)cap(4.7,'4.8+ requires exceptional verified overall quality');
  if(cost!==null&&cost>=c.premiumRentThreshold&&!exceptional){
    cap(c.premiumRentCeiling,'High rent without exceptional verified overall quality');
    flags.push(relaxedView?'Premium rent requires photo-supported modern, spacious interiors':'Premium rent requires an exceptional view and photo-supported modern, spacious interiors');
  }
  if(reasons.length){limit=Math.min(limit,2.9);value=Math.min(2.9,value);low=Math.min(low,value);high=Math.min(2.9,high);}
  // Apply parking after view/interior ceilings so those caps cannot swallow the deduction.
  // Older positive calibration must not restore points removed by this near-must-have.
  const parking=parkingAssessment(l);
  if(parking.penalty){
    add(parking.label,-parking.penalty);
    value=clamp(value-parking.penalty);low=clamp(low-parking.penalty);high=clamp(high-parking.penalty);
    limit=Math.min(limit,value);
    if(parking.penalty<1)flags.push('Parking Unsure');
  }
  if(round(value)<3&&!reasons.includes('Score below 3.0'))reasons.push('Score below 3.0');
  return {ceiling:round(limit),value:round(value),low:round(low),high:round(high),base:round(base),adjustments,flags:[...new Set(flags)],reasons:[...new Set(reasons)],eligible:hasInteriorPhoto&&!reasons.length&&round(value)>=3,uncertain:flags.length>0,view:noNature?'No qualifying nature':quality===null?'Unverified':quality>=4?'Nature dominates':'Partial nature'};
}

/** Latest personal examples adjust comparable homes, after all evidence-based ceilings. */
export function scoreListing(l:Listing,c:Criteria,homeId=l.homeId):Score{
 const result=scoreBase(l,c,homeId);
 if(!c.learnedExamples.length||result.reasons.some(r=>r!=='Score below 3.0')||!l.photos.some(p=>p.status==='reviewed'&&p.kind==='interior'))return result;
 const features=feedbackFeatures(assessedFacts(l,c,homeId)),key=l.source+':'+l.sourceId;
 const isOwn=(e:Criteria['learnedExamples'][number])=>homeId!==undefined?e.homeId===homeId:e.key===key;
 // Retain historical ratings, but retire weak/unknown-view anchors under the new preference.
 const matches=c.learnedExamples.filter(e=>!(c.fullViewPenaltyCap!==null&&e.feedbackId<=c.legacyViewFeedbackThrough&&(e.features.quality??0)<4)).filter(e=>(e.scope!=='one-off'||isOwn(e))&&sameCalibrationContext(features,e.features));
 if(!matches.length)return result;
 let lower=result.value,upper=5;
 const active:Criteria['learnedExamples']=[];
 for(const e of matches){
  const diff=e.target-e.baseline;
  const residual=Math.max(-1.5,Math.min(1.5,e.target<e.originalScore?Math.min(0,diff):diff));
  if(!residual)continue;
  const target=e.baseline+residual;
  // Each bound is monotone in the base prediction and ceases to affect sufficiently
  // different scores. Unlike a neighbor radius, leaving its influence cannot make
  // higher rent or a poorer view improve a score. Conflicting negative anchors win.
  if(residual<0){const bound=target+2*Math.max(0,result.value-e.baseline);upper=Math.min(upper,bound);if(bound<result.value)active.push(e);}
  else{const bound=target-2*Math.max(0,e.baseline-result.value);lower=Math.max(lower,bound);if(bound>result.value)active.push(e);}
 }
 const value=round(Math.min(result.ceiling??5,clamp(Math.min(upper,lower))));
 if(value===result.value)return result;
 const reasons=result.reasons.filter(r=>r!=='Score below 3.0');if(value<3)reasons.push('Score below 3.0');
 return {...result,value,low:Math.min(result.low,value),high:Math.min(result.ceiling??5,Math.max(value,result.high)),eligible:!reasons.length&&value>=3,reasons,adjustments:[...result.adjustments,{label:active.length===1&&isOwn(active[0])?'Your rating calibration':`Calibration from ${active.length} comparable reviewed apartment${active.length===1?'':'s'}`,value:round(value-result.value)}]};
}
