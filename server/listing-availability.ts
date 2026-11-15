import type {Listing} from '../src/domain.ts';

/** Only a scoped saved availability field establishes that this advertised rental is unavailable. */
export function listingUnavailable(listing:Listing){
 return /^(?:rented|leased|unavailable|not available)(?:$|\s*[-–—.!;:])/i.test(listing.available.trim());
}
