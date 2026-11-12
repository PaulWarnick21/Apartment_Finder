import {capturePage} from './capture.js';
const base='http://127.0.0.1:4317/api/browser-bridge/';
const status=document.querySelector('#status');
await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
async function request(path,body,token){
 const response=await fetch(base+path,{method:'POST',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-AF-Extension-Id':chrome.runtime.id,...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
 const result=await response.json();if(!response.ok)throw new Error(result.error??'Local app request failed');return result;
}
async function run(work){document.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='Working…';try{await work();}catch(e){status.textContent=e.message==='Failed to fetch'?'Open Apartment Finder and try again. The local app could not be reached.':e.message;}finally{document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
document.querySelector('#connect').addEventListener('click',()=>run(async()=>{
 const code=document.querySelector('#code').value.trim();const result=await request('pair',{code,extensionId:chrome.runtime.id});
 await chrome.storage.local.set({token:result.token});document.querySelector('#code').value='';status.textContent='Connected. Open the approved listing tab, then click “Send this page”.';
}));
document.querySelector('#capture').addEventListener('click',()=>run(async()=>{
 const {token}=await chrome.storage.local.get('token');if(!token)throw new Error('Connect using the code from Preferences first.');
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab?.id||!tab.url||new URL(tab.url).origin!=='https://www.apartments.com')throw new Error('Select the approved Apartments.com listing tab first.');
 const approved=await request('claim',{url:tab.url},token);
 const results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:capturePage});
 if(!results[0]?.result)throw new Error('Page could not be read. Prepare another connection test.');
 const result=await request('capture',{...results[0].result,id:approved.id},token);
 status.textContent=`${result.message}\n${result.imageCount} loaded image URLs found; ${result.advertisedPhotos??'unknown'} advertised photos. Full gallery review is pending.`;
}));
