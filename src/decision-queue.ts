import type {Home} from './domain';

type Edits=Partial<Pick<Home,'notes'|'followUp'|'viewing'>>;
export type Decision={home:Home;stage:Home['stage'];edits:Edits;at:string;status:'queued'|'saving'|'failed'|'saved';error?:string;saved?:Home;retry?:boolean};
type Request=(path:string,method?:string,body?:unknown)=>Promise<Home>;

/** Per-apartment optimistic decisions. Network latency never locks the rest of the desk. */
export class DecisionQueue{
 private entries:Decision[]=[];
 private listeners=new Set<()=>void>();
 private active=0;
 constructor(private request:Request,private concurrency=2){}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 snapshot=()=>this.entries;
 private emit(){this.entries=[...this.entries];for(const listener of this.listeners)listener();}
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
   if(entry.retry){
    home=await this.request(`homes/${home.id}`);
    // A lost response can mean the original write succeeded. Never authorize it twice.
    if(home.stage===entry.stage&&Object.entries(entry.edits).every(([key,value])=>home[key as keyof Edits]===value)){entry.saved=home;entry.status='saved';return;}
    if(home.stage!==entry.home.stage)throw new Error('The saved stage changed. Review this apartment before making another decision.');
    for(const key of Object.keys(entry.edits) as (keyof Edits)[])if(home[key]!==entry.home[key]&&home[key]!==entry.edits[key])throw new Error('Your saved notes or dates changed. Review this apartment before retrying.');
   }
   const fields={...home,...entry.edits};
   entry.saved=await this.request(`homes/${home.id}`,'PUT',{revision:home.revision,stage:entry.stage,notes:fields.notes,followUp:fields.followUp,viewing:fields.viewing,rescued:home.rescued});
   entry.status='saved';
  }catch(error){entry.status='failed';entry.error=error instanceof Error?error.message:String(error);}
  finally{this.active--;this.emit();this.pump();}
 }
}
