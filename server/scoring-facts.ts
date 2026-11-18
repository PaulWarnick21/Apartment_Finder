import type {Listing,Criteria} from '../src/domain.ts';
export function assessedFacts(input:Listing,c:Criteria,homeId=input.homeId):Listing{
 const assessment=(homeId===undefined?undefined:c.userAssessments[`home:${homeId}`])??c.userAssessments[input.source+':'+input.sourceId];
 if(!assessment)return scoringFacts(input);
 const {feedbackId,...facts}=assessment;
 return scoringFacts({...input,...facts,evidence:{...input.evidence,userAssessment:`User feedback #${feedbackId}`}});
}
/** Scoped neighbourhood names and explicit unit-floor statements, never suite-number guesses. */
export function scoringFacts(input:Listing):Listing{
 const l={...input,evidence:{...input.evidence},conflicts:[...input.conflicts]};
 // This source's unit header precedes generic building inventory and amenities.
 if(l.source==='austeville'){
  const header=l.description.split('About the building')[0];
  const area=header.match(/\b(UBC|Kerrisdale(?:, Vancouver)?)\s+(?=\d+ Bedroom)/i)?.[1];
  if(l.area==='Unknown'&&area)l.area=area;
  if(!l.address)l.address=header.match(/\b\d{2,5}\s+[A-Za-z ]+?(?:Road|Street|Avenue)\s+Vancouver,?\s+BC/i)?.[0]??'';
  if(!l.evidence['visual:workspace']&&l.evidence.workspace==='den'&&!/\bden\b/i.test(header)){l.workspace=null;l.evidence.workspace='Building-wide den description does not establish a workspace in this unit.';}
  if(!l.evidence['visual:laundry']&&l.laundry==='in-unit'&&/Penthouse suites have in-suite laundry/i.test(l.description)&&!/(?:penthouse|in-suite laundry)/i.test(header)){l.laundry='unknown';l.evidence.laundry='In-suite laundry is advertised for penthouses; this unit is unconfirmed.';}
 }
 const place=`${l.area} ${l.title} ${l.address}`;
 if(l.downtownDistance==='unknown'){
  if(/\b(North Vancouver|West Vancouver|Burnaby|Richmond|Port Moody|Coquitlam|Surrey|New Westminster|UBC|Kerrisdale|Marpole|Renfrew[ -]Collingwood|Riley Park|Oakridge)\b/i.test(place))l.downtownDistance='far';
  else if(/\b(Kitsilano|Mount Pleasant|Fairview|Olympic Village|South False Creek)\b/i.test(place))l.downtownDistance='nearby';
  else if(['downtown','preferred'].includes(l.location)||/\b(Coal Harbour|West End|Yaletown|Downtown Vancouver)\b/i.test(place))l.downtownDistance='downtown';
  else if(l.location==='outside')l.downtownDistance='far';
  if(l.downtownDistance!=='unknown')l.evidence.downtownDistance=`Search-area classification from: ${place.trim()}`;
 }
 if(l.floorLevel===null){
  const floor=unitFloor(l.title,l.description);
  if(floor.value!==null){l.floorLevel=floor.value;l.evidence.floorLevel=floor.evidence;}
  else if(floor.conflict&&!l.conflicts.includes(floor.conflict))l.conflicts.push(floor.conflict);
 }
 return l;
}
/** Only unit-scoped statements qualify. Shared facilities and conflicting unit floors stay unknown. */
export function unitFloor(title:string,description:string){
 const findings:{value:number;statement:string}[]=[];
 const shared=/\b(?:building|tower|gym|fitness|pool|lounge|lobby|amenit\w*|parking|storage|rooftop|reception|restaurant|retail|shop|shared|guest suite|display suite|model suite|laundry room)\b/i;
 const unit=/\b(?:apartment|unit|suite|condo|home|penthouse)\b/i;
 let buildingSection=false;
 for(const statement of (title+'\n'+description).split(/[.!?;\n]+/).map(s=>s.trim()).filter(Boolean)){
  if(/\b(?:about the building|building amenities|community amenities)\b/i.test(statement))buildingSection=true;
  // Unit-scoped adjectival floors are common in listing headers ("6th-floor condo").
  // Do not infer the rental floor from a roof deck, amenity or another unit.
  const adjectival=statement.match(/\b(\d{1,3})(?:st|nd|rd|th)[ -]floor\s+(?:apartment|unit|suite|condo|studio|home)\b/i);
  if(adjectival&&!buildingSection&&!/\b(?:other|some|select|all|guest|display|model|show)\b/i.test(statement.slice(0,adjectival.index))){
   const value=Number(adjectival[1]);if(value<=200)findings.push({value,statement});
  }
  const match=statement.match(/\b(?:on|located on|situated on)\s+(?:the\s+)?(ground|\d{1,3})(?:st|nd|rd|th)?\s+floor\b|\bfloor(?: level)?\s*:\s*(ground|\d{1,3})\b/i);
  if(!match)continue;
  const prefix=statement.slice(0,match.index!);
  if(/\b(?:guest|display|model|show)\s+(?:suite|unit|apartment)\b/i.test(prefix))continue;
  // The grammatical subject immediately before the floor must be the rental or absent.
  // "The gym is located on the first floor" never describes the apartment's level.
  const unitAt=[...prefix.matchAll(new RegExp(unit.source,'gi'))].at(-1)?.index??-1;
  const sharedAt=[...prefix.matchAll(new RegExp(shared.source,'gi'))].at(-1)?.index??-1;
  if(sharedAt>=unitAt&&sharedAt>=0)continue;
  const explicitUnit=unitAt>=0&&sharedAt<unitAt;
  const standalone=/^(?:(?:located|situated)\s+)?$/i.test(prefix.trim());
  if(!explicitUnit&&(!standalone||buildingSection))continue;
  if(!explicitUnit&&shared.test(statement.slice(match.index!+match[0].length)))continue;
  if(buildingSection&&!/\b(?:this|your|advertised)\s+(?:unit|apartment|suite|condo|home|penthouse)\b/i.test(prefix))continue;
  const text=(match[1]??match[2]).toLowerCase(),value=text==='ground'?0:Number(text);
  if(value<=200)findings.push({value,statement});
 }
 const values=[...new Set(findings.map(f=>f.value))];
 return {value:values.length===1?values[0]:null,evidence:findings.map(f=>f.statement).join('; '),conflict:values.length>1?`Conflicting unit floor statements: ${values.join(' / ')}`:null};
}
export function feedbackFeatures(l:Listing){
 const f=scoringFacts(l),inside=f.photos.filter(p=>p.status==='reviewed'&&p.kind==='interior'),nature=inside.filter(p=>p.scenery==='nature'&&p.quality!==null),verified=nature.filter(p=>p.unitCertain);
 const selected=verified.length?verified:nature;
 const view=verified.length?'verified-nature':nature.length?'representative-nature':inside.some(p=>p.scenery==='buildings')?'buildings':'unknown';
 return {mountainConfirmed:verified.some(p=>(p.quality??0)>=4&&p.natureTypes?.includes('mountains')),rent:f.rent,beds:f.beds,view,quality:selected.length?Math.max(...selected.map(p=>p.quality!)):null,location:String(f.downtownDistance),modern:f.modern,furnished:f.furnished,workspace:f.workspace,gas:f.gas,shortLease:f.shortLease,cramped:f.cramped,floor:f.floorLevel===null?'unknown':f.floorLevel<=1?'street':f.floorLevel<5?'low':'high',parking:f.parking,parkingCost:f.parkingCost,north:f.north,openPlan:f.openPlan};
}
export type FeedbackFeatures=ReturnType<typeof feedbackFeatures>;
/** Residual learning stays within the same known facts; price and view strength act through the base score. */
export function sameCalibrationContext(a:FeedbackFeatures,b:FeedbackFeatures){
 if(a.rent===null||b.rent===null)return false;
 for(const key of ['mountainConfirmed','beds','view','location','modern','furnished','workspace','gas','shortLease','cramped','floor','parking','north','openPlan'] as const)if(a[key]!==b[key])return false;
 return a.parking!=='extra'||(a.parkingCost===null)===(b.parkingCost===null);
}
export function featureDistance(a:FeedbackFeatures,b:FeedbackFeatures){
 if(a.view!==b.view||a.location!==b.location||a.beds!==b.beds||a.parking!==b.parking||a.north!==b.north||a.openPlan!==b.openPlan||a.rent===null||b.rent===null||Math.abs(a.rent-b.rent)>700)return Infinity;
 if(a.parking==='extra'&&(a.parkingCost===null)!==(b.parkingCost===null))return Infinity;
 const cost=(f:FeedbackFeatures)=>f.rent!+(f.parking==='extra'?(f.parkingCost??0):0);
 let distance=Math.abs(cost(a)-cost(b))/500+Math.abs((a.quality??0)-(b.quality??0))*1.5;
 for(const key of ['modern','furnished','workspace','gas','shortLease','cramped'] as const)if(a[key]!==b[key])distance+=(a[key]===null||b[key]===null)?.3:.7;
 if(a.floor!==b.floor)distance+=.6;return distance;
}
