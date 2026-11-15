import type {Home} from '../src/domain.ts';
import {photosForDisplay} from '../src/photo-order.ts';

/** Preserve the card/compare facts, fetching the full evidence only on detail-open. */
export function cardSummary(home:Home):Home{
 const listing=home.listing;
 return {...home,summaryOnly:true,galleryCount:listing.photos.length,listing:{...listing,
  description:'',research:[],conflicts:[],
  evidence:Object.fromEntries(Object.entries(listing.evidence).filter(([key])=>/furnish|rentPlaceholder|nonRental/i.test(key))),
  photos:photosForDisplay(listing.photos).slice(0,1).map(p=>({...p,note:''}))
 }};
}
