import {Budget} from './plans.ts';
import type {ChromeJobClient} from './chrome-jobs.ts';
import {allowedUrl,type Source} from './sources.ts';
import {listingUrl} from './source-discovery.ts';
import {recordSourceAccess} from './traffic-policy.ts';
import {waitForSourceAccess} from './source-pacing.ts';

/** Normal Chrome owns page navigation; only public gallery images use HTTP. */
export class ChromeSourceSession {
 stopped=false;
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
  await waitForSourceAccess(this.budget,this.source.id,'image',()=>{this.budget.store.checkSource(this.source.id);if(this.stopped)throw new Error('Source paused');});
  this.budget.reserve('photos');this.budget.reserve('requests');recordSourceAccess(this.budget,this.source,'image');
  const response=await fetch(url,{signal:AbortSignal.timeout(20000),redirect:'error'}).catch(e=>{this.stopped=true;this.budget.store.pause(this.source.id,'Image request failed or exceeded the time limit');throw e;});
  if([403,429,503].includes(response.status)){this.stopped=true;this.budget.store.pause(this.source.id,`Photo server returned HTTP ${response.status}`,true);throw new Error('Photo access warning; source paused');}
  if(!response.ok)throw new Error(`Image unavailable: ${response.status}`);
  const chunks:Uint8Array[]=[];let size=0;const reader=response.body!.getReader();
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>15000000)throw new Error('Photo too large');chunks.push(value);}}finally{await reader.cancel();}
  return Buffer.concat(chunks);
 }
 async close(){}
}
