import type {Criteria,Listing,Score} from '../src/domain.ts';
import {assessedFacts,feedbackFeatures,sameCalibrationContext} from './scoring-facts.ts';
import {listingUnavailable} from './listing-availability.ts';
const clamp=(n:number)=>Math.min(5,Math.max(.1,n));
const round=(n:number)=>Math.round(n*10)/10;
export function scoreBase(input:Listing,c:Criteria,homeId=input.homeId):Score {
  const l=assessedFacts(input,c,homeId);let limit=5;
  const flags:string[]=[],reasons:string[]=[],adjustments:{label:string;value:number}[]=[];
  if(l.offeringKind==='building')reasons.push('Building advertisement; an individual apartment offering is required');
  if(listingUnavailable(l))reasons.push('Source explicitly marks this rental unavailable');
  if(l.evidence.nonRental==='true')reasons.push('Not an apartment rental');
  const add=(label:string,value:number)=>adjustments.push({label,value});
  const reviewed=l.photos.filter(p=>p.status==='reviewed');
  const complete=l.galleryComplete && l.photos.length>0 && reviewed.length===l.photos.length && (l.expectedPhotos===null || l.photos.length>=l.expectedPhotos);
  const hasInteriorPhoto=reviewed.some(p=>p.kind==='interior');
  // Several supported interior benefits can make a weak-view home worth a look.
  // Furniture alone, marketing copy, and representative suites do not qualify.
  const interiorBenefits=[l.furnished===true,l.openPlan===true,l.modern===true,l.beds!==null&&l.beds<2&&l.workspace===true].filter(Boolean).length;
  const interiorTradeoff=c.interiorTradeoff.enabled&&l.rent!==null&&interiorBenefits>=3&&reviewed.some(p=>p.kind==='interior'&&p.unitCertain);
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
  if(l.rent!==null) base+=(c.priceAnchor-(cost??l.rent))*c.priceSlope;
  else {flags.push('Rent Unsure');spread+=.6;}
  if(c.maxRent!==null && l.rent!==null){
    if(l.rent>=c.maxRent || (c.rentBasis==='with-parking'&&cost!==null&&cost>=c.maxRent)) reasons.push('Rent exceeds the configured ceiling');
    else if(c.rentBasis==='unresolved'&&cost!==null&&cost>=c.maxRent) flags.push('Budget basis needs confirmation');
  }
  if(l.location==='outside')base-=c.outsidePenalty;
  if(l.location==='near-transit')base-=c.transitPenalty;
  if(l.location==='unknown'){
    if(l.downtownDistance==='far')base-=c.outsidePenalty;
    else if(l.downtownDistance==='nearby')base-=c.transitPenalty/2;
    else if(l.downtownDistance==='unknown'){flags.push('Location Unsure');spread+=.5;}
  }
  if(quality!==null)base+=(quality-3)*c.viewWeight;
  else {flags.push('View Unverified');spread+=.8;}
  if(!complete) flags.push('Photo review pending');
  if(noNature&&!interiorTradeoff)reasons.push('Confirmed absence of a qualifying nature outlook');
  if(c.requireLaundry && ['shared-only','none'].includes(l.laundry))reasons.push('In-unit laundry is required');
  if(c.requireLaundry && ['unknown','hookups'].includes(l.laundry))flags.push('Laundry Unsure');
  if(l.parking==='unknown' || l.parking==='extra'&&l.parkingCost===null) {flags.push('Parking Unsure');spread+=.15;}
  if(l.parking==='none')add('No parking',-.25);
  if(l.parkingCount!==null&&l.parkingCount>1&&l.parking==='included')add('Additional parking',c.bonuses.extraParking);
  if(l.beds===0 && !(c.studioExceptionMax!==null&&l.rent!==null&&l.rent<=c.studioExceptionMax&&quality!==null&&quality>=4&&complete))add('Studio',-c.studioPenalty);
  if(l.beds!==null&&l.beds>=2)add('Second bedroom',c.bonuses.secondBedroom);
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
  const nonViewRaw=base-(quality===null?0:(quality-3)*c.viewWeight)+adjustments.reduce((sum,a)=>sum+a.value,0);
  if(!views.length&&buildingWindows)add('Building-facing outlook; no confirmed nature',-c.buildingViewPenalty);
  const raw=base+adjustments.reduce((a,b)=>a+b.value,0);
  let low=clamp(raw-spread),high=clamp(raw+spread),value=clamp(raw);
  const representativeQuality=Math.max(0,...reviewed.filter(p=>p.kind==='interior'&&p.scenery==='nature').map(p=>p.quality??0));
  const unverifiedCeiling=representativeQuality>=3.5?c.goodUnverifiedViewCeiling:c.unverifiedViewCeiling;
  if(quality===null){limit=Math.min(limit,unverifiedCeiling);if(value>unverifiedCeiling){
    add('Unverified nature view ceiling',Math.round((unverifiedCeiling-value)*100)/100);
    flags.push('A strong-match score requires a confirmed unit nature view');
    value=unverifiedCeiling;low=Math.min(low,value);high=Math.min(high,value);
  }}
  const partialCeiling=(q:number)=>{
    const weakViewCost=cost===null?0:Math.max(0,cost-c.partialViewPriceAnchor)*c.partialViewPriceSlope*Math.min(1,Math.max(0,(3.5-q)*2));
    return c.partialNatureCeiling+(q-3)*c.viewWeight-weakViewCost+(l.furnished===true?c.bonuses.furnished:0)+(l.shortLease===true?c.bonuses.shortLease:0)+(l.gas===true?c.bonuses.gas:0)+(l.beds!==null&&l.beds>=2?c.bonuses.secondBedroom:0);
  };
  if(quality!==null&&quality>2&&quality<4){
    const ceiling=partialCeiling(quality);
    limit=Math.min(limit,clamp(ceiling));
    flags.push('Partial nature view limits overall fit');
    if(value>ceiling){add('Partial nature view ceiling',Math.round((ceiling-raw)*100)/100);value=clamp(ceiling);low=Math.min(low,value);high=Math.min(high,value);}
  }
  if(quality!==null&&quality<=2){
    // A worse glimpse must never outrank the better partial view immediately above it.
    // Tighten the old glimpse cap rather than relaxing the user's partial-view standard.
    const ceiling=clamp(Math.min(l.modern===false?3.1:3.3,partialCeiling(2)));
    limit=Math.min(limit,ceiling);
    flags.push('Nature glimpse only; buildings dominate');
    if(value>ceiling){add(l.modern===false?'Building-dominated glimpse and dated interiors':'Building-dominated nature glimpse',Math.round((ceiling-raw)*100)/100);value=ceiling;low=Math.min(low,ceiling);}
  }
  if(!views.length&&buildingWindows){
    limit=Math.min(limit,2.9);
    flags.push('Building-facing window photos; nature unverified');
    if(value>2.9){add('Building-facing view ceiling',Math.round((2.9-raw)*100)/100);value=2.9;low=Math.min(low,2.9);}
  }
  const representativeBuildings=reviewed.some(p=>p.kind==='interior'&&!p.unitCertain&&p.scenery==='buildings');
  const anyNatureWindows=reviewed.some(p=>p.kind==='interior'&&p.scenery==='nature');
  if(!buildingWindows&&representativeBuildings&&!anyNatureWindows){
    limit=Math.min(limit,2.9);
    flags.push('Representative windows face buildings; exact-unit view unverified');
    if(value>2.9){add('Poor representative views; not a promising match',Math.round((2.9-raw)*100)/100);value=2.9;low=Math.min(low,2.9);}
  }
  if(interiorTradeoff){
    // A second, deliberately modest valuation of the same supported facts. Keep
    // it available as views improve so a better view can never lower this score.
    // All costs, location/condition deductions and subsequent hard caps still apply.
    const ceiling=c.interiorTradeoff.ceiling,alternative=nonViewRaw-c.interiorTradeoff.viewPenalty;
    limit=Math.max(limit,ceiling);
    const candidate=Math.min(ceiling,clamp(alternative));
    if(candidate>value){
      add('Interior strengths offset weak outlook',Math.round((candidate-value)*100)/100);
      value=candidate;
      low=Math.min(value,Math.max(low,Math.min(ceiling,clamp(alternative-spread))));
      high=Math.max(high,Math.min(ceiling,clamp(alternative+spread)));
      flags.push(noNature?'No qualifying nature outlook; interior trade-off':'Worth a look for interior strengths; view remains a compromise');
    }
  }
  const cap=(ceiling:number,label:string)=>{limit=Math.min(limit,ceiling);if(value>ceiling){add(label,Math.round((ceiling-value)*100)/100);value=ceiling;}low=Math.min(low,value);high=Math.min(high,ceiling);};
  if(c.farFromDowntownCeiling!==null&&l.downtownDistance==='far'&&(quality===null||quality<c.greatViewThreshold))cap(c.farFromDowntownCeiling,'Far from downtown without a great verified view');
  if(c.streetLevelCeiling!==null&&l.floorLevel!==null&&l.floorLevel<=1)cap(c.streetLevelCeiling,'Street-level outlook ceiling');
  if(c.expensiveWeakViewRent!==null&&cost!==null&&cost>=c.expensiveWeakViewRent&&(quality??representativeQuality)<=3){const second=l.beds!==null&&l.beds>=2&&quality!==null&&quality>2?.1:0;cap(c.expensiveWeakViewCeiling+second,'High rent with a modest outlook');}
  if(reasons.length){limit=Math.min(limit,2.9);value=Math.min(2.9,value);low=Math.min(low,value);high=Math.min(2.9,high);}
  if(round(value)<3&&!reasons.includes('Score below 3.0'))reasons.push('Score below 3.0');
  return {ceiling:round(limit),value:round(value),low:round(low),high:round(high),base:round(base),adjustments,flags:[...new Set(flags)],reasons,eligible:hasInteriorPhoto&&!reasons.length&&round(value)>=3,uncertain:flags.length>0,view:noNature?'No qualifying nature':quality===null?'Unverified':quality>=4?'Nature dominates':'Partial nature'};
}

/** Latest personal examples adjust comparable homes, after all evidence-based ceilings. */
export function scoreListing(l:Listing,c:Criteria,homeId=l.homeId):Score{
 const result=scoreBase(l,c,homeId);
 if(!c.learnedExamples.length||result.reasons.some(r=>r!=='Score below 3.0')||!l.photos.some(p=>p.status==='reviewed'&&p.kind==='interior'))return result;
 const features=feedbackFeatures(assessedFacts(l,c,homeId)),key=l.source+':'+l.sourceId;
 const isOwn=(e:Criteria['learnedExamples'][number])=>homeId!==undefined?e.homeId===homeId:e.key===key;
 const matches=c.learnedExamples.filter(e=>(e.scope!=='one-off'||isOwn(e))&&sameCalibrationContext(features,e.features));
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
