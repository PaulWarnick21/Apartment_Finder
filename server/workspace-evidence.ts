export type WorkspaceTextEvidence={workspace:boolean|null;advertisedDen:boolean;evidence?:string};
/** Advertising can establish an office claim, but a room called a den/flex is not proof
 * of usable workspace. This does not inspect or change later photo evidence. */
export function workspaceTextEvidence(text:string):WorkspaceTextEvidence{
 const clauses=text.replace(/[–—]/g,'-').split(/[\n.!?;•✨✔]+/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
 const external=(s:string)=>/\b(?:shared|communal|common)\s+(?:(?:dedicated|separate)\s+)?(?:home\s+)?(?:office|workspace|work\s*space|den|flex|co[- ]?working)|\b(?:shared|communal|common)\s+(?:lounge|room|area)\b|\bco[- ]?working\b|\bbusiness cent(?:er|re)\b|\b(?:building|community)\s+(?:amenities|features|offers|includes|has|provides|contains)|\bbuilding['’]s\b|\b(?:amenities|lobby|leasing office|management office|residents['’]? lounge)\b|\b(?:other|some|select|all|penthouse)\s+(?:units|suites|apartments)\b|\b(?:nearby|neighbourhood|neighborhood)\s+(?:offices?|businesses)\b/i.test(s);
 const unit=clauses.filter(s=>!external(s));
 const dens=unit.filter(s=>/\bden\b|\bflex(?:\s+(?:room|space))?\b/i.test(s));
 const negative=unit.filter(s=>/\b(?:den|flex(?:\s+(?:room|space))?|(?:home\s+)?office|workspace)\b[^.;]{0,80}\b(?:convert(?:ed)?|repurposed|used|serves?|functions?|currently)\b[^.;]{0,50}\b(?:walk[- ]?in\s+closet|closet|storage)\b|\b(?:den|flex(?:\s+(?:room|space))?)\s+(?:is|as)\s+(?:(?:an?|the|custom|large)\s+){0,3}(?:walk[- ]?in\s+closet|closet|storage)\b|\b(?:den|flex(?:\s+(?:room|space))?)[^.;]{0,40}(?:too small|not suitable|not usable)[^.;]{0,40}(?:desk|office|work)|\b(?:no|without|(?:does|do|did)\s+not\s+(?:have|include|offer|provide|contain|feature))\s+(?:(?:an?|any)\s+)?(?:(?:separate|dedicated|usable)\s+)?(?:home\s+)?(?:office|workspace)\b/i.test(s));
 if(negative.length)return {workspace:null,advertisedDen:dens.length>0,evidence:`Workspace unconfirmed: ${negative.slice(0,3).join('; ')}`.slice(0,1200)};
 const positive=unit.filter(s=>{
  const match=s.match(/\b(?:dedicated|separate)\s+(?:home\s+)?(?:office|workspace)\b|\b(?:space|room)\s+for\s+(?:an?\s+)?(?:home\s+)?office\b|\bden\s*\/\s*(?:home\s+)?office\b/i);
  if(!match)return false;
  const prefix=s.slice(0,match.index);
  return !/\b(?:no|not|without)\s+(?:a\s+)?$/i.test(prefix)&&!/\b(?:near|nearby|close to|steps from|minutes from|across from|walking distance to)\b[^.;]{0,100}$/i.test(prefix);
 });
 if(positive.length)return {workspace:true,advertisedDen:dens.length>0,evidence:`Unit office space advertised: ${positive.slice(0,3).join('; ')}`.slice(0,1200)};
 if(dens.length)return {workspace:null,advertisedDen:true,evidence:`Den/flex space advertised; usability as a home office is unverified: ${dens.slice(0,3).join('; ')}`.slice(0,1200)};
 return {workspace:null,advertisedDen:false};
}
