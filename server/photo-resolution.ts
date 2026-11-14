import type {CheerioAPI} from 'cheerio';
import {allowedUrl} from './sources.ts';
/** Select only advertised variants of this image, not guessed CDN transformations. */
export function largestImage($:CheerioAPI,element:any,base:string,hosts:string[]):string {
 const el=$(element),src=el.attr('src')??'',candidates:{url:string;rank:number}[]=[];
 const add=(raw:string|undefined,rank:number)=>{try{if(!raw)return;const url=new URL(raw,base).href;if(allowedUrl(url,hosts))candidates.push({url,rank});}catch{}};
 add(src,0);add(el.attr('data-src'),1);
 for(const part of (el.attr('srcset')??el.attr('data-srcset')??'').split(',')){const m=part.trim().match(/^(\S+)\s+(\d+(?:\.\d+)?)([wx])$/);if(m)add(m[1],Number(m[2])*(m[3]==='x'?1000:1));}
 add(el.attr('data-original'),100000);add(el.attr('data-full'),100000);
 const link=el.parent('a').attr('href');if(link&&/\.(?:jpe?g|png|webp)(?:\?|$)/i.test(link))add(link,100000);
 return candidates.sort((a,b)=>b.rank-a.rank)[0]?.url??'';
}
export function craigslistGallery(html:string):string[]{
 try{
  const entries=JSON.parse(html.match(/var\s+imgList\s*=\s*(\[[\s\S]*?\]);/)?.[1]??'[]');
  const config=JSON.parse(html.match(/['"]imageConfig['"]\s*:\s*(\{[^\n]+\})\s*,/)?.[1]??'{}');
  if(!Array.isArray(entries))return [];
  return entries.flatMap((entry:any)=>{
   if(!allowedUrl(entry.url,['images.craigslist.org']))return [];
   const type=String(entry.imgid??'').split(':')[0],spec=config[type];
   if(spec?.hostname!=='https://images.craigslist.org'||!Array.isArray(spec.sizes))return [entry.url];
   const sizes=spec.sizes.filter((s:unknown)=>typeof s==='string'&&/^\d+x\d+$/.test(s)).sort((a:string,b:string)=>Number(b.split('x')[0])-Number(a.split('x')[0]));
   return [sizes.length?entry.url.replace(/_\d+x\d+\.jpg$/,`_${sizes[0]}.jpg`):entry.url];
  });
 }catch{return [];}
}
