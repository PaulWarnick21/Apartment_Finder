import {capturePage} from './capture.js';
const api='http://127.0.0.1:4317/api/browser-bridge/';
let busy=false,lastPage=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function call(path,body,token){const r=await fetch(api+path,{method:'POST',credentials:'omit',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-AF-Extension-Id':chrome.runtime.id,Authorization:`Bearer ${token}`},body:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw new Error(value.error??'Local app unavailable');return value;}
async function snapshot(tabId){return (await chrome.scripting.executeScript({target:{tabId},func:capturePage}))[0].result;}
async function collect(job,token){
 const check=async()=>{if(Date.now()>job.expires||!(await call('jobs/check',{id:job.id},token)).active)throw new Error('Scan cancelled or expired');};
 const u=new URL(job.url);if(u.origin!=='https://www.apartments.com'||u.username||u.password)throw new Error('Job URL not permitted');
 await sleep(Math.max(0,10000-(Date.now()-lastPage)));lastPage=Date.now();
 await check();
 const tab=await chrome.tabs.create({url:job.url,active:true});
 try{
  for(let i=0;i<30;i++){await sleep(1000);if((await chrome.tabs.get(tab.id)).status==='complete')break;}
  await sleep(3000);let page=await snapshot(tab.id);const initial=page;if(page.warning)return page;
  if(job.kind==='discovery')return {...page,links:(await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>[...document.querySelectorAll('a[href]')].map(a=>a.href).filter(h=>/^https:\/\/www\.apartments\.com\/[^/]+\/[a-z0-9]{7}\/$/.test(h)).slice(0,500)}))[0].result};
  const rent=Number((page.text.match(/\$([\d,]+)\s*Total Monthly Price/)?.[1]??'').replaceAll(',',''));
  if(job.maxRent&&rent>=job.maxRent)return page;
  if(!page.advertisedPhotos||page.advertisedPhotos>job.maxPhotos)return page;
  await check();await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>document.querySelector('#carouselPillPhotosLink')?.click()});
  await sleep(2500);const photos=new Map();const expected=initial.advertisedPhotos;
  for(let i=0;i<Math.min(page.advertisedPhotos+2,202);i++){
   await check();
   page=await snapshot(tab.id);if(page.warning)return page;
   for(const im of page.images){const identity=new URL(im.url).pathname.match(/^\/i2\/([^/]+)\//)?.[1];if(identity&&(!photos.has(identity)||im.width>photos.get(identity).width))photos.set(identity,im);}
   if(photos.size===expected&&i>=expected-1)return {...initial,images:[...photos.values()],galleryComplete:true};
   const moved=(await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{const gallery=document.querySelector('#rentalDetailContainer');const next=[...(gallery?.querySelectorAll('button')??[])].find(b=>[b,...b.querySelectorAll('*')].some(el=>el.textContent.trim()===''||['::before','::after'].some(p=>getComputedStyle(el,p).content.includes(''))));if(next instanceof HTMLElement){next.click();return true;}return false;}}))[0].result;
   if(!moved)break;await sleep(2000);
  }
  return {...initial,images:[...photos.values()],galleryComplete:false};
 }finally{await chrome.tabs.remove(tab.id).catch(()=>{});}
}
async function tick(){if(busy)return;busy=true;let job,token;try{
 await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});token=(await chrome.storage.local.get('token')).token;if(!token)return;
 ({job}=await call('jobs/poll',{},token));if(!job)return;
 try{const result=await collect(job,token);await call('jobs/result',{id:job.id,snapshot:result},token);}catch(e){await call('jobs/result',{id:job.id,error:String(e.message??e).slice(0,2000)},token);}
 }catch{/* App may be stopped. Never navigate or retry a claimed job after an error. */}finally{busy=false;}}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='apartment-finder')void tick();});
chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create('apartment-finder',{periodInMinutes:.5});void tick();});
chrome.runtime.onStartup.addListener(()=>{chrome.alarms.create('apartment-finder',{periodInMinutes:.5});void tick();});
chrome.runtime.onMessage.addListener(message=>{if(message?.type==='check-approved-jobs')void tick();});
