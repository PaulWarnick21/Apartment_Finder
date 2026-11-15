import {load} from 'cheerio';
import {allowedUrl,type Source} from './sources.ts';
export type DiscoveryCard={url:string;title?:string;rent?:number|null;beds?:number|null;city?:string;area?:string;postedAt?:string;discoveredAt?:string};
const paths:Record<string,RegExp>={craigslist:/\/\d+\.html$|^\/view\/d\/[^/]+\/[a-zA-Z0-9]+\/?$/,vada:/bedroom.*rental|rental.*bedroom/i,apartments:/\/[^/]+\/[a-z0-9]{7}\/$/,zillow:/\/homedetails\/[^/]+\/\d+_zpid\//,zumper:/\/apartment-buildings\/p\d+\/|\/apartments-for-rent\/\d+(?:p|\/)/,facebook:/\/marketplace\/item\/\d+\//,rew:/\/rentals\/\d+\//,kijiji:/\/v-apartments-condos\/[^/]+\/[^/]+\/\d+$/,hollyburn:/\/furnished_rental\/[^/]+\//,austeville:/\/property\/[^/]+\/suite-[^/]+\//,easyrent:/\/listings\/[^/]+\//,sunstar:/\/listings\/[^/]+\//};
export function listingUrl(value:string,source:Source,base=source.search){try{const u=new URL(value,base);u.hash='';u.search='';return allowedUrl(u.href,source.hosts)&&(paths[source.id]?.test(u.pathname)||source.id==='hollyburn'&&source.coverageTrial&&/^\/building\/[^/]+\/$/.test(u.pathname))?u.href:null;}catch{return null;}}
export function discoveryCards(html:string,source:Source,base=source.search):DiscoveryCard[]{
 const $=load(html),found=new Map<string,DiscoveryCard>();
 if(source.id==='craigslist'){const category=html.match(/['"]initialCategoryAbbr['"]\s*:\s*['"]([^'"]+)/)?.[1];if(category&&category!=='apa'||/for sale.*craigslist/i.test($('title').text()))return [];}
 $('a[href]').each((_,e)=>{const a=$(e),url=listingUrl(a.attr('href')!,source,base);if(!url)return;
  const row=a.closest('article,li,tr,[data-testid="property-card"],.result-row,.cl-search-result,.property-card');
  const container=row.length?row:a;
  // A metadata row must refer to one ad, never an entire results list with several prices.
  const rowUrls=new Set(container.find('a[href]').map((_,link)=>listingUrl($(link).attr('href')!,source,base)).get().filter(Boolean));
  const textNode=(rowUrls.size<=1?container:a).clone();textNode.find('*').after(' ');const text=textNode.text().replace(/\s+/g,' ').trim();
  if(source.id==='sunstar'&&/\bRented\b/i.test(text)&&!/FOR RENT/i.test(text))return;
  const prices=[...new Set([...text.matchAll(/\$\s*([\d,]+)(?:\.\d{2})?/g)].map(m=>Number(m[1].replaceAll(',',''))).filter(n=>n>1))];
  const datetime=container.find('time[datetime]').first().attr('datetime');
  const card:DiscoveryCard={url,title:a.text().replace(/\s+/g,' ').trim().slice(0,500),rent:prices.length===1?prices[0]:null,beds:Number(text.match(/\b(\d+)\s*(?:bedrooms?|beds?|br)\b/i)?.[1])||null};
  const city=text.match(/\b(North Vancouver|West Vancouver|New Westminster|Port Moody|Vancouver|Burnaby|Richmond|Coquitlam|Surrey|Calgary|Toronto|Ottawa|Edmonton|Victoria|Kelowna)\b/i)?.[0];if(city)card.city=city;
  const area=text.match(/\b(Coal Harbour|West End|Yaletown|Downtown(?: Vancouver)?|Kitsilano|Mount Pleasant|Olympic Village|Fairview)\b/i)?.[0];if(area)card.area=area;
  if(datetime&&Number.isFinite(Date.parse(datetime)))card.postedAt=new Date(datetime).toISOString();
  const previous=found.get(url);found.set(url,{...card,...previous,rent:previous?.rent??card.rent,city:previous?.city??card.city,area:previous?.area??card.area,postedAt:previous?.postedAt??card.postedAt});
 });return [...found.values()];
}
export function discoverSource(html:string,source:Source,base=source.search){return discoveryCards(html,source,base).map(card=>card.url);}
export function nextDiscovery(html:string,source:Source,base=source.search){const $=load(html);const next=$('a[rel="next"],a[aria-label="Next page"],a[title="Next page"],a.next');const href=next.first().attr('href')??$('a[href]').filter((_,e)=>/^next(?:\s+page)?\s*[›»→]?$/i.test($(e).text().trim())).first().attr('href');if(!href)return null;try{const u=new URL(href,base);return allowedUrl(u.href,source.hosts)&&u.href!==base&&!listingUrl(u.href,source)?u.href:null;}catch{return null;}}
/** Definite advertised failures only; absent/ranged prices and unknown places remain candidates. */
export function discoveryFailure(card:DiscoveryCard,maxRent:number|null){if(maxRent!==null&&card.rent!=null&&card.rent>=maxRent)return 'Advertised rent reaches or exceeds the configured ceiling';if(card.city&&/^(Calgary|Toronto|Ottawa|Edmonton|Victoria|Kelowna)$/i.test(card.city))return 'Advertised city is outside the Vancouver search region';return null;}
export function prioritizeCards(cards:DiscoveryCard[]){const area=(c:DiscoveryCard)=>/Coal Harbour|West End|Yaletown|Downtown/i.test(c.area??'')?0:/North Vancouver|West Vancouver|Burnaby|Richmond|Coquitlam|Port Moody|Surrey|New Westminster/i.test(c.city??'')?2:1;return [...cards].sort((a,b)=>area(a)-area(b)||(Date.parse(b.postedAt??'')||0)-(Date.parse(a.postedAt??'')||0));}
/** The inventory endpoint is advertised by Austeville's own vacancies page. */
export function inventoryEndpoint(html:string,source:Source){if(source.id!=='austeville')return null;const normalized=html.replaceAll('\\/','/').replaceAll('&amp;','&');const url=normalized.match(/https:\/\/www\.austeville\.com\/wp-json\/wp\/v2\/re_property\?[^"<>\s]+/)?.[0];return url&&allowedUrl(url,source.hosts)?url:null;}
export function inventoryUrls(json:string,source:Source){const rows=JSON.parse(json);if(!Array.isArray(rows))throw new Error('Inventory response was not recognized');return [...new Set(rows.filter(r=>r.status==='publish'&&Number(r.acf?.rent?.cost)>0&&r.acf?.available_at).map(r=>listingUrl(r.link,source)).filter((url):url is string=>!!url))];}
