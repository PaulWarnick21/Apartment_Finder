import {setTimeout as sleep} from 'node:timers/promises';
import {Budget} from './plans.ts';
import type {ChromeJobClient} from './chrome-jobs.ts';
import {allowedUrl,type Source} from './sources.ts';
import {listingUrl} from './source-discovery.ts';

/** Normal Chrome owns page navigation; only public gallery images use HTTP. */
export class ChromeSourceSession {
 stopped=false;private lastImage=0;
 constructor(private source:Source,private budget:Budget,private jobs?:ChromeJobClient){}
 async start(){this.budget.check();this.budget.store.checkSource(this.source.id);if(!this.jobs)throw new Error('Keep the app and paired Chrome extension open for Zillow scans');}
 async html(url:string){
  const page=await this.jobs!.request(this.budget,url,listingUrl(url,this.source)?'listing':'discovery',this.budget.store.criteria.maxRent,this.budget.remaining('photos'));
  if(page.truncated)throw new Error('Chrome capture exceeded its size limit; extraction deferred');
  return page.html;
 }
 async resource(_url:string):Promise<string>{throw new Error('Additional Chrome resource requests are not supported');}
 async image(url:string){
  this.budget.check();this.budget.store.checkSource(this.source.id);if(this.stopped)throw new Error('Source paused');
  if(!allowedUrl(url,this.source.mediaHosts))throw new Error('Image host not allowed');
  await sleep(Math.max(0,1000-(Date.now()-this.lastImage)));this.budget.check();this.lastImage=Date.now();
  const count=this.budget.store.db.prepare("SELECT COUNT(*) n FROM requests WHERE source=? AND kind='image' AND at>=?").get(this.source.id,new Date(Date.now()-86400000).toISOString()) as {n:number};
  if(count.n>=(this.source.dailyImages??100))throw new Error('Daily image limit reached');
  this.budget.reserve('photos');this.budget.reserve('requests');this.budget.store.db.prepare('INSERT INTO requests(source,at,kind) VALUES (?,?,?)').run(this.source.id,new Date().toISOString(),'image');
  const response=await fetch(url,{signal:AbortSignal.timeout(20000),redirect:'error'}).catch(e=>{this.stopped=true;this.budget.store.pause(this.source.id,'Image request failed or exceeded the time limit');throw e;});
  if([403,429,503].includes(response.status)){this.stopped=true;this.budget.store.pause(this.source.id,`Photo server returned HTTP ${response.status}`,true);throw new Error('Photo access warning; source paused');}
  if(!response.ok)throw new Error(`Image unavailable: ${response.status}`);
  const chunks:Uint8Array[]=[];let size=0;const reader=response.body!.getReader();
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>15000000)throw new Error('Photo too large');chunks.push(value);}}finally{await reader.cancel();}
  return Buffer.concat(chunks);
 }
 async close(){}
}
