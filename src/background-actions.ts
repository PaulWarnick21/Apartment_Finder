import {useRef,useState} from 'react';

export type Action=(work:()=>Promise<unknown>,message?:string,key?:string)=>Promise<void>;

/** Block duplicate work on the same resource, never unrelated parts of the desk. */
export function useBackgroundActions({refresh,onSaved,onError}:{refresh:()=>Promise<void>;onSaved:(message:string)=>void;onError:(message:string)=>void}){
 const active=useRef(new Set<string>()),[pending,setPending]=useState<string[]>([]);
 const action:Action=async(work,message='Saved',key=message)=>{
  if(active.current.has(key))return;
  active.current.add(key);setPending([...active.current]);
  try{
   await work();onSaved(message);
   // A slow/read-failed refresh must not hold controls or turn a saved write into a failure.
   void refresh().catch(()=>onError('Your change was saved, but the desk could not refresh. It will try again in the background.'));
  }catch(error){onError(error instanceof Error?error.message:String(error));}
  finally{active.current.delete(key);setPending([...active.current]);}
 };
 return {action,isPending:(key:string)=>pending.includes(key),pendingCount:pending.length};
}
