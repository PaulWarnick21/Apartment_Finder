import type {Listing} from './domain';
import {furnishingForListing} from './furnishing';

/** Distinguish advertised terms from the user's default when the description is silent. */
export function FurnishingBadge({listing}:{listing:Listing}){
 const furnishing=furnishingForListing(listing);
 const label=furnishing.assumed?'Assumed unfurnished':furnishing.value===true?'Furnished':furnishing.value===false?'Unfurnished':furnishing.label==='Not confirmed'?'Furnishing not confirmed':furnishing.label;
 return <span className={`furnishing-badge${furnishing.value===false?' unfurnished':''}`} title={[furnishing.statement,furnishing.note].filter(Boolean).join(' ')}>{label}</span>;
}
