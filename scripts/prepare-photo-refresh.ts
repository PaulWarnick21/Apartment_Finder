// Offline: prepare a reviewable manifest from saved pages and existing Inbox photos.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {load} from 'cheerio';
import {Store} from '../server/db.ts';
import {deskCategory} from '../src/desk-category.ts';
import {sourceById,allowedUrl} from '../server/sources.ts';
import {largestImage,craigslistGallery} from '../server/photo-resolution.ts';
const dir='data/live',store=new Store(join(dir,'apartments.sqlite'));
const upgrades=new Map<string,string>();
try{
 for(const name of await readdir(join(dir,'initial-trial'))){
  if(!/^(craigslist|vada|austeville|hollyburn)-detail-\d+\.html$/.test(name))continue;
  const source=sourceById(name.split('-')[0]),html=await readFile(join(dir,'initial-trial',name),'utf8'),$=load(html);
  if(source.id==='craigslist'){
   for(const high of craigslistGallery(html)){
    const id=high.replace(/_\d+x\d+\.jpg$/,'');
    for(const raw of $('a[href]').map((_,e)=>$(e).attr('href')!).get())if(raw.replace(/_\d+x\d+\.jpg$/,'')===id)upgrades.set(raw,high);
   }
  }else for(const e of $('img[src]').toArray()){
   const high=largestImage($,e,source.search,source.mediaHosts);if(!high)continue;
   const raw=[$(e).attr('src'),$(e).attr('data-src'),...($(e).attr('srcset')??'').split(',').map(s=>s.trim().split(/\s+/)[0])];
   for(const value of raw){try{if(!value)continue;const url=new URL(value,source.search).href;if(allowedUrl(url,source.mediaHosts))upgrades.set(url,high);}catch{}}
  }
 }
 const homes=store.homes().filter(h=>deskCategory(h)==='Unreviewed');
 const items=homes.flatMap(h=>h.listing.photos.filter(p=>p.local&&!p.sourceLocal).map(p=>({homeId:h.id,source:h.listing.source,photoId:p.id,previousUrl:p.url,url:upgrades.get(p.url)??p.url}))).filter(p=>p.url!==p.previousUrl);
 const plan={createdAt:new Date().toISOString(),approved:false,maxImageRequests:items.length,maxListingPages:0,maxAiCalls:0,apartmentIds:[...new Set(items.map(i=>i.homeId))],items};
 await writeFile(join(dir,'photo-refresh-plan.json'),JSON.stringify(plan,null,2));
 console.log(JSON.stringify({apartments:plan.apartmentIds,imageRequests:items.length,listingPages:0,aiCalls:0}));
}finally{store.close();}
