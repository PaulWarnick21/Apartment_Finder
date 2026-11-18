import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Store} from './db.ts';
import {Budget,assertAccessRecoveryCaps} from './plans.ts';
import {captureSchema} from './browser-bridge.ts';
import {recordSourceAccess} from './traffic-policy.ts';
import {sourceById} from './sources.ts';
import {heartbeatScan} from './scan-concurrency.ts';
export const chromeSnapshotSchema=captureSchema.omit({id:true}).extend({galleryComplete:z.boolean(),links:z.array(z.string().url().max(3000)).max(500).default([]),next:z.string().url().max(3000).nullable().optional(),galleryCursor:z.number().int().min(0).max(2000).optional(),gallerySlots:z.number().int().min(0).max(2000).optional()});
export type ChromeSnapshot=z.infer<typeof chromeSnapshotSchema>;
export type ChromeJobOptions={galleryCursor?:number;knownImages?:ChromeSnapshot['images'];factsOnly?:boolean;preReserved?:boolean};
type Job={id:string;planId:string;url:string;kind:'discovery'|'listing';maxRent:number|null;maxPhotos:number;state:'queued'|'claimed';expires:number;galleryCursor?:number;knownImages?:ChromeSnapshot['images'];factsOnly?:boolean};
export type ChromeJobClient=Pick<ChromeJobs,'request'|'fail'>;
export function chromeSource(url:string){try{const u=new URL(url);if(u.username||u.password||u.hash)return null;return u.origin==='https://www.apartments.com'?'apartments':u.origin==='https://www.zillow.com'?'zillow':null;}catch{return null;}}
export function allowedChromeJobUrl(url:string){return chromeSource(url)!==null;}
/** One in-flight command; every dispatch belongs to an already-running bounded plan. */
export class ChromeJobs {
 private active:{job:Job;resolve:(s:ChromeSnapshot)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setInterval>;budget:Budget}|null=null;
 constructor(private store:Store){}
 request(budget:Budget,url:string,kind:Job['kind'],maxRent:number|null,maxPhotos:number,accessRecovery=false,options:ChromeJobOptions={}){
  budget.check();if(budget.caps.cachedReviewOnly)throw new Error('Cached assessment cannot access listing sources or download photos');if(!allowedChromeJobUrl(url))throw new Error('Chrome job URL not allowed');if(this.active)throw new Error('Chrome job already running');
  if(!this.store.get('browserExtension'))throw new Error('Connect the Chrome extension first');
  const source=chromeSource(url)!;if(!budget.caps.sources.includes(source))throw new Error('Source not included in approved plan');
  if(accessRecovery){assertAccessRecoveryCaps(budget.caps);if(kind!=='discovery'||maxPhotos!==0)throw new Error('Recovery only permits one discovery page');}else this.store.checkSource(source);
  if(!options.preReserved){budget.reserve('pages');budget.reserve('requests');}recordSourceAccess(budget,sourceById(source),'page');
  const job:Job={id:randomUUID(),planId:budget.id,url,kind,maxRent,maxPhotos:Math.min(200,maxPhotos),state:'queued',expires:Date.now()+240000,galleryCursor:Math.max(0,Math.min(2000,options.galleryCursor??0)),knownImages:options.knownImages?.slice(0,500),factsOnly:options.factsOnly===true};
  return new Promise<ChromeSnapshot>((resolve,reject)=>{const timer=setInterval(()=>{try{budget.check();if(Date.now()>job.expires)throw new Error('Chrome did not finish the page within four minutes. Check the extension; no retry was made.');heartbeatScan(this.store,budget.id);}catch(e){this.fail(e instanceof Error?e.message:String(e),budget.id);}},1000);this.active={job,resolve,reject,timer,budget};});
 }
 poll(){if(!this.active)return {job:null};this.active.budget.check();if(this.active.job.state!=='queued')return {job:null};this.active.job.state='claimed';return {job:this.active.job};}
 check(input:unknown){const {id}=z.object({id:z.string().uuid()}).strict().parse(input);if(!this.active||this.active.job.id!==id)return {active:false};try{this.active.budget.check();if(this.active.job.expires<Date.now())throw new Error('Chrome job expired');return {active:true};}catch{this.fail('Chrome job cancelled or expired');return {active:false};}}
 result(input:unknown){const result=z.object({id:z.string().uuid(),snapshot:chromeSnapshotSchema.optional(),error:z.string().max(2000).optional()}).strict().parse(input);const current=this.active;
  if(!current||current.job.id!==result.id||current.job.state!=='claimed')throw new Error('Chrome job expired or already consumed');
  current.budget.check();
  if(result.error){this.fail(result.error);return {ok:true};}
  const snapshot=result.snapshot;if(!snapshot)throw new Error('Chrome snapshot required');
  if(chromeSource(snapshot.url)!==chromeSource(current.job.url)||new URL(snapshot.url).pathname!==new URL(current.job.url).pathname)throw new Error('Chrome returned a different page');
  if(snapshot.warning){this.store.pause(chromeSource(current.job.url)!,snapshot.warning,true);this.fail(snapshot.warning);return {ok:true};}
  clearInterval(current.timer);this.active=null;current.resolve(snapshot);return {ok:true};
 }
 /** Worker cleanup may cancel only its own Chrome work; app shutdown omits planId. */
 fail(message:string,planId?:string){const current=this.active;if(current&&(!planId||current.job.planId===planId)){clearInterval(current.timer);this.active=null;current.reject(new Error(message));}}
}
