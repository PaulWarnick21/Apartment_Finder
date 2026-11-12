import type {Criteria,Listing,Score} from '../src/domain.ts';
const clamp=(n:number)=>Math.min(5,Math.max(.1,n));
const round=(n:number)=>Math.round(n*10)/10;
export function scoreListing(l:Listing,c:Criteria):Score {
  const flags:string[]=[],reasons:string[]=[],adjustments:{label:string;value:number}[]=[];
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
  if(l.location==='unknown'){flags.push('Location Unsure');spread+=.5;}
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
  const raw=base+adjustments.reduce((a,b)=>a+b.value,0);
  let low=clamp(raw-spread),high=clamp(raw+spread),value=clamp(raw);
  if(reasons.length){value=Math.min(2.9,value);low=Math.min(low,value);high=Math.min(2.9,high);}
  return {value:round(value),low:round(low),high:round(high),base:round(base),adjustments,flags:[...new Set(flags)],reasons,eligible:hasInteriorPhoto&&!reasons.length&&high>=3,uncertain:flags.length>0,view:noNature?'No qualifying nature':quality===null?'Unverified':quality>=4?'Nature dominates':'Partial nature'};
}
