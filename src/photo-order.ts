import type {Photo} from './domain';

export function isWindowView(photo:Photo){
 return photo.status==='reviewed'&&photo.kind==='interior'&&photo.scenery!=='unknown';
}
export function isPromotionalPhoto(photo:Photo){
 return /promotional|text overlay|bonus offer|move[- ]in (?:credit|offer)|award graphics/i.test(photo.note);
}
/** Keep original photo IDs/order intact in storage; choose window evidence for display. */
export function photosForDisplay(photos:Photo[]):Photo[]{
 const priority=(p:Photo)=>!p.local?-2:isPromotionalPhoto(p)?-1:isWindowView(p)?(p.unitCertain?20:10)+(p.scenery==='nature'?2:1):p.kind==='interior'?5:0;
 return [...photos].sort((a,b)=>priority(b)-priority(a));
}
