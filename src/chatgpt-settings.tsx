import {useState} from 'react';
import type {ChatGptState} from '../server/chatgpt';
type Props={state:ChatGptState;disabled:boolean;request:(path:string,method?:string,body?:unknown)=>Promise<any>;action:(work:()=>Promise<unknown>,message?:string)=>Promise<void>};
export function ChatGptSettings({state,disabled,request,action}:Props){
 const [busy,setBusy]=useState(false);
 async function command(path:string,body?:unknown){if(busy)return;setBusy(true);try{await action(()=>request(`chatgpt/${path}`,'POST',body),'ChatGPT settings updated');}finally{setBusy(false);}}
 async function connect(newProfile=false){setBusy(true);try{await action(async()=>{const result=await request('chatgpt/connect','POST',{newProfile});window.location.assign(result.url);},'Opening ChatGPT sign-in');}finally{setBusy(false);}}
 const blocked=disabled||busy;
 return <section className="chatgpt-settings" aria-label="ChatGPT connection"><h3>AI photo analysis</h3><p>Use your existing ChatGPT plan. Requests share your plan’s allowance. The app never switches to a paid API key automatically.</p>
 {state.profiles.length>0&&<label>ChatGPT account<select aria-label="ChatGPT account" disabled={blocked||state.pending} value={state.active} onChange={e=>command('account',{id:e.target.value})}>{state.profiles.map(p=><option value={p.id} key={p.id}>{p.label}</option>)}</select></label>}
 <p><strong>{state.sharing?'Using ChatGPT plan':state.connected?'Signed in · plan permission needed':'Not connected'}</strong></p>
 {state.message&&<p role="status">{state.message}</p>}
 <div className="dialog-actions">
 <button className="chatgpt-button" data-oai-siwc-button disabled={blocked||state.pending} onClick={()=>connect()}>{state.connected&&!state.sharing?'Enable ChatGPT plan usage':'Continue with ChatGPT'}</button>
 {state.pending&&<button disabled={blocked} onClick={()=>command('cancel')}>Cancel sign-in</button>}
 {state.profiles.length>0&&!state.pending&&<button disabled={blocked} onClick={()=>connect(true)}>Add account</button>}
 {state.connected&&!state.pending&&<button disabled={blocked} onClick={()=>command('disconnect')}>Sign out</button>}
 <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">Manage usage ↗</a>
 </div>
 {state.sharing&&<div className="form-grid"><label>Photo analysis model<select aria-label="Photo analysis model" value={state.model} disabled={blocked||state.pending} onChange={e=>command('model',{model:e.target.value})}><option value="" disabled>Load models, then choose one</option>{state.models.map(m=><option key={m.slug} value={m.slug}>{m.name}</option>)}</select></label><button disabled={blocked||state.pending} onClick={()=>command('models')}>Load available models</button></div>}
 <p className="footnote">In ChatGPT Settings → Usage, set an app limit and disable use of purchased credits after the plan limit, if that option is shown. This app cannot change that account setting. Connecting alone does not start a scan.</p><hr/>
 </section>;
}
