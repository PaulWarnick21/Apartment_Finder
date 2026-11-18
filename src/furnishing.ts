import type {Listing} from './domain';

export type Furnishing = {value:boolean|null;label:string;statement:string;note:string;assumed?:boolean};
/** Only explicit, scoped listing text establishes inclusion. Photos never do. */
export function extractFurnishing(raw:string):Furnishing {
 let text=raw.replace(/\s+/g,' ').trim();
 // Separate the advertised rental from building-wide terms, FAQs and other rentals.
 if(text.includes('About this rental Share'))text=text.split('About this rental Share')[1].split('The Building')[0];
 text=text.split(/Frequently Asked Questions/i)[0];
 const result=(value:boolean|null,label:string,statement=''):Furnishing=>({value,label,statement,note:''});
 const optional=text.match(/(?:unfurnished\s*(?:or|\/)\s*(?:fully\s+)?furnished|furnished\s*(?:or|\/)\s*unfurnished|(?:furniture|furnishing|furnished)\s+(?:is\s+)?(?:optional|available (?:on request|at (?:an? )?(?:extra|additional) (?:cost|fee)))|can be (?:rented |offered )?furnished|\(Optional\)\s*(?:Basic\s+)?Furniture)/i);
 if(optional)return result(null,'Furnishing optional — confirm terms',optional[0]);
 const partial=text.match(/\b(?:partially|partly|semi[- ]?)\s*furnished\b/i);
 if(partial)return result(null,'Partly furnished — confirm included items',partial[0]);
 const negative=text.match(/\bunfurnished\b|\bnot furnished\b|\bfurniture (?:is )?not included\b|Furnished\s*:?\s*No(?=\b|Appliances|Includes|Building)/i);
 const floorplan=text.match(/(?:floor[- ]plan amenities):[^.]*?\bFurnished\b/i);
 if(floorplan)return result(null,'Furnished floor plan — specific unit unconfirmed',floorplan[0]);
 const positives=[...text.matchAll(/\b(?:(?:fully|beautifully|completely) furnished|furnished\s*:?\s*Yes\b|furniture (?:is )?included|furnished (?:(?:one|two|three|\d)[ -]?(?:bedroom|bed|br)\s*)?(?:apartment|condo(?:minium)?|unit|suite|rental|home)\b|furnished (?:one|two|three|\d)[ -]?(?:bedroom|bed|br)\b|(?:apartment|condo|unit|suite) (?:comes |is |will be rented )?(?:fully )?furnished\b)/gi)];
 const positive=positives.find(m=>{
  const start=m.index!,before=text.slice(Math.max(0,start-55),start),after=text.slice(start+m[0].length,start+m[0].length+65);
  return !/(?:not|no|without)\s*$/i.test(before)&&!/\s*(?:guest (?:suite|room)|display (?:suite|unit)|show (?:suite|home))/i.test(after.slice(0,25))&&!/(?:photos?|pictures?|images?|guest suite|display suite|show suite|staging)[^.!?]*$/i.test(before)&&!/^\s+(?:for (?:photos?|staging|display)|in (?:the )?(?:photos?|pictures?))/i.test(after);
 });
 if(negative&&positive)return result(null,'Furnishing unclear — conflicting statements',`${negative[0]} / ${positive[0]}`);
 if(negative)return result(false,'Unfurnished — stated in listing',negative[0]);
 if(positive)return result(true,'Furnished — stated in listing',positive[0]);
 return result(null,'Not confirmed','');
}

export function furnishingForListing(l:Pick<Listing,'title'|'description'|'evidence'|'conflicts'>):Furnishing {
 // Structured yes/no is accepted only when an extractor recorded that exact field.
 const field=/^Furnished\s*:\s*(?:Yes|No)$/i.test(l.evidence.furnished??'')?l.evidence.furnished:'';
 const found=extractFurnishing(`${l.title}\n${l.description}\n${field}\n${l.evidence.furnishingStatement??''}`);
 // Silence in a saved description is a user-selected default, not a verified claim.
 // Keep missing descriptions and explicit optional/partial/conflicting terms unresolved.
 const description=l.description.trim();
 const usableDescription=description.length>0&&l.description.length<50000&&!/(?:\.\.\.|…)\s*$/.test(description);
 if(found.label==='Not confirmed'&&usableDescription){
  found.value=false;found.assumed=true;found.label='Assumed unfurnished';
  found.note='The saved listing description does not say furniture is included; treated as unfurnished for scoring.';
 }
 else found.note=found.value===null?'':'Based on the saved listing text; confirm included items before signing.';
 if(/floor.?plan|display.?suite|representative/i.test(l.conflicts.join(' ')+' '+(l.evidence.gallery??'')))found.note+=' This listing uses representative or display information; confirm the terms for the specific unit.';
 return found;
}
