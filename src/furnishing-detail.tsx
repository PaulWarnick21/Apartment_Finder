import type {Listing} from './domain';
import {furnishingForListing} from './furnishing';
export function FurnishingDetail({listing}:{listing:Listing}){
 const furnishing=furnishingForListing(listing);
 return <section className="furnishing-detail" aria-label="Furnishing"><h3>Furnishing</h3><strong>{furnishing.label}</strong>{furnishing.statement?<p>Listing says: <q>{furnishing.statement}</q></p>:<p>The saved listing does not explicitly say furniture is included or excluded.</p>}{furnishing.note&&<p className="footnote">{furnishing.note}</p>}</section>;
}
