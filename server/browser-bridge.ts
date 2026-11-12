import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {Store} from './db.ts';
import {extractApartments} from './apartments-extraction.ts';

export const testListingUrl='https://www.apartments.com/33-smithe-st-vancouver-bc-unit-coopers-lookout/e4p3tpn/';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const same=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function extensionOrigin(origin:string|undefined,id:string){
 if(!/^[a-p]{32}$/.test(id)||origin!==undefined&&origin!==`chrome-extension://${id}`)throw new Error('Extension origin not allowed');
}
export function listingUrl(value:string){const u=new URL(value);if(u.origin!=='https://www.apartments.com'||u.username||u.password||!/^\/[a-z0-9-]+\/[a-z0-9]{7}\/$/.test(u.pathname))throw new Error('Choose an Apartments.com listing URL');return u.origin+u.pathname;}
const imageSchema=z.object({url:z.string().url().max(3000),alt:z.string().max(1000),width:z.number().int().min(0).max(100000),height:z.number().int().min(0).max(100000)}).strict();
export const captureSchema=z.object({id:z.string().uuid(),url:z.string().max(3000),title:z.string().max(1000),text:z.string().max(150000),html:z.string().max(1000000),images:z.array(imageSchema).max(500),advertisedPhotos:z.number().int().min(0).max(10000).nullable(),galleryComplete:z.literal(false),warning:z.string().max(1000).nullable(),truncated:z.boolean()}).strict();
type Pair={id:string;tokenHash:string};
type Probe={id:string;url:string;state:'approved'|'claimed'|'saved'|'failed';expires:number;message?:string;imageCount?:number;advertisedPhotos?:number|null};
export class BrowserBridge {
 private code:{hash:string;expires:number;attempts:number}|null=null;
 // Approval is deliberately in memory: restart never resumes or reauthorizes a capture.
 private probe:Probe|null=null;
 constructor(private store:Store,private dataDir:string,private demo=false){}
 private enabled(){if(this.demo)throw new Error('Browser connection is disabled in the offline demo');}
 state(){const pair=this.store.get<Pair>('browserExtension');return {connected:!!pair,extensionId:pair?.id??null,probe:this.probe,lastCapture:this.store.get<Probe>('browserLastCapture')??null,lastExtraction:this.store.get('browserLastExtraction')??null};}
 prepare(){this.enabled();if(this.store.db.prepare('SELECT 1 FROM scan_lock WHERE id=1').get())throw new Error('Finish the running scan first');
  const code=randomBytes(12).toString('hex');this.code={hash:digest(code),expires:Date.now()+600000,attempts:0};
  this.probe={id:randomUUID(),url:testListingUrl,state:'approved',expires:Date.now()+600000};
  this.store.event('Approved one Chrome connection test: one existing Apartments.com page, no navigation, photo downloads or AI calls.');
  return {code,expires:this.code.expires,url:testListingUrl};
 }
 pair(input:unknown,origin?:string){this.enabled();const {code,extensionId}=z.object({code:z.string().max(100),extensionId:z.string()}).strict().parse(input);extensionOrigin(origin,extensionId);
  if(!this.code||this.code.expires<Date.now()||this.code.attempts++>=5||!same(digest(code.trim()),this.code.hash))throw new Error('Pairing code invalid or expired; prepare another connection test');
  this.code=null;const token=randomBytes(32).toString('hex');this.store.set('browserExtension',{id:extensionId,tokenHash:digest(token)});
  this.store.event('Normal Chrome extension connected. Automatic scanning remains off.');return {token};
 }
 authenticate(id:string,authorization:string,origin?:string){this.enabled();extensionOrigin(origin,id);const pair=this.store.get<Pair>('browserExtension');
  if(!pair||pair.id!==id||!authorization.startsWith('Bearer ')||!same(digest(authorization.slice(7)),pair.tokenHash))throw new Error('Extension is not connected');
 }
 claim(input:unknown){const {url}=z.object({url:z.string().max(3000)}).strict().parse(input);const p=this.probe;
  if(!p||p.state!=='approved'||p.expires<Date.now()||listingUrl(url)!==p.url)throw new Error('No approved connection test for this page. Prepare one in Preferences.');
  p.state='claimed';return {id:p.id,url:p.url};
 }
 save(input:unknown){const snapshot=captureSchema.parse(input),p=this.probe;
  if(!p||p.state!=='claimed'||p.expires<Date.now()||snapshot.id!==p.id||listingUrl(snapshot.url)!==p.url)throw new Error('Capture approval expired or already used');
  for(const im of snapshot.images){const u=new URL(im.url);if(u.protocol!=='https:'||u.username||u.password)throw new Error('Invalid photo URL');}
  const folder=join(this.dataDir,'browser-captures');mkdirSync(folder,{recursive:true});
  writeFileSync(join(folder,`${p.id}.json`),JSON.stringify({...snapshot,capturedAt:new Date().toISOString()},null,2),{flag:'wx'});
  p.state=snapshot.warning?'failed':'saved';p.imageCount=snapshot.images.length;p.advertisedPhotos=snapshot.advertisedPhotos;
  p.message=snapshot.warning??'Page evidence saved. Gallery extraction and scoring still need validation.';
  if(!snapshot.warning){try{
   const listing=extractApartments(snapshot),extractions=join(this.dataDir,'browser-extractions');mkdirSync(extractions,{recursive:true});
   writeFileSync(join(extractions,`${p.id}.json`),JSON.stringify(listing,null,2),{flag:'wx'});
   this.store.set('browserLastExtraction',{captureId:p.id,rent:listing.rent,beds:listing.beds,photos:listing.photos.length,expectedPhotos:listing.expectedPhotos,conflicts:listing.conflicts,error:null});
   p.message=`Listing facts extracted locally; ${listing.photos.length} distinct photo references found. Full photo retrieval and review remain pending.`;
  }catch(e){this.store.set('browserLastExtraction',{captureId:p.id,error:e instanceof Error?e.message:'Extraction failed'});}}
  this.store.set('browserLastCapture',p);this.store.event(snapshot.warning?'Chrome connection test stopped on a page warning.':'Chrome page evidence saved locally; no listing imported or scored.');
  if(snapshot.warning)this.store.pause('apartments',snapshot.warning,true);
  return {ok:true,message:p.message,imageCount:p.imageCount,advertisedPhotos:p.advertisedPhotos};
 }
 disconnect(){this.code=null;this.probe=null;this.store.set('browserExtension',null);this.store.event('Chrome extension disconnected; pending connection test cancelled.');}
}
