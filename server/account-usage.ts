import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {z} from 'zod';

const windowSchema=z.object({usedPercent:z.number().min(0).max(100),windowDurationMins:z.number(),resetsAt:z.number().nullable()});
const bucketSchema=z.object({primary:windowSchema.nullable(),secondary:windowSchema.nullable(),spendControlReached:z.boolean().nullable().optional()});
const usageSchema=z.object({ordinaryUsageAllowed:z.boolean().nullable(),accountId:z.string().nullable(),rateLimits:bucketSchema,rateLimitsByLimitId:z.record(z.string(),bucketSchema).nullable().optional()});
export type AccountUsage={accountId:string;usedPercent:number;checkedAt:number;resetsAt:number|null};
export function validateAccountUsage(value:unknown,expectedAccountId:string,stopAt:number,now=Date.now()):AccountUsage{
 if(!Number.isFinite(stopAt)||stopAt<=0||stopAt>100)throw new Error('Invalid configured account usage reserve.');
 const r=usageSchema.parse(value),bucket=r.rateLimitsByLimitId?.codex??r.rateLimits;
 if(!expectedAccountId||r.accountId!==expectedAccountId)throw new Error('Usage monitor account does not match the account authorized for full assessments.');
 if(r.ordinaryUsageAllowed!==true||bucket.spendControlReached===true)throw new Error('Ordinary ChatGPT account usage is unavailable; full assessment paused.');
 const week=[bucket.primary,bucket.secondary].find(w=>w?.windowDurationMins===10080);
 if(!week)throw new Error('Weekly account usage is unavailable; full assessment paused.');
 if(week.usedPercent>=stopAt)throw new Error('Weekly usage reserve reached; full assessment paused.');
 if([bucket.primary,bucket.secondary].some(w=>w&&w.usedPercent>=100))throw new Error('An account usage window is exhausted; full assessment paused.');
 return {accountId:r.accountId!,usedPercent:week.usedPercent,checkedAt:now,resetsAt:week.resetsAt};
}

/** Read-only official local app-server RPC. No threads, model calls or reset consumption. */
export class AccountUsageClient{
 private child?:ChildProcessWithoutNullStreams;private ready?:Promise<void>;private next=0;private buffer='';
 private pending=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
 private fail(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Local account usage monitor disconnected.'));}this.pending.clear();this.ready=undefined;this.child=undefined;this.buffer='';}
 private async start(){
  if(this.ready)return this.ready;
  this.ready=(async()=>{
   const child=spawn(process.env.AF_CODEX_EXECUTABLE||'codex',['app-server','--stdio'],{windowsHide:true,stdio:['pipe','pipe','pipe']});this.child=child;
   child.stderr.resume(); // Do not expose local configuration/authentication diagnostics.
   child.stdout.setEncoding('utf8');child.stdout.on('data',(chunk:string)=>{
    this.buffer+=chunk;if(this.buffer.length>2_000_000){this.close();return;}
    let end:number;while((end=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);let message:any;try{message=JSON.parse(line);}catch{continue;}
     const p=this.pending.get(message.id);if(!p)continue;this.pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(new Error('Account usage read failed; no assessment request was sent.')):p.resolve(message.result);
    }
   });child.once('error',()=>{if(this.child===child)this.fail();});child.once('close',()=>{if(this.child===child)this.fail();});
   await this.rpc('initialize',{clientInfo:{name:'apartment_finder_usage',title:'Apartment Finder usage monitor',version:'1.0'},capabilities:{experimentalApi:true}});
   child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  })();
  try{await this.ready;}catch(e){this.close();throw e;}
 }
 private rpc(method:string,params:unknown){return new Promise<unknown>((resolve,reject)=>{
  if(!this.child)return reject(new Error('Local account usage monitor is unavailable.'));
  const id=++this.next,timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Account usage read timed out; full assessment paused.'));},30000);
  this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,params})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(new Error('Local account usage monitor is unavailable.'));}});
 });}
 async read(){await this.start();return this.rpc('account/rateLimits/read',{excludeResetCreditDetails:true,supportsLunaReserve:false});}
 close(){const child=this.child;this.fail();child?.kill();}
}
const client=new AccountUsageClient();
export const readAccountUsage=()=>client.read();
export const closeAccountUsage=()=>client.close();
