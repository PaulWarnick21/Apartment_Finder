import sharp from 'sharp';
import {join} from 'node:path';
import type {Store} from './db.ts';
import {listingSchema,type Listing,type Photo} from '../src/domain.ts';
import {duplicateAddress,duplicateEvidence,deduplicateHome,forgetQueuedPosting,sharedGallery} from './automatic-duplicates.ts';

const version='review-duplicates-v1';
const stages=['Unreviewed','Interested','Serious Candidates','Ready to Apply','In Progress','Inquiry Sent','Viewing Booked','Applied','Leased'];
type Row={id:number;listing:string;stage:string;first_seen:string};
type Signature={bits:number[];pixels:number[]};
const words=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/);
function overlap(a:string,b:string){
 const grams=(s:string)=>{const w=words(s);return new Set(w.slice(0,-4).map((_,i)=>w.slice(i,i+5).join(' ')));};
 const x=grams(a),y=grams(b),shared=[...x].filter(s=>y.has(s)).length;
 return {shared,ratio:shared/Math.max(1,Math.min(x.size,y.size))};
}
const interior=(p:Photo)=>p.kind==='interior'&&p.unitCertain&&!p.attributionPending&&!/(?:provenance|exact.unit)[^.]*\b(?:not|uncertain|unverified)\b|not[^.]*establish[^.]*exact.unit/i.test(p.note);
const eligiblePhotos=(l:Listing)=>l.photos.filter(p=>p.local&&!['amenity','exterior','floorplan'].includes(p.kind)&&!p.attributionPending);
function facts(a:Listing,b:Listing){
 const x=duplicateAddress(a),y=duplicateAddress(b);
 if(x.conflict||y.conflict||x.unit&&y.unit&&x.unit!==y.unit||x.city&&y.city&&x.city!==y.city||x.type&&y.type&&x.type!==y.type||x.street&&y.street&&x.street!==y.street)return;
 if(a.floorLevel!==null&&b.floorLevel!==null&&a.floorLevel!==b.floorLevel)return;
 const floor=(l:Listing)=>l.description.match(/\b(\d{1,3})(?:st|nd|rd|th)[ -]+floor\b/i)?.[1];
 if(floor(a)&&floor(b)&&floor(a)!==floor(b))return;
 if(a.beds===null||b.beds===null||a.beds!==b.beds||a.sqft===null||b.sqft===null||Math.abs(a.sqft-b.sqft)>Math.max(a.sqft,b.sqft)*.05)return;
 if(a.rent===null||b.rent===null||Math.min(a.rent,b.rent)/Math.max(a.rent,b.rent)<.9)return;
 if(a.baths!==null&&b.baths!==null&&a.baths!==b.baths)return;
 return {sameAddress:!!x.street&&x.street===y.street};
}
function corroboration(a:Listing,b:Listing){
 if(sharedGallery(a)||sharedGallery(b))return;
 const compatible=facts(a,b);if(!compatible)return;
 const text=overlap(a.description,b.description);if(text.shared<40||text.ratio<.8)return;
 return {...compatible,text};
}
const pop=(n:number)=>{n-=n>>>1&0x55555555;n=(n&0x33333333)+(n>>>2&0x33333333);return (((n+(n>>>4))&0x0f0f0f0f)*0x01010101)>>>24;};
function similar(a:Signature,b:Signature){
 return pop(a.bits[0]^b.bits[0])+pop(a.bits[1]^b.bits[1])<=6&&a.pixels.reduce((sum,v,i)=>sum+Math.abs(v-b.pixels[i]),0)/a.pixels.length<=20;
}
async function signature(store:Store,dataDir:string,photo:Photo):Promise<Signature|undefined>{
 // Only application-owned immutable media filenames; external text never becomes a path.
 if(!photo.local||!/^\w{64}\.(?:jpg|png|webp|avif)$/.test(photo.local)||!/^[a-f0-9]{64}\./.test(photo.local))return;
 const key=`${version}:image:${photo.local}`,cached=store.get<Signature>(key);if(cached)return cached;
 try{
  const input=sharp(join(dataDir,'media',photo.local),{limitInputPixels:50000000});
  const [grey,rgb]=await Promise.all([input.clone().resize(9,8,{fit:'fill'}).greyscale().raw().toBuffer(),input.clone().resize(12,12,{fit:'fill'}).removeAlpha().toColourspace('srgb').raw().toBuffer()]);
  const mean=grey.reduce((n,v)=>n+v,0)/grey.length;
  if(Math.sqrt(grey.reduce((n,v)=>n+(v-mean)**2,0)/grey.length)<12)return; // Flat images are poor identity evidence.
  let a=0,b=0;for(let y=0;y<8;y++)for(let x=0;x<8;x++){const bit=grey[y*9+x]>grey[y*9+x+1]?1:0;if(y<4)a=a<<1|bit;else b=b<<1|bit;}
  const result={bits:[a>>>0,b>>>0],pixels:[...rgb]};store.set(key,result);return result;
 }catch{return;} // Missing/unreadable photos remain insufficient evidence, never a match.
}
/** Conservative subset of the manual audit: all accessible saved photos, no requests. */
export async function reviewDuplicateEvidence(store:Store,dataDir:string,a:Listing,b:Listing){
 const support=corroboration(a,b);if(!support)return;
 const unique=(l:Listing)=>[...new Map(eligiblePhotos(l).map(p=>[p.local!,p])).values()];
 const ap=unique(a),bp=unique(b);
 // Specific cross-post text can identify an otherwise identical rental with a missing gallery.
 // Multi-suite ads were manually handled in the audit; they are deliberately not automated.
 if(support.sameAddress&&support.text.shared>=80&&support.text.ratio===1&&a.rent===b.rent&&a.sqft===b.sqft&&
    (ap.length===0||bp.length===0)&&[a,b].some(l=>l.photos.filter(interior).length>=3))return 'Same street, exact rental facts and identical specific rental description; one saved gallery missing';
 if(ap.length<4||bp.length<4)return;
 // Bounded file concurrency; signatures persist across submissions and worker restarts.
 const signatures=async(ps:Photo[])=>{const out:(Signature|undefined)[]=[];for(let i=0;i<ps.length;i+=4)out.push(...await Promise.all(ps.slice(i,i+4).map(p=>signature(store,dataDir,p))));return out;};
 const ah=await signatures(ap),bh=await signatures(bp),edges:{i:number;j:number}[]=[];
 const distinct=(hs:(Signature|undefined)[])=>hs.map((h,i)=>!!h&&!hs.slice(0,i).some(prior=>prior&&similar(h,prior)));
 const ad=distinct(ah),bd=distinct(bh);
 for(let i=0;i<ap.length;i++)for(let j=0;j<bp.length;j++)if(ad[i]&&bd[j]&&similar(ah[i]!,bh[j]!))edges.push({i,j});
 // One-to-one maximum matching: repeated photos cannot inflate gallery overlap.
 const assigned=new Map<number,number>();
 const visit=(i:number,seen:Set<number>):boolean=>{for(const e of edges.filter(e=>e.i===i)){if(seen.has(e.j))continue;seen.add(e.j);const prior=assigned.get(e.j);if(prior===undefined||visit(prior,seen)){assigned.set(e.j,i);return true;}}return false;};
 for(let i=0;i<ap.length;i++)visit(i,new Set());
 const matched=[...assigned].map(([j,i])=>({i,j})),interiors=matched.filter(({i,j})=>interior(ap[i])||interior(bp[j])).length;
 if(matched.length>=4&&interiors>=3&&matched.length/Math.min(ap.length,bp.length)>=.8)return `${matched.length} visually matching saved photos, including ${interiors} unit-attributed interiors; compatible rental facts and specific description (${Math.round(matched.length/Math.min(ap.length,bp.length)*100)}% of smaller gallery)`;
}
function different(store:Store,a:number,b:number){return [a,...store.aliases(a)].some(x=>[b,...store.aliases(b)].some(y=>store.db.prepare("SELECT 1 FROM duplicate_decisions WHERE a=? AND b=? AND decision='different'").get(Math.min(x,y),Math.max(x,y))));}
/** Run at every selected-review preflight and when new saved gallery evidence arrives. */
export async function deduplicateForFullReview(store:Store,id:number,dataDir:string){
 const target=store.db.prepare('SELECT id,listing,stage,first_seen FROM homes WHERE id=?').get(id) as Row|undefined;
 if(!target||store.resolveHomeId(id)!==id||!stages.includes(target.stage))return;
 const a=listingSchema.parse(JSON.parse(target.listing));
 const peers=store.db.prepare(`SELECT id,listing,stage,first_seen FROM homes WHERE id!=? AND stage IN (${stages.map(()=>'?').join(',')}) AND id NOT IN (SELECT alias FROM home_aliases) ORDER BY first_seen,id`).all(id,...stages) as Row[];
 let checked=0,merged=0;
 for(const peer of peers){
  const b=listingSchema.parse(JSON.parse(peer.listing));
  if(different(store,id,peer.id))continue;
  const exact=duplicateEvidence(a,b);if(!exact&&!corroboration(a,b))continue;checked++;
  const evidence=exact??await reviewDuplicateEvidence(store,dataDir,a,b);if(!evidence)continue;
  const applied=store.transaction(()=>{
   const current=store.db.prepare('SELECT * FROM homes WHERE id=?').get(id) as any,other=store.db.prepare('SELECT * FROM homes WHERE id=?').get(peer.id) as any;
   if(store.resolveHomeId(id)!==id||store.resolveHomeId(peer.id)!==peer.id||current.listing!==target.listing||other.listing!==peer.listing||!stages.includes(current.stage)||!stages.includes(other.stage)||different(store,id,peer.id))return false;
   const rank=(r:any)=>stages.indexOf(r.stage),higher=rank(current)-rank(other);
   const keep=higher>0?current:higher<0?other:current.first_seen<other.first_seen||current.first_seen===other.first_seen&&id<peer.id?current:other,drop=keep.id===id?other:current;
   if(store.db.prepare('SELECT 1 FROM rating_feedback WHERE home_id=?').get(drop.id)||['follow_up','viewing'].some(k=>drop[k]&&drop[k]!==keep[k]))return false;
   const postings=store.db.prepare('SELECT source,source_id FROM postings WHERE home_id=?').all(drop.id) as {source:string;source_id:string}[];
   const result=store.mergeHomes(keep.id,drop.id,{keep:keep.revision,duplicate:drop.revision},{preserveCanonical:true});
   for(const p of postings){store.set(`duplicatePosting:${p.source}:${p.source_id}`,{homeId:keep.id,mergeId:result.mergeId,evidence});forgetQueuedPosting(store,p.source,p.source_id);}
   store.set(`reviewDuplicate:${drop.id}`,{keepId:keep.id,mergeId:result.mergeId,evidence,at:new Date().toISOString(),version});
   store.event(`Full-scoring duplicate check: #${drop.id} folded into #${keep.id}. ${evidence}. More advanced decision and assessment retained.`);return true;
  });
  if(applied)merged++;if(store.resolveHomeId(id)!==id)break;
 }
 store.set(`reviewDuplicateCheck:${id}`,{at:new Date().toISOString(),version,checked,merged});
 // Retain established handling of exact matches to previously closed decisions.
 const latest=store.db.prepare('SELECT stage,listing FROM homes WHERE id=?').get(id) as Row|undefined;
 if(store.resolveHomeId(id)===id&&latest?.listing===target.listing&&stages.includes(latest.stage))deduplicateHome(store,id);
}
