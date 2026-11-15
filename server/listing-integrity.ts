import {createHash} from 'node:crypto';
import {listingSchema,type Listing,type Photo} from '../src/domain.ts';

export const addressKey=(s:string)=>s.trim().toLowerCase();
const shortHash=(s:string)=>createHash('sha256').update(s).digest('hex').slice(0,16);
export function unitIdentity(l:Listing){
 if(!l.unit.trim()||!l.address.trim()||/^(unknown|not provided)$/i.test(l.address.trim()))return null;
 return createHash('sha256').update(`${l.address.toLowerCase().replace(/[^a-z0-9]/g,'')}|${l.unit.trim().toLowerCase()}`).digest('hex');
}
/** A matching address/unit is a candidate, not permission to merge contradictory ads. */
export function compatibleUnit(a:Listing,b:Listing){
 if(a.beds!==null&&b.beds!==null&&a.beds!==b.beds)return false;
 if(a.sqft!==null&&b.sqft!==null&&Math.abs(a.sqft-b.sqft)>Math.max(a.sqft,b.sqft)*.2)return false;
 if(a.rent!==null&&b.rent!==null&&Math.min(a.rent,b.rent)/Math.max(a.rent,b.rent)<.6)return false;
 return true;
}
/** Preserve existing canonical IDs; extraction IDs are only scoped to their own ad. */
export function unionPhotos(existing:Photo[],incoming:Photo[]){
 const result=existing.map(p=>structuredClone(p)),used=new Set(result.map(p=>p.id));
 for(const source of incoming){
  const prior=result.find(p=>p.url===source.url||(p.hash&&source.hash&&p.hash===source.hash));
  if(prior){if(source.status==='reviewed'&&prior.status!=='reviewed')Object.assign(prior,source,{id:prior.id});continue;}
  const photo=structuredClone(source);
  if(used.has(photo.id))photo.id=`photo-${shortHash(photo.hash??photo.url)}`;
  while(used.has(photo.id))photo.id+='x';
  used.add(photo.id);result.push(photo);
 }
 return result;
}
export function reconcileListing(previous:Listing,incoming:Listing,{preservePhotos=false,crossPosting=false}:{preservePhotos?:boolean;crossPosting?:boolean}={}){
 const next=listingSchema.parse(incoming);
 if(preservePhotos){next.photos=structuredClone(previous.photos);next.galleryComplete=previous.galleryComplete;next.expectedPhotos=previous.expectedPhotos;next.allOutlooksCovered=previous.allOutlooksCovered;
  for(const key of ['galleryReview','interiorAssessment','visualFeatures','galleryCoverage'])if(previous.evidence[key])next.evidence[key]=previous.evidence[key];
  if(previous.evidence.interiorAssessment){next.modern=previous.modern;next.cramped=previous.cramped;}
  for(const key of ['modern','cramped','workspace','gas','openPlan'] as const)if(previous.evidence[`visual:${key}`]){next[key]=previous[key];next.evidence[`visual:${key}`]=previous.evidence[`visual:${key}`];}
 }else if(crossPosting){next.photos=unionPhotos(previous.photos,next.photos);next.galleryComplete=previous.galleryComplete&&incoming.galleryComplete;next.expectedPhotos=next.galleryComplete?next.photos.length:null;next.allOutlooksCovered=false;}
 else {const oldByUrl=new Map(previous.photos.map(p=>[p.url,p]));const incomingPhotos=next.photos.map(p=>{const old=oldByUrl.get(p.url);return old&&(!p.hash||p.hash===old.hash)?{...old,id:old.id}:p;});next.photos=unionPhotos(next.galleryComplete?[]:previous.photos,incomingPhotos);if(!next.galleryComplete)next.expectedPhotos=Math.max(previous.expectedPhotos??0,next.expectedPhotos??0,next.photos.length)||null;}
 if(crossPosting){
  next.source=previous.source;next.sourceId=previous.sourceId;next.url=previous.url;
  next.conflicts=[...new Set([...previous.conflicts,...next.conflicts])];
  for(const key of ['rent','beds','laundry','parking','lease','sqft','furnished','workspace','gas','openPlan','shortLease'] as const){
   const a=previous[key],b=incoming[key],known=(v:unknown)=>v!==null&&v!=='unknown'&&v!=='Unknown';
   if(known(a)&&!known(b))(next as any)[key]=a;
   else if(known(a)&&known(b)&&a!==b){
    next.conflicts.push(`${key}: ${previous.source} says ${a}; ${incoming.source} says ${b}`);
    if(key==='rent')next.rent=Math.max(a as number,b as number);
    else if(['laundry','parking'].includes(key))(next as any)[key]='unknown';
    else if(key==='lease')next.lease='Conflicting terms';
    else (next as any)[key]=null;
   }
  }
  next.evidence={...previous.evidence,...next.evidence};
 }
 // Address research is an application overlay, not an advertiser field. Preserve
 // it through factual source refreshes only while the advertised address matches.
 if(addressKey(previous.address)&&addressKey(previous.address)===addressKey(next.address)&&previous.evidence.locationSource){
  next.area=previous.area;next.location=previous.location;next.downtownDistance=previous.downtownDistance;
  next.evidence.location=previous.evidence.location;next.evidence.locationSource=previous.evidence.locationSource;
 }
 return next;
}
