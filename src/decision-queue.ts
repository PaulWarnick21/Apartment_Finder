import type {Home} from './domain';
import {ApiError} from './api-request';

type Edits=Partial<Pick<Home,'notes'|'followUp'|'viewing'>>;
export type Decision={home:Home;stage:Home['stage'];edits:Edits;at:string;status:'queued'|'saving'|'failed'|'saved';error?:string;saved?:Home;retry?:boolean};
type Request=(path:string,method?:string,body?:unknown)=>Promise<Home>;

/** Per-apartment optimistic decisions. Network latency never locks the rest of the desk. */
export class DecisionQueue{
 private entries:Decision[]=[];
 private published:Decision[]=[];
 private listeners=new Set<()=>void>();
 private active=0;
 constructor(private request:Request,private concurrency=2){}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 snapshot=()=>this.published;
 // Subscribers (including memoized cards) need immutable status snapshots.
 private emit(){this.published=this.entries.map(entry=>({...entry}));for(const listener of this.listeners)listener();}
 blocked(id:number){return this.entries.some(entry=>entry.home.id===id&&entry.status!=='saved');}
 enqueue(home:Home,stage:Home['stage'],edits:Edits={}){
  if(this.blocked(home.id))return false;
  this.entries=this.entries.filter(entry=>entry.home.id!==home.id);
  this.entries.push({home,stage,edits,at:new Date().toISOString(),status:'queued'});
  this.emit();this.pump();return true;
 }
 retry(id:number){const entry=this.entries.find(e=>e.home.id===id&&e.status==='failed');if(!entry)return;entry.status='queued';entry.retry=true;entry.error=undefined;this.emit();this.pump();}
 dismiss(id:number){const entry=this.entries.find(e=>e.home.id===id&&e.status==='failed');if(!entry)return;entry.saved=entry.home;entry.status='saved';this.emit();}
 /** Retain acknowledged writes until a sufficiently recent poll arrives. */
 reconcile(homes:Home[]){
  const current=new Map(homes.map(home=>[home.id,home]));
  // A phone may lose the write response while the database still commits it.
  for(const entry of this.entries){
   const home=current.get(entry.home.id);
   if(entry.status==='failed'&&home&&home.revision>entry.home.revision&&this.matches(entry,home)){entry.saved=home;entry.status='saved';}
  }
  const remaining=this.entries.filter(entry=>entry.status!=='saved'||!current.has(entry.home.id)||current.get(entry.home.id)!.revision<entry.saved!.revision);
  if(remaining.length!==this.entries.length){this.entries=remaining;this.emit();}
 }
 project(homes:Home[]){
  const entries=new Map(this.entries.map(entry=>[entry.home.id,entry]));
  return homes.map(home=>{
   const entry=entries.get(home.id);if(!entry)return home;
   if(entry.status==='failed')return home.revision>=entry.home.revision?home:entry.home;
   if(entry.status==='saved')return home.revision>=entry.saved!.revision?home:entry.saved!;
   return {...home,...entry.edits,stage:entry.stage,categoryEnteredAt:entry.at,
    ...(home.reviewMode&&entry.stage==='Interested'?{reviewMode:home.fullReview?.status==='complete'?'full' as const:'quick' as const}:{}),
   };
  });
 }
 private pump(){
  while(this.active<this.concurrency){const entry=this.entries.find(e=>e.status==='queued');if(!entry)return;entry.status='saving';this.active++;this.emit();void this.send(entry);}
 }
 private async send(entry:Decision){
  try{
   let home=entry.home;
   if(entry.retry){home=await this.readCurrent(entry);if(entry.status==='saved')return;}
   for(let attempt=0;attempt<2;attempt++){
    try{
     const fields={...home,...entry.edits};
     const saved=this.validate(entry,await this.request(`homes/${home.id}`,'PUT',{revision:home.revision,stage:entry.stage,notes:fields.notes,followUp:fields.followUp,viewing:fields.viewing,rescued:home.rescued}));
     if(!this.matches(entry,saved)||saved.revision<=home.revision)throw new ApiError('The response did not confirm this decision.',true);
     entry.saved=saved;entry.status='saved';return;
    }catch(error){
     if(!(error instanceof ApiError&&error.recoverable))throw error;
     // Recover at most once, preserving concurrent user edits and current revisions.
     // The final read also handles a delayed first write winning the revision race.
     home=await this.readCurrent(entry);
     if(entry.status==='saved')return;
     if(attempt===1)throw error;
    }
   }
  }catch(error){entry.status='failed';entry.error=error instanceof Error?error.message:String(error);}
  finally{this.active--;this.emit();this.pump();}
 }
 private matches(entry:Decision,home:Home){return home.stage===entry.stage&&Object.entries(entry.edits).every(([key,value])=>home[key as keyof Edits]===value);}
 private validate(entry:Decision,home:Home){
  if(!home||!Number.isSafeInteger(home.id)||!Number.isSafeInteger(home.revision)||typeof home.stage!=='string'||typeof home.notes!=='string'||typeof home.followUp!=='string'||typeof home.viewing!=='string'||typeof home.rescued!=='boolean')throw new ApiError('The app returned an incomplete apartment response.',true);
  if(home.id!==entry.home.id)throw new Error('This apartment was merged into another record. Refresh and review that apartment before deciding.');
  return home;
 }
 private async readCurrent(entry:Decision){
  const home=this.validate(entry,await this.request(`homes/${entry.home.id}`));
  if(this.matches(entry,home)&&home.revision>entry.home.revision){entry.saved=home;entry.status='saved';return home;}
  if(home.revision<entry.home.revision)throw new Error('The latest saved state is not available yet. Retry when the connection recovers.');
  if(home.stage!==entry.home.stage)throw new Error('The saved stage changed. Review this apartment before making another decision.');
  for(const key of Object.keys(entry.edits) as (keyof Edits)[])if(home[key]!==entry.home[key]&&home[key]!==entry.edits[key])throw new Error('Your saved notes or dates changed. Review this apartment before retrying.');
  return home;
 }
}
