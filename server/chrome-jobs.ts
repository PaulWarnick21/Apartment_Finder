import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Store} from './db.ts';
import {Budget} from './plans.ts';
import {captureSchema} from './browser-bridge.ts';
export const chromeSnapshotSchema=captureSchema.omit({id:true}).extend({galleryComplete:z.boolean(),links:z.array(z.string().url().max(3000)).max(500).default([])});
export type ChromeSnapshot=z.infer<typeof chromeSnapshotSchema>;
type Job={id:string;planId:string;url:string;kind:'discovery'|'listing';maxRent:number|null;maxPhotos:number;state:'queued'|'claimed';expires:number};
export function allowedChromeJobUrl(url:string){try{const u=new URL(url);return u.origin==='https://www.apartments.com'&&!u.username&&!u.password&&!u.hash;}catch{return false;}}
/** One in-flight command; every dispatch belongs to an already-running bounded plan. */
export class ChromeJobs {
 private active:{job:Job;resolve:(s:ChromeSnapshot)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setInterval>;budget:Budget}|null=null;
 constructor(private store:Store){}
 request(budget:Budget,url:string,kind:Job['kind'],maxRent:number|null,maxPhotos:number){
  budget.check();if(!allowedChromeJobUrl(url))throw new Error('Chrome job URL not allowed');if(this.active)throw new Error('Chrome job already running');
  if(!this.store.get('browserExtension'))throw new Error('Connect the Chrome extension first');
  this.store.checkSource('apartments');
  const count=this.store.db.prepare("SELECT COUNT(*) n FROM requests WHERE source='apartments' AND kind='page' AND at>=?").get(new Date(Date.now()-86400000).toISOString()) as {n:number};
  if(count.n>=15)throw new Error('Apartments.com daily page cap reached');
  budget.reserve('pages');budget.reserve('requests');this.store.db.prepare('INSERT INTO requests(source,at,kind) VALUES (?,?,?)').run('apartments',new Date().toISOString(),'page');
  const job:Job={id:randomUUID(),planId:budget.id,url,kind,maxRent,maxPhotos:Math.min(200,maxPhotos),state:'queued',expires:Date.now()+240000};
  return new Promise<ChromeSnapshot>((resolve,reject)=>{const timer=setInterval(()=>{try{budget.check();if(Date.now()>job.expires)throw new Error('Chrome did not finish the page within four minutes. Check the extension; no retry was made.');this.store.db.prepare('UPDATE scan_lock SET heartbeat=? WHERE owner=?').run(new Date().toISOString(),budget.id);}catch(e){this.fail(e instanceof Error?e.message:String(e));}},1000);this.active={job,resolve,reject,timer,budget};});
 }
 poll(){if(!this.active)return {job:null};this.active.budget.check();if(this.active.job.state!=='queued')return {job:null};this.active.job.state='claimed';return {job:this.active.job};}
 check(input:unknown){const {id}=z.object({id:z.string().uuid()}).strict().parse(input);if(!this.active||this.active.job.id!==id)return {active:false};try{this.active.budget.check();if(this.active.job.expires<Date.now())throw new Error('Chrome job expired');return {active:true};}catch{this.fail('Chrome job cancelled or expired');return {active:false};}}
 result(input:unknown){const result=z.object({id:z.string().uuid(),snapshot:chromeSnapshotSchema.optional(),error:z.string().max(2000).optional()}).strict().parse(input);const current=this.active;
  if(!current||current.job.id!==result.id||current.job.state!=='claimed')throw new Error('Chrome job expired or already consumed');
  current.budget.check();
  if(result.error){this.fail(result.error);return {ok:true};}
  const snapshot=result.snapshot;if(!snapshot)throw new Error('Chrome snapshot required');
  if(!allowedChromeJobUrl(snapshot.url)||new URL(snapshot.url).pathname!==new URL(current.job.url).pathname)throw new Error('Chrome returned a different page');
  if(snapshot.warning){this.store.pause('apartments',snapshot.warning,true);this.fail(snapshot.warning);return {ok:true};}
  clearInterval(current.timer);this.active=null;current.resolve(snapshot);return {ok:true};
 }
 fail(message:string){const current=this.active;if(current){clearInterval(current.timer);this.active=null;current.reject(new Error(message));}}
}
