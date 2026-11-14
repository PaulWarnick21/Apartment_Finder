import type {Criteria,Listing,Score} from '../src/domain.ts';
import {assessedFacts,feedbackFeatures,featureDistance} from './scoring-facts.ts';
const clamp=(n:number)=>Math.min(5,Math.max(.1,n));
const round=(n:number)=>Math.round(n*10)/10;
export function scoreBase(input:Listing,c:Criteria):Score {
  const l=assessedFacts(input,c);let limit=5;
  const flags:string[]=[],reasons:string[]=[],adjustments:{label:string;value:number}[]=[];
  if(l.evidence.nonRental==='true')reasons.push('Not an apartment rental');
  const add=(label:string,value:number)=>adjustments.push({label,value});
  const reviewed=l.photos.filter(p=>p.status==='reviewed');
  const complete=l.galleryComplete && l.photos.length>0 && reviewed.length===l.photos.length && (l.expectedPhotos===null || l.photos.length>=l.expectedPhotos);
  const hasInteriorPhoto=reviewed.some(p=>p.kind==='interior');
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
  if(noNature)reasons.push('Confirmed absence of a qualifying nature outlook');
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
  if(!views.length&&buildingWindows)add('Building-facing outlook; no confirmed nature',-c.buildingViewPenalty);
  const raw=base+adjustments.reduce((a,b)=>a+b.value,0);
  let low=clamp(raw-spread),high=clamp(raw+spread),value=clamp(raw);
  const representativeQuality=Math.max(0,...reviewed.filter(p=>p.kind==='interior'&&p.scenery==='nature').map(p=>p.quality??0));
  const unverifiedCeiling=representativeQuality>=3.5?c.goodUnverifiedViewCeiling:c.unverifiedViewCeiling;
  if(!reasons.length&&quality===null){limit=Math.min(limit,unverifiedCeiling);if(value>unverifiedCeiling){
    add('Unverified nature view ceiling',Math.round((unverifiedCeiling-value)*100)/100);
    flags.push('A strong-match score requires a confirmed unit nature view');
    value=unverifiedCeiling;low=Math.min(low,value);high=Math.min(high,value);
  }}
  if(!reasons.length&&quality!==null&&quality>2&&quality<4){
    const weakViewCost=cost===null?0:Math.max(0,cost-c.partialViewPriceAnchor)*c.partialViewPriceSlope*Math.min(1,Math.max(0,(3.5-quality)*2));
    const ceiling=c.partialNatureCeiling+(quality-3)*c.viewWeight-weakViewCost+(l.furnished===true?c.bonuses.furnished:0)+(l.shortLease===true?c.bonuses.shortLease:0)+(l.gas===true?c.bonuses.gas:0)+(l.beds!==null&&l.beds>=2?c.bonuses.secondBedroom:0);
    limit=Math.min(limit,clamp(ceiling));
    flags.push('Partial nature view limits overall fit');
    if(value>ceiling){add('Partial nature view ceiling',Math.round((ceiling-raw)*100)/100);value=clamp(ceiling);low=Math.min(low,value);high=Math.min(high,value);}
  }
  if(!reasons.length&&quality!==null&&quality<=2){
    const ceiling=l.modern===false?3.1:3.3;
    limit=Math.min(limit,ceiling);
    flags.push('Nature glimpse only; buildings dominate');
    if(value>ceiling){add(l.modern===false?'Building-dominated glimpse and dated interiors':'Building-dominated nature glimpse',Math.round((ceiling-raw)*100)/100);value=ceiling;low=Math.min(low,ceiling);}
  }
  if(!reasons.length&&!views.length&&buildingWindows){
    limit=Math.min(limit,2.9);
    flags.push('Building-facing window photos; nature unverified');
    if(value>2.9){add('Building-facing view ceiling',Math.round((2.9-raw)*100)/100);value=2.9;low=Math.min(low,2.9);}
  }
  const representativeBuildings=reviewed.some(p=>p.kind==='interior'&&!p.unitCertain&&p.scenery==='buildings');
  const anyNatureWindows=reviewed.some(p=>p.kind==='interior'&&p.scenery==='nature');
  if(!reasons.length&&!buildingWindows&&representativeBuildings&&!anyNatureWindows){
    limit=Math.min(limit,2.9);
    flags.push('Representative windows face buildings; exact-unit view unverified');
    if(value>2.9){add('Poor representative views; not a promising match',Math.round((2.9-raw)*100)/100);value=2.9;low=Math.min(low,2.9);}
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
export function scoreListing(l:Listing,c:Criteria):Score{
 const result=scoreBase(l,c);
 if(!c.learnedExamples.length||result.reasons.some(r=>r!=='Score below 3.0')||!l.photos.some(p=>p.status==='reviewed'&&p.kind==='interior'))return result;
 const features=feedbackFeatures(assessedFacts(l,c)),key=l.source+':'+l.sourceId;
 const matches=c.learnedExamples.map(e=>({e,d:featureDistance(features,e.features)})).filter(x=>x.d<2).sort((a,b)=>a.d-b.d);
 const own=matches.find(x=>x.e.key===key&&x.d<.001);
 const nearest=own?[own]:matches.filter(x=>x.d<=(matches[0]?.d??0)+.5).slice(0,3);
 if(!nearest.length)return result;
 const weight=(d:number)=>1/(.05+d*d);
 const residual=(e:Criteria['learnedExamples'][number])=>{const diff=e.target-e.baseline;return e.target<e.originalScore?Math.min(0,diff):diff;};
 const delta=nearest.reduce((n,x)=>n+residual(x.e)*weight(x.d),0)/nearest.reduce((n,x)=>n+weight(x.d),0);
 const value=round(Math.min(result.ceiling??5,clamp(result.value+Math.max(-1.5,Math.min(1.5,delta)))));
 if(value===result.value)return result;
 const reasons=result.reasons.filter(r=>r!=='Score below 3.0');if(value<3)reasons.push('Score below 3.0');
 return {...result,value,low:Math.min(result.low,value),high:Math.min(result.ceiling??5,Math.max(value,result.high)),eligible:!reasons.length&&value>=3,reasons,adjustments:[...result.adjustments,{label:own?'Your rating calibration':`Calibration from ${nearest.length} similar reviewed apartment${nearest.length===1?'':'s'}`,value:round(value-result.value)}]};
}
