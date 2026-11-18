import type {Photo} from './domain';

export function photoUrl(photo:Pick<Photo,'local'|'sourceLocal'>,size:'card'|'preview'|'original'='preview'){
 const file=size==='original'?(photo.sourceLocal||photo.local):photo.local;
 return file?`/media/${file}${size==='original'?'':`?size=${size}&v=1`}`:'';
}

type Entry={url:string;image:HTMLImageElement;state:'queued'|'loading'|'ready';priority:number;owners:Set<symbol>;promise:Promise<boolean>;resolve:(ready:boolean)=>void};

/** Share downloads across cards/viewers and keep decoded neighbours ready, without
 * downloading whole galleries or retaining unbounded decoded image memory. */
export function createPhotoLoader(makeImage=()=>new Image(),concurrency=3,maxCached=48,maxPixels=16_000_000){
 const entries=new Map<string,Entry>();let active=0;
 const touch=(entry:Entry)=>{entries.delete(entry.url);entries.set(entry.url,entry);};
 const trim=()=>{
  const ready=[...entries.values()].filter(entry=>entry.state==='ready');
  let pixels=ready.reduce((sum,entry)=>sum+entry.image.naturalWidth*entry.image.naturalHeight,0);
  while(ready.length>1&&(ready.length>maxCached||pixels>maxPixels)){
   const entry=ready.shift()!;entries.delete(entry.url);pixels-=entry.image.naturalWidth*entry.image.naturalHeight;
  }
 };
 const pump=()=>{
  while(active<concurrency){
   const entry=[...entries.values()].filter(item=>item.state==='queued'&&item.owners.size).sort((a,b)=>b.priority-a.priority)[0];
   if(!entry)break;
   active++;entry.state='loading';let settled=false;
   const finish=(ready:boolean)=>{
    if(settled)return;settled=true;active--;entry.image.onload=null;entry.image.onerror=null;
    if(ready){entry.state='ready';touch(entry);trim();}else entries.delete(entry.url);
    entry.resolve(ready);pump();
   };
   entry.image.decoding='async';entry.image.fetchPriority=entry.priority>0?'high':'low';
   entry.image.onload=()=>{void(async()=>{
    try{await entry.image.decode();finish(true);}catch{finish(entry.image.naturalWidth>0);}
   })();};
   entry.image.onerror=()=>finish(false);
   try{entry.image.src=entry.url;}catch{finish(false);}
  }
 };
 const acquire=(url:string,owner:symbol,priority:number)=>{
  let entry=entries.get(url);
  if(!entry){
   let resolve!:(ready:boolean)=>void;const promise=new Promise<boolean>(done=>{resolve=done;});
   entry={url,image:makeImage(),state:'queued',priority,owners:new Set(),promise,resolve};entries.set(url,entry);
  }
  entry.owners.add(owner);entry.priority=Math.max(priority,entry.priority);if(entry.state==='ready')touch(entry);
  return entry;
 };
 const release=(entry:Entry,owner:symbol)=>{
  entry.owners.delete(owner);
  if(entry.state==='queued'&&!entry.owners.size){entries.delete(entry.url);entry.resolve(false);}
 };
 return {
  preload(urls:readonly string[]){
   const owner=Symbol(),held=[...new Set(urls.filter(Boolean))].map(url=>acquire(url,owner,0));pump();
   return ()=>{for(const entry of held)release(entry,owner);};
  },
  async warm(url:string,signal?:AbortSignal){
   if(!url||signal?.aborted)return false;
   const owner=Symbol(),entry=acquire(url,owner,1);pump();
   let aborted!:()=>void;
   try{return await new Promise<boolean>(done=>{
    aborted=()=>{release(entry,owner);done(false);};signal?.addEventListener('abort',aborted,{once:true});
    void entry.promise.then(done);
   });}finally{signal?.removeEventListener('abort',aborted);release(entry,owner);}
  }
 };
}

let shared:ReturnType<typeof createPhotoLoader>|undefined;
const loader=()=>shared??=createPhotoLoader();
export const preloadPhotos=(urls:readonly string[])=>loader().preload(urls);
export const warmPhoto=(url:string,signal?:AbortSignal)=>loader().warm(url,signal);
