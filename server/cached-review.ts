import type {Listing} from '../src/domain.ts';

/** Cached parallel work cannot enumerate a gallery or collect a missing photo. */
export function cachedReviewReady(listing:Listing){
 return listing.galleryComplete&&listing.photos.length>0&&
  (listing.expectedPhotos===null||listing.photos.length>=listing.expectedPhotos)&&
  listing.photos.some(photo=>!!photo.local&&photo.status!=='unavailable')&&
  listing.photos.every(photo=>!!photo.local||photo.status==='unavailable');
}
