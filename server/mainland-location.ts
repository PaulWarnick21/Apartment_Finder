/** Local evidence gate: missing location is not proof of mainland eligibility.
 * Only an advertised home location is used; views, trips and nearby attractions are not. */
export type MainlandLocationFields={title?:string;description?:string;address?:string;area?:string;city?:string;evidence?:Record<string,string>};
const islands='Bowen Island|Vancouver Island|Gulf Islands?|Salt ?Spring Island|Galiano Island|Mayne Island|(?:North |South )?Pender Island|Saturna Island|Gabriola Island|Gambier Island|Keats Island|Denman Island|Hornby Island|Quadra Island|Cortes Island|Texada Island|Lasqueti Island|Savary Island|Passage Island|Haida Gwaii|Lulu Island|Sea Island|Annacis Island|Westham Island';
const islandCities='Victoria|Saanich|Nanaimo|Sooke|Sidney|Esquimalt|Langford|Colwood|Duncan|Ladysmith|Parksville|Qualicum Beach|Port Alberni|Courtenay|Comox|Campbell River|Tofino|Ucluelet|Port Hardy';
const namedPlace=new RegExp(`\\b(?:${islands}|${islandCities})\\b`,'gi');
const road=/^\s+(?:st(?:reet)?|ave(?:nue)?|rd|road|dr(?:ive)?|way|blvd|cres(?:cent)?|pl(?:ace)?|ct|court)\b|^[-–]Fraserview\b/i;
const destination=/\b(?:views?|overlooks?|overlooking|sunsets?)\b[^.!?\n]{0,70}\b(?:of|over|towards?|across)\b|\b(?:ferr(?:y|ies)|trips?|commuters?)\s+(?:access\s+)?to\b|\b(?:near|nearby|visit|visiting|from|facing|overlooking|access to)\s+(?:the\s+)?$/i;
function matches(text:string){return [...text.matchAll(namedPlace)].filter(m=>!road.test(text.slice(m.index!+m[0].length)));}
export function offMainlandLocation(fields:MainlandLocationFields):string|undefined{
 const mainlandCity=/\b(?:(?:North |West )?Vancouver|Burnaby|Surrey|Coquitlam|Port Moody|New Westminster|Gibsons|Sechelt)(?:,\s*(?:BC|British Columbia|Canada)\b|$)/i;
 const explicitMainlandCity=mainlandCity.test(fields.city??'')||mainlandCity.test(fields.address??'');
 // Dedicated location fields carry stronger evidence than the source's search bucket.
 // "Victoria" is also a Vancouver neighbourhood label. A full Vancouver address
 // disambiguates that area label, but cannot override an explicitly named island.
 const area=explicitMainlandCity&&new RegExp(`^(?:${islandCities})$`,'i').test(fields.area??'')?undefined:fields.area;
 for(const field of [fields.city,fields.address,area,fields.evidence?.userLocation]){
  for(const m of matches(field??''))if(!destination.test((field??'').slice(0,m.index)))return m[0];
 }
 for(const [text,isTitle] of [[fields.title??'',true],[fields.description??'',false]] as const){
  for(const clause of text.split(/[\n.!?;]/))for(const m of matches(clause)){
   const prefix=clause.slice(0,m.index),before=prefix.trim();
   if(destination.test(prefix)||/^\s+(?:views?|outlook|ferr(?:y|ies)|terminal)\b/i.test(clause.slice(m.index!+m[0].length)))continue;
   // Explicit location grammar or a rental headline, including #354's first line.
   if(isTitle||/^\s*(?:📍\s*)?(?:location\s*[:—-]?\s*)?$/i.test(prefix)
    ||/\b(?:located|situated|living|live|rent(?:al)?|suite|apartment|home|condo|bedroom)\b[^.!?\n]{0,100}\b(?:in|on)\s+(?:(?:beautiful|central|downtown|lower|upper|the)\s+)*$/i.test(prefix)
    ||/\b(?:for rent|rental|suite|apartment|home|condo)\b[^.!?\n]{0,80}[—–|:]\s*$/i.test(prefix)
    ||/\b(?:located|situated)\s+(?:in|on)\s+(?:the\s+)?$/i.test(before))return m[0];
  }
 }
 return undefined;
}
export function mainlandExclusion(fields:MainlandLocationFields,required=true){
 const place=required?offMainlandLocation(fields):undefined;
 return place?`Off mainland BC (${place}) — excluded by your mainland-only requirement.`:undefined;
}
