import type {Listing} from './domain';

/** Source links and gallery counts are not collected images. Keep this separate
 * from the intake prefilter so an approved worker can still download pending photos. */
export function photoCollectionExclusion(listing:Pick<Listing,'photos'>){
 return listing.photos.some(photo=>photo.local?.trim())?undefined:'No photos collected — excluded until at least one listing photo is saved.';
}
