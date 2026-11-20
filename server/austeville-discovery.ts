import {load} from 'cheerio';
import {allowedUrl,type Source} from './sources.ts';
import {listingUrl,type DiscoveryCard} from './source-discovery.ts';

/** Reproduce only the neighbourhood filter advertised by this exact source page.
 * The site's current renderer crashes on a suite whose parent is another suite.
 * Missing/conflicting parent evidence is excluded, never assigned to the search area.
 */
export function austevilleScopedFeed(html:string,url:string){
 try{
  const u=new URL(url);if(u.hostname!=='www.austeville.com'||u.pathname!=='/vacancies/')return null;
  const selected=u.searchParams.get('neighbourhood');if(!selected||!/^\d+$/.test(selected))return null;
  const $=load(html),script=$('script').toArray().map(e=>$(e).text()).find(s=>/var propertySearchConfig\s*=/.test(s));
  const raw=script?.match(/var propertySearchConfig\s*=\s*(\{[^]*?\});/)?.[1];if(!raw)return null;
  const config=JSON.parse(raw),filter=config.filters?.find((f:any)=>f.id==='neighbourhood');
  if(config.mode!=='residential'||filter?.initialValue?.length!==1||String(filter.initialValue[0])!==selected)return null;
  const endpoint=config.endpoints?.property;if(typeof endpoint!=='string'||!allowedUrl(endpoint,['www.austeville.com'])||new URL(endpoint).pathname!=='/wp-json/wp/v2/re_property'||new URL(endpoint).searchParams.get('per_page')!=='100')return null;
  return {endpoint,neighbourhood:Number(selected)};
 }catch{return null;}
}
export function austevilleScopedCards(json:string,source:Source,neighbourhood:number):DiscoveryCard[]{
 const rows=JSON.parse(json);if(!Array.isArray(rows))throw Error('Austeville inventory response not recognized');
 if(rows.length>=100)throw Error('Austeville feed may have further pages; scoped coverage is incomplete');
 const byId=new Map(rows.map(r=>[r.id,r]));const cards:DiscoveryCard[]=[];
 for(const row of rows){
  const url=typeof row.link==='string'?listingUrl(row.link,source):null,parent=byId.get(row.parent);
  if(!url||row.status!=='publish'||!parent||parent.parent!==0||parent.status!=='publish')continue;
  const areas=parent.acf?.property_neighbourhood_id;
  if(!Array.isArray(areas)||!areas.includes(neighbourhood))continue;
  const own=row.acf?.property_neighbourhood_id;if(Array.isArray(own)&&own.length&&!own.includes(neighbourhood))continue;
  const rent=Number(row.acf?.rent?.cost),beds=row.acf?.bedroom_count;
  if(!(rent>0)||!row.acf?.available_at)continue;
  cards.push({url,title:load(String(row.title?.rendered??'')).text().slice(0,500),rent,beds:Number.isInteger(beds)&&beds>=0?beds:null,city:parent.acf?.property_address?.city,availability:'available'});
 }
 return cards;
}
