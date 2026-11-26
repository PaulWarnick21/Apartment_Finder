import React,{useRef,useState} from 'react';
import type {DiscoveryAlert} from '../server/discovery-alerts';

export function DiscoveryAlerts({alerts,onDismiss}:{alerts:DiscoveryAlert[];onDismiss:(id:string)=>Promise<void>}){
 const inFlight=useRef(new Set<string>());
 const [dismissals,setDismissals]=useState<Record<string,{status:'saving'|'saved'|'failed';error?:string}>>({});
 async function dismiss(id:string){
  if(inFlight.current.has(id))return;
  inFlight.current.add(id);
  setDismissals(current=>({...current,[id]:{status:'saving'}}));
  try{
   await onDismiss(id);
   // Keep the local acknowledgement for this mounted session: an older in-flight
   // poll must not resurrect this alert, even after the POST has succeeded.
   setDismissals(current=>({...current,[id]:{status:'saved'}}));
  }catch(error){
   setDismissals(current=>({...current,[id]:{status:'failed',error:error instanceof Error?error.message:String(error)}}));
  }finally{inFlight.current.delete(id);}
 }
 const visible=alerts.filter(a=>!a.dismissedAt&&(!dismissals[a.id]||dismissals[a.id].status==='failed'));
 const saving=Object.values(dismissals).filter(d=>d.status==='saving').length;
 if(!visible.length&&!saving)return null;
 return <section className="discovery-alerts" aria-label="Scan alerts" aria-live="polite">
  {visible.map(alert=><div className="alert discovery-alert" key={alert.id} role="status">
   <div><strong>Scan alert{alert.resolvedAt?' · Resolved':''}</strong><p>{alert.message}</p>{alert.resolvedAt&&<p>This earlier alert is no longer active. See Activity for the latest change.</p>}<small>{new Date(alert.at).toLocaleString()}</small>{dismissals[alert.id]?.status==='failed'&&<p role="alert">Dismissal could not be confirmed. {dismissals[alert.id].error} Press Dismiss to retry.</p>}</div>
   <button aria-label={`Dismiss ${alert.source} scan alert`} onClick={()=>void dismiss(alert.id)}>Dismiss</button>
  </div>)}
  {saving>0&&<p className="footnote" role="status">Saving {saving===1?'alert dismissal':`${saving} alert dismissals`}…</p>}
 </section>;
}
