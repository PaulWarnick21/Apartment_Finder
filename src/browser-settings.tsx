import {useEffect,useState} from 'react';
type Props={disabled:boolean;request:(path:string,method?:string,body?:unknown)=>Promise<any>};
export function BrowserSettings({disabled,request}:Props){
 const [state,setState]=useState<any>(null),[code,setCode]=useState(''),[url,setUrl]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;const refresh=()=>request('browser/state').then(s=>{if(active)setState(s);}).catch(()=>{});void refresh();const timer=setInterval(refresh,5000);return()=>{active=false;clearInterval(timer);};},[]);
 async function prepare(){setBusy(true);setMessage('');try{const r=await request('browser/prepare','POST');setCode(r.code);setUrl(r.url);setState(await request('browser/state'));}catch(e){setMessage(String(e).replace(/^Error: /,''));}finally{setBusy(false);}}
 async function disconnect(){setBusy(true);try{await request('browser/disconnect','POST');setCode('');setState(await request('browser/state'));}catch(e){setMessage(String(e));}finally{setBusy(false);}}
 const probe=state?.probe??state?.lastCapture;
 return <section className="chatgpt-settings" aria-label="Normal Chrome connection"><h3>Normal Chrome connection</h3>
 <p>{state?.connected?'Extension connected':'Extension not connected'} · Apartments.com</p>
 <p>Version 0.2 opens listing pages and collects galleries only for a scan approved in the desk. Keep Chrome open. The optional connection test below reads one existing page without navigation, photo downloads or AI.</p>
 <div className="dialog-actions"><button disabled={disabled||busy} onClick={prepare}>Approve one page connection test</button>{state?.connected&&<button disabled={disabled||busy} onClick={disconnect}>Disconnect Chrome</button>}</div>
 {code&&<div className="approval-summary">{state?.connected?<p>Chrome is connected. This one-page approval expires after 10 minutes.</p>:<><p>Paste this code into the Chrome extension and click Connect. It expires after 10 minutes.</p><code style={{userSelect:'all',overflowWrap:'anywhere'}}>{code}</code></>}<p><a href={url} target="_blank" rel="noreferrer">Open the approved listing ↗</a>, then use the extension’s “Send this page” button.</p></div>}
 {probe&&<p role="status">Test: {probe.state}. {probe.message}{probe.imageCount!==undefined&&` Loaded image URLs: ${probe.imageCount}; advertised photos: ${probe.advertisedPhotos??'unknown'}. Full gallery review pending.`}</p>}
 {state?.lastExtraction&&probe&&state.lastExtraction.captureId===probe.id&&<p>{state.lastExtraction.error?`Extraction needs attention: ${state.lastExtraction.error}`:`Extracted: ${state.lastExtraction.beds??'?'} bedroom(s), $${state.lastExtraction.rent??'?'} monthly, ${state.lastExtraction.photos} distinct photo references of ${state.lastExtraction.expectedPhotos??'unknown'} advertised. ${(state.lastExtraction.conflicts??[]).join(' ')}`}</p>}
 {message&&<p role="alert" className="warning">{message}</p>}<hr/></section>;
}
