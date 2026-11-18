import {load} from 'cheerio';
import type {Listing} from '../src/domain.ts';

/** Calendar months, clamped to the last valid day of the destination month. */
export function monthsBefore(now:number,months:number){
 const date=new Date(now),day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-months);
 const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,last));return date.getTime();
}
/** Unknown/invalid/future posting dates are neutral; discovery time is never a substitute. */
export function postingAgeRank(postedAt:string|undefined,months:number|null|undefined,now=Date.now()){
 if(!months||!postedAt)return 0;const time=Date.parse(parsePostingDate(postedAt,now)??'');
 return Number(Number.isFinite(time)&&time<=now&&time<monthsBefore(now,months));
}
export function parsePostingDate(value:unknown,now=Date.now()):string|undefined{
 if(typeof value==='number'){const time=value<1e12?value*1000:value;return time>=946684800000&&time<=now?new Date(time).toISOString():undefined;}
 if(typeof value!=='string')return undefined;
 const raw=value.trim().replace(/^(?:posted|listed|published)(?:\s+on)?\s*:?\s*/i,'');
 if(/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(raw)){
  const time=Date.parse(raw),date=new Date(time);
  const day=new Date(raw.slice(0,10)+'T00:00:00Z');
  if(Number.isFinite(time)&&time<=now&&Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===raw.slice(0,10))return date.toISOString();
  return undefined;
 }
 // Only specific elapsed durations; vague "over a week ago" could be much older.
 const ago=raw.match(/^(\d+)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|[mhdw])\s+ago$/i);
 if(!ago)return undefined;const n=Number(ago[1]),unit=ago[2].toLowerCase();if(n>1000)return undefined;
 const time=unit.startsWith('month')?monthsBefore(now,n):unit.startsWith('year')?monthsBefore(now,n*12):now-n*(unit.startsWith('w')?7*86400000:unit.startsWith('d')?86400000:unit.startsWith('h')?3600000:60000);
 return time>=946684800000?new Date(time).toISOString():undefined;
}
export function applyPostingDate(listing:Listing,postedAt?:string,evidence?:string){
 if(postedAt){listing.postedAt=postedAt;listing.evidence.postedAt=evidence??`Source posting date: ${postedAt}`;}return listing;
}
/** Structured dates must match the requested listing IDs; unrelated ads cannot age a listing. */
export function sourcePostingDates(html:string,source:string,urls:string[],now=Date.now()){
 const dates=new Map<string,string>(),$=load(html),byId=new Map<string,string>();
 for(const url of urls){const id=url.match(source==='facebook'?/\/item\/(\d+)/:/\/(\d+)(?:\.html)?\/?$/)?.[1];if(id)byId.set(id,url);}
 const add=(url:string|undefined,value:unknown)=>{const date=parsePostingDate(value,now);if(url&&date)dates.set(url,date);};
 if(source==='facebook'){
  const walk=(o:unknown)=>{if(!o||typeof o!=='object')return;const p=o as Record<string,any>,url=byId.get(String(p.id));
   if(url&&(p.marketplace_listing_title||p.listing_photos||p.redacted_description)){
    add(url,p.creation_time);
    if(!dates.has(url))for(const section of p.pdp_display_sections??[])for(const field of section.pdp_fields??[])if(typeof field.display_label==='string'&&/^Listed\s/i.test(field.display_label))add(url,field.display_label.split(' · ')[0]);
   }
   for(const value of Object.values(p))if(value&&typeof value==='object')walk(value);
  };
  $('script[type="application/json"]').each((_,e)=>{try{walk(JSON.parse($(e).text()));}catch{/* Missing source data stays unknown. */}});
 }
 if(source==='kijiji')try{
  const state=JSON.parse($('#__NEXT_DATA__').text()).props?.pageProps?.__APOLLO_STATE__??{};
  for(const [key,p] of Object.entries(state) as [string,any][])if(key.startsWith('RealEstateListing:'))add(byId.get(String(p.id)),p.activationDate);
 }catch{/* Missing source data stays unknown. */}
 return dates;
}
/** Explicit publication fields only. Update/availability dates do not establish posting age. */
export function detailPostingDate(html:string,source:string,url:string,now=Date.now()){
 const structured=sourcePostingDates(html,source,[url],now).get(url);if(structured)return structured;
 const $=load(html);$('nav,footer,aside,[class*="recommend"],[id*="recommend"]').remove();
 const dates=new Set<string>();
 $('time[itemprop="datePosted"],time[itemprop="datePublished"],meta[itemprop="datePosted"],meta[property="article:published_time"]').each((_,e)=>{const value=parsePostingDate($(e).attr('datetime')??$(e).attr('content'),now);if(value)dates.add(value);});
 if(source==='craigslist')$('.postinginfo').each((_,e)=>{if(/^posted\s*:/i.test($(e).text().trim())){const value=parsePostingDate($(e).find('time').attr('datetime'),now);if(value)dates.add(value);}});
 return dates.size===1?[...dates][0]:undefined;
}
