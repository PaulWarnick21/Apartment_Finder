import type {Listing} from '../src/domain.ts';
import type {Budget} from './plans.ts';
import {allowedUrl,type Source} from './sources.ts';
import {storePhoto,EmptyPhotoError} from './photo-storage.ts';
import {reusedDownload,rememberDownload} from './gallery-downloads.ts';

/** Finish or retain every photo; overlapping work settles before the caller saves. */
export async function collectGalleryPhotos(listing:Listing,budget:Budget,source:Source,dataDir:string,image:(url:string)=>Promise<Buffer>){
 const photos=listing.photos.filter(photo=>!photo.local&&photo.status!=='unavailable'&&(allowedUrl(photo.url,source.mediaHosts)||source.id==='apartments'&&/^https:\/\/images\d+\.apartments\.com\//.test(photo.url)));
 let index=0,failed=false,failure:unknown,limited=false;
 const collect=async()=>{
  while(!failed&&!limited&&index<photos.length){
   const photo=photos[index++];
   try{
    budget.check();budget.store.checkSource(source.id);
    const cached=reusedDownload(budget,photo.url,dataDir);
    if(cached){Object.assign(photo,cached,{status:'downloaded'});continue;}
    if(!budget.remaining('photos')){limited=true;return;}
    const downloaded=await storePhoto(await image(photo.url),dataDir);
    Object.assign(photo,downloaded,{status:'downloaded'});rememberDownload(budget,photo.url,downloaded);
   }catch(error){
    if(/(?:photos|requests) cap reached|Daily (?:image|photo) (?:cap|limit) reached/i.test(String(error))){limited=true;return;}
    if(error instanceof EmptyPhotoError||/Image unavailable: (404|410)/.test(String(error))){photo.status='unavailable';photo.note=error instanceof EmptyPhotoError?'Source returned an empty image response; retained as an explicit gallery gap.':'Image no longer available from the source; retained as an explicit gallery gap.';continue;}
    failed=true;failure=error;
   }
  }
 };
 await Promise.all(Array.from({length:budget.caps.pacingPolicy==='adaptive'?2:1},collect));
 if(failed)throw failure;
 return limited;
}
