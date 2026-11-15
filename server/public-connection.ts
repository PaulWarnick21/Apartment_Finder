import type {ChatGptState} from './chatgpt.ts';

/** Cache only the public status, never tokens. Coalesce overlapping UI polls. */
export class PublicConnectionStatus{
 private cached?:{value:ChatGptState;at:number};private pending?:Promise<ChatGptState>;private generation=0;
 constructor(private read:()=>Promise<ChatGptState>,private ttl=30000){}
 invalidate(){this.generation++;this.cached=undefined;this.pending=undefined;}
 async get(){
  if(this.cached&&Date.now()-this.cached.at<this.ttl)return this.cached.value;
  if(this.pending)return this.pending;
  const generation=this.generation;
  const task=this.read().catch(()=>({connected:false,sharing:false,model:'',models:[],active:'',profiles:[],pending:false,message:'Connection status is unavailable. Saved apartments are still available; check Preferences to reconnect.'})).then(value=>{if(generation===this.generation)this.cached={value,at:Date.now()};return value;}).finally(()=>{if(this.pending===task)this.pending=undefined;});
  this.pending=task;return task;
 }
}
