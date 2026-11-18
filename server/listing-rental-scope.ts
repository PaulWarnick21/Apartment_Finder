import type {Listing} from '../src/domain.ts';

/** Explicit room offers only; shared amenities and roommate-friendly whole homes are not enough. */
export function sharedRoomEvidence(listing:Pick<Listing,'title'|'description'>):string|null {
 const title=listing.title.trim(),description=listing.description.trim();
 const advertised=title.match(/^(?:(?:looking|seeking)\s+for\s+(?:a\s+)?)?(?:roommate|roomate|room-mate)\s+(?:for|wanted|needed)\b/i)
  ??title.match(/^(?:(?:large|furnished|private|single)\s+)*(?:room|bedroom)\s+(?:for\s+rent|available)\b/i);
 if(advertised)return title;
 const sharing=description.match(/(?:^|[.!?\n]\s+)(?:you(?:'ll| will)?\s+)?(?:share|sharing)\s+(?:a|the)\s+[\s\S]{0,140}?\b(?:suite|apartment|condo|house)\s+with\s+(?:(?:the|a|an)\s+)?(?:tenant|owner|roommate|roomate)\b/i);
 return sharing?.[0].trim()??null;
}
export const isApartmentUnit=(listing:Listing)=>listing.offeringKind==='unit'&&!sharedRoomEvidence(listing)&&listing.evidence.nonRental!=='true';
