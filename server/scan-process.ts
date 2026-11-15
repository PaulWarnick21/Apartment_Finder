import {spawn,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import type {Store} from './db.ts';
import {Budget,getPlan} from './plans.ts';
import type {ChromeJobs,ChromeSnapshot} from './chrome-jobs.ts';

type Request={type:'chrome-request';requestId:string;planId:string;url:string;kind:'listing'|'discovery';maxRent:number|null;maxPhotos:number;accessRecovery:boolean;options?:Record<string,unknown>};
/** The server retains the authenticated browser bridge; the scanner runs independently. */
export class ScanProcesses{
 private children=new Map<string,ChildProcess>();
 constructor(private store:Store,private dataDir:string,private jobs:ChromeJobs){}
 get hasActive(){return this.children.size>0;}
 start(id:string){
  if(this.children.size)throw new Error('Another scan process is running');
  if(this.store.path===':memory:')throw new Error('A scan process needs a persistent database');
  const plan=getPlan(this.store,id);if(plan.state!=='approved')throw new Error('An approved plan is required');
  const child=spawn(process.execPath,['--import','tsx',fileURLToPath(new URL('./worker-cli.ts',import.meta.url)),id,'--data-dir',resolve(this.dataDir),'--ipc'],{windowsHide:true,stdio:['pipe','pipe','pipe','ipc']});
  this.children.set(id,child);
  // Never relay raw subprocess output, which may include private page content.
  child.stdout?.resume();child.stderr?.resume();
  child.on('message',message=>{
   const m=message as Request|{type:'chrome-fail';message:string};
   if(m.type==='chrome-fail'){this.jobs.fail(m.message);return;}
   if(m.type!=='chrome-request'||m.planId!==id)return;
   const reply=(result:unknown)=>{if(child.connected)child.send({type:'chrome-result',requestId:m.requestId,...result as object});};
   try{
    const current=getPlan(this.store,id),budget=new Budget(this.store,id,current.caps);
    // SourceBudget in the child reserved both counts before dispatching this message.
    void this.jobs.request(budget,m.url,m.kind,m.maxRent,m.maxPhotos,m.accessRecovery,{...m.options,preReserved:true}).then(snapshot=>reply({snapshot}),error=>reply({error:error instanceof Error?error.message:'Chrome request failed'}));
   }catch(error){reply({error:error instanceof Error?error.message:'Chrome request failed'});}
  });
  child.on('error',()=>this.store.event('Scan process could not start. Prepare a new plan after checking the local runtime.'));
  // close also fires after a spawn error, when no exit event is emitted.
  child.on('close',code=>{
   this.children.delete(id);this.jobs.fail('Scan process finished');
   const current=getPlan(this.store,id);
   if(current.state==='approved')this.store.db.prepare("UPDATE plans SET state='interrupted',detail='Worker could not claim this plan. A new approval is required.' WHERE id=?").run(id);
   if(current.state==='running')this.store.event(`Scan worker interrupted (exit ${code??'signal'}). Completed results retained; use interrupted-run recovery.`);
  });
 }
 async close(){
  const children=[...this.children.values()];
  await Promise.all(children.map(child=>new Promise<void>(done=>{child.once('close',()=>done());child.kill();setTimeout(done,3000).unref();})));
 }
}

export function chromeIpcClient():Pick<ChromeJobs,'request'|'fail'>{
 const pending=new Map<string,{resolve:(s:ChromeSnapshot)=>void;reject:(e:Error)=>void}>();
 process.on('message',(message:any)=>{if(message?.type!=='chrome-result')return;const p=pending.get(message.requestId);if(!p)return;pending.delete(message.requestId);message.error?p.reject(new Error(message.error)):p.resolve(message.snapshot);});
 process.on('disconnect',()=>{for(const p of pending.values())p.reject(new Error('Local app disconnected; scan stopped'));pending.clear();});
 return {
  request(budget,url,kind,maxRent,maxPhotos,accessRecovery=false,options={}){
   budget.check();if(!process.connected||!process.send)throw new Error('Local app is not connected');
   budget.reserve('pages');budget.reserve('requests');const requestId=randomUUID();
   return new Promise<ChromeSnapshot>((resolve,reject)=>{pending.set(requestId,{resolve,reject});process.send!({type:'chrome-request',requestId,planId:budget.id,url,kind,maxRent,maxPhotos,accessRecovery,options},undefined,undefined,(error:Error|null)=>{if(error){pending.delete(requestId);reject(new Error('Local app disconnected'));}});});
  },
  fail(message){if(process.connected)process.send?.({type:'chrome-fail',message});for(const p of pending.values())p.reject(new Error(message));pending.clear();}
 };
}
