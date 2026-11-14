import type {Listing,Criteria} from '../src/domain.ts';
export function assessedFacts(input:Listing,c:Criteria):Listing{
 const assessment=c.userAssessments[input.source+':'+input.sourceId];
 if(!assessment)return scoringFacts(input);
 const {feedbackId,...facts}=assessment;
 return scoringFacts({...input,...facts,evidence:{...input.evidence,userAssessment:`User feedback #${feedbackId}`}});
}
/** Scoped neighbourhood names and explicit unit-floor statements, never suite-number guesses. */
export function scoringFacts(input:Listing):Listing{
 const l={...input,evidence:{...input.evidence}};
 // This source's unit header precedes generic building inventory and amenities.
 if(l.source==='austeville'){
  const header=l.description.split('About the building')[0];
  const area=header.match(/\b(UBC|Kerrisdale(?:, Vancouver)?)\s+(?=\d+ Bedroom)/i)?.[1];
  if(l.area==='Unknown'&&area)l.area=area;
  if(!l.address)l.address=header.match(/\b\d{2,5}\s+[A-Za-z ]+?(?:Road|Street|Avenue)\s+Vancouver,?\s+BC/i)?.[0]??'';
  if(l.evidence.workspace==='den'&&!/\bden\b/i.test(header)){l.workspace=null;l.evidence.workspace='Building-wide den description does not establish a workspace in this unit.';}
  if(l.laundry==='in-unit'&&/Penthouse suites have in-suite laundry/i.test(l.description)&&!/(?:penthouse|in-suite laundry)/i.test(header)){l.laundry='unknown';l.evidence.laundry='In-suite laundry is advertised for penthouses; this unit is unconfirmed.';}
 }
 const place=`${l.area} ${l.title} ${l.address}`;
 if(l.downtownDistance==='unknown'){
  if(/\b(North Vancouver|West Vancouver|Burnaby|Richmond|Port Moody|Coquitlam|Surrey|New Westminster|UBC|Kerrisdale|Marpole|Renfrew[ -]Collingwood)\b/i.test(place))l.downtownDistance='far';
  else if(/\b(Kitsilano|Mount Pleasant|Fairview|Olympic Village|South False Creek)\b/i.test(place))l.downtownDistance='nearby';
  else if(['downtown','preferred'].includes(l.location)||/\b(Coal Harbour|West End|Yaletown|Downtown Vancouver)\b/i.test(place))l.downtownDistance='downtown';
  else if(l.location==='outside')l.downtownDistance='far';
  if(l.downtownDistance!=='unknown')l.evidence.downtownDistance=`Search-area classification from: ${place.trim()}`;
 }
 if(l.floorLevel===null){
  // A building's storey count, suite number, and photographs are not a unit floor.
  const match=(l.title+' '+l.description).match(/\b(?:on|located on|situated on) (?:the )?(\d{1,3})(?:st|nd|rd|th)? floor\b|\b(?:unit|apartment|suite)\s+(?:is\s+)?on\s+(?:the\s+)?(ground) floor\b|\bfloor(?: level)?:\s*(\d{1,3})\b/i);
  if(match){l.floorLevel=match[2]?0:Number(match[1]??match[3]);l.evidence.floorLevel=match[0];}
 }
 return l;
}
export function feedbackFeatures(l:Listing){
 const f=scoringFacts(l),inside=f.photos.filter(p=>p.status==='reviewed'&&p.kind==='interior'),nature=inside.filter(p=>p.scenery==='nature'&&p.quality!==null),verified=nature.filter(p=>p.unitCertain);
 const selected=verified.length?verified:nature;
 const view=verified.length?'verified-nature':nature.length?'representative-nature':inside.some(p=>p.scenery==='buildings')?'buildings':'unknown';
 return {rent:f.rent,beds:f.beds,view,quality:selected.length?Math.max(...selected.map(p=>p.quality!)):null,location:String(f.downtownDistance),modern:f.modern,furnished:f.furnished,workspace:f.workspace,gas:f.gas,shortLease:f.shortLease,cramped:f.cramped,floor:f.floorLevel===null?'unknown':f.floorLevel<=1?'street':f.floorLevel<5?'low':'high'};
}
export type FeedbackFeatures=ReturnType<typeof feedbackFeatures>;
export function featureDistance(a:FeedbackFeatures,b:FeedbackFeatures){
 if(a.view!==b.view||a.location!==b.location||a.beds!==b.beds||a.rent===null||b.rent===null||Math.abs(a.rent-b.rent)>700)return Infinity;
 let distance=Math.abs(a.rent-b.rent)/500+Math.abs((a.quality??0)-(b.quality??0))*1.5;
 for(const key of ['modern','furnished','workspace','gas','shortLease','cramped'] as const)if(a[key]!==b[key])distance+=(a[key]===null||b[key]===null)?.3:.7;
 if(a.floor!==b.floor)distance+=.6;return distance;
}
