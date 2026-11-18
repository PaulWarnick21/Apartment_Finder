import type {Home} from '../src/domain.ts';
import {isPromotionalPhoto,photosForDisplay} from '../src/photo-order.ts';

/** Preserve the card/compare facts, fetching the full evidence only on detail-open. */
export function cardSummary(home:Home):Home{
 const listing=home.listing;
 return {...home,summaryOnly:true,galleryCount:listing.photos.length,listing:{...listing,
  description:'',research:[],conflicts:[],
  evidence:Object.fromEntries(Object.entries(listing.evidence).filter(([key])=>/furnish|rentPlaceholder|nonRental|addressLookup/i.test(key))),
  photos:photosForDisplay(listing.photos).filter(p=>p.local).map(p=>({
   id:p.id,url:p.url,local:p.local,status:p.status,kind:p.kind,scenery:p.scenery,
   quality:p.quality,unitCertain:p.unitCertain,note:isPromotionalPhoto(p)?'Promotional listing photo':''
  }))
 }};
}
