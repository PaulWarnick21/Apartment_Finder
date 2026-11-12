import {readFile,writeFile} from 'node:fs/promises';
import {extractRemaining} from '../server/remaining-extraction.ts';
import {load} from 'cheerio';
const listings=[];
const first=JSON.parse(await readFile('data/live/remaining-trial/first-pages.json','utf8'));
const next=JSON.parse(await readFile('data/live/remaining-trial/next-pages.json','utf8'));
const facebookUrls=[...first.find((m:any)=>m.source==='facebook').urls,...next.find((m:any)=>m.source==='facebook').urls];
for(const source of ['zillow','rew','facebook'] as const)for(let i=1;i<=3;i++){
 const base=`data/live/remaining-trial/${source}-${i}`;
 const html=await readFile(base+'.html','utf8'),$=load(html);
 const url=$('link[rel="canonical"]').attr('href')??(source==='facebook'?facebookUrls[i-1]:null);
 if(!url)throw new Error('Captured page canonical URL missing');
 const listing=extractRemaining(source,html,url);
 listings.push(listing);console.log(JSON.stringify({source,index:i,title:listing.title,rent:listing.rent,photos:listing.photos.length,laundry:listing.laundry,conflicts:listing.conflicts}));
}
await writeFile('data/live/remaining-trial/extracted.json',JSON.stringify(listings,null,2));
