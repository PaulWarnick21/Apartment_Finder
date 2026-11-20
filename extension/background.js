import {capturePage} from './capture.js';
import {captureZillow} from './zillow-capture.js';
import {captureApartmentDiscovery} from './discovery.js';
const api='http://127.0.0.1:4317/api/browser-bridge/';
let busy=false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function call(path,body,token){const r=await fetch(api+path,{method:'POST',credentials:'omit',signal:AbortSignal.timeout(path==='jobs/poll'?25000:15000),headers:{'Content-Type':'application/json','X-AF-Extension-Id':chrome.runtime.id,'X-AF-Extension-Version':chrome.runtime.getManifest().version,Authorization:`Bearer ${token}`},body:JSON.stringify(body)});const value=await r.json();if(!r.ok)throw new Error(value.error??'Local app unavailable');return value;}
async function snapshot(tabId,zillow=false){return (await chrome.scripting.executeScript({target:{tabId},func:zillow?captureZillow:capturePage}))[0].result;}
async function collect(job,token){
 const check=async()=>{if(Date.now()>job.expires||!(await call('jobs/check',{id:job.id},token)).active)throw new Error('Scan cancelled or expired');};
 const u=new URL(job.url);if(!['https://www.apartments.com','https://www.zillow.com'].includes(u.origin)||u.username||u.password||u.hash)throw new Error('Job URL not permitted');
 const zillow=u.origin==='https://www.zillow.com';
 const pageClock=(await chrome.storage.local.get('sourcePageClock')).sourcePageClock??{};
 const gap=Math.max(5000,Math.min(20000,job.pageGapMs??10000));
 await sleep(Math.max(0,gap-(Date.now()-(pageClock[u.origin]??0))));
 await check();pageClock[u.origin]=Date.now();await chrome.storage.local.set({sourcePageClock:pageClock});
 await check();
 const progress=(await chrome.storage.local.get('galleryProgress')).galleryProgress??{};
 let saved=!zillow&&job.kind==='listing'&&!job.factsOnly?progress[job.url]:null,tab;
 if(saved){try{const existing=await chrome.tabs.get(saved.tabId);if(new URL(existing.url).origin+new URL(existing.url).pathname===job.url)tab=existing;}catch{}if(!tab){delete progress[job.url];saved=null;}}
 if(!tab)tab=await chrome.tabs.create({url:job.url,active:true});
 let retained=false;
 try{
  for(let i=0;i<30;i++){await sleep(1000);if((await chrome.tabs.get(tab.id)).status==='complete')break;}
  await sleep(3000);let page=await snapshot(tab.id,zillow);const initial=page;if(page.warning)return page;
  if(zillow)return page; // Entire property gallery is already embedded in its page data.
  if(job.kind==='discovery')return {...page,...(await chrome.scripting.executeScript({target:{tabId:tab.id},func:captureApartmentDiscovery}))[0].result};
  if(job.factsOnly)return page;
  const rent=Number((page.text.match(/\$([\d,]+)\s*Total Monthly Price/)?.[1]??'').replaceAll(',',''));
  if(job.maxRent&&rent>=job.maxRent)return page;
  if(!page.advertisedPhotos||job.maxPhotos===0)return page;
  if(saved&&saved.expected!==page.advertisedPhotos)saved=null;
  const galleryOpen=(await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{const active=document.querySelector('#rentalDetailContainer #activeMedia');return !!active&&active.getClientRects().length>0;}}))[0].result;
  if(!galleryOpen){saved=null;await check();await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>document.querySelector('#carouselPillPhotosLink')?.click()});await sleep(2500);}
  const photos=new Map((saved?.images??[]).map(im=>[new URL(im.url).pathname.match(/^\/i2\/([^/]+)\//)?.[1],im]));const expected=initial.advertisedPhotos;
  let cursor=saved?.cursor??0,slots=saved?.slots??0,newPhotos=0;
  const retain=async()=>{
   await check();
   progress[job.url]={tabId:tab.id,cursor,slots,expected,images:[...photos.values()],updatedAt:Date.now()};
   // Keep at most three paused scanner tabs. A tab the user navigated elsewhere is never closed.
   const entries=Object.entries(progress).sort((a,b)=>b[1].updatedAt-a[1].updatedAt);
   for(const [url,old] of entries.slice(3)){try{const oldTab=await chrome.tabs.get(old.tabId);if(oldTab.url&&new URL(oldTab.url).origin+new URL(oldTab.url).pathname===url)await chrome.tabs.remove(old.tabId);}catch{}delete progress[url];}
   await chrome.storage.local.set({galleryProgress:progress});retained=true;
   return {...initial,images:[...photos.values()],galleryComplete:false,galleryCursor:cursor,gallerySlots:slots};
  };
  for(let step=0;step<Math.min(30,job.maxPhotos+2);step++){
   await check();
   page=await snapshot(tab.id);if(page.warning)return page;
   for(const im of page.images){const identity=new URL(im.url).pathname.match(/^\/i2\/([^/]+)\//)?.[1];if(identity){if(!photos.has(identity))newPhotos++;if(!photos.has(identity)||im.width>photos.get(identity).width)photos.set(identity,im);}}
   slots=Math.max(slots,cursor+1);
   if(slots>=expected&&photos.size===expected){delete progress[job.url];await chrome.storage.local.set({galleryProgress:progress});return {...initial,images:[...photos.values()],galleryComplete:true,galleryCursor:cursor,gallerySlots:slots};}
   if(newPhotos>=job.maxPhotos)return await retain();
   const moved=(await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{const gallery=document.querySelector('#rentalDetailContainer');const next=[...(gallery?.querySelectorAll('button')??[])].find(b=>[b,...b.querySelectorAll('*')].some(el=>el.textContent.trim()===''||['::before','::after'].some(p=>getComputedStyle(el,p).content.includes(''))));if(next instanceof HTMLElement){next.click();return true;}return false;}}))[0].result;
   if(!moved)break;cursor++;await sleep(2000);
  }
  return await retain();
 }finally{if(!retained){if(progress[job.url]?.tabId===tab.id)delete progress[job.url];await chrome.storage.local.set({galleryProgress:progress});await chrome.tabs.remove(tab.id).catch(()=>{});}}
}
async function tick(){if(busy)return;busy=true;let token;try{
 await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});token=(await chrome.storage.local.get('token')).token;if(!token)return;
 // The existing alarm wakes an idle worker. During a run, a bounded localhost
 // long poll delivers the next approved job immediately without polling sources.
 while(true){
  const {job,watch}=await call('jobs/poll',{waitMs:20000},token);
  if(!job){if(watch)continue;break;}
  try{const result=await collect(job,token);await call('jobs/result',{id:job.id,snapshot:result},token);}
  catch(e){await call('jobs/result',{id:job.id,error:String(e.message??e).slice(0,2000)},token);}
 }
 }catch{/* App may be stopped. Never replay a claimed job after an error. */}finally{busy=false;}}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='apartment-finder')void tick();});
chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create('apartment-finder',{periodInMinutes:.5});void tick();});
chrome.runtime.onStartup.addListener(()=>{chrome.alarms.create('apartment-finder',{periodInMinutes:.5});void tick();});
chrome.runtime.onMessage.addListener(message=>{if(message?.type==='check-approved-jobs')void tick();});
