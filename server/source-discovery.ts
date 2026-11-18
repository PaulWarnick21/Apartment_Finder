import {load} from 'cheerio';
import {allowedUrl,type Source} from './sources.ts';
import {zumperState} from './zumper-extraction.ts';
import {parsePostingDate,postingAgeRank,sourcePostingDates} from './listing-age.ts';
export type DiscoveryCard={url:string;title?:string;rent?:number|null;beds?:number|null;city?:string;area?:string;postedAt?:string;discoveredAt?:string;availability?:'available'|'unavailable'|'unknown';availabilityEvidence?:string;searchUrl?:string;searchRegion?:string};
const paths:Record<string,RegExp>={craigslist:/\/\d+\.html$|^\/view\/d\/[^/]+\/[a-zA-Z0-9]+\/?$/,vada:/bedroom.*rental|rental.*bedroom/i,apartments:/^\/[^/]+\/[a-z0-9]{7}\/$/,zillow:/\/homedetails\/[^/]+\/\d+_zpid\//,zumper:/^\/(?:apartment-buildings\/p\d+\/|(?:apartments-for-rent|listings)\/\d+(?:p|\/))/,facebook:/\/marketplace\/item\/\d+\//,rew:/\/rentals\/\d+\//,kijiji:/\/v-apartments-condos\/[^/]+\/[^/]+\/\d+$/,hollyburn:/\/furnished_rental\/[^/]+\//,austeville:/\/property\/[^/]+\/suite-[^/]+\//,easyrent:/\/listings\/[^/]+\//,sunstar:/\/listings\/[^/]+\//};
export function listingUrl(value:string,source:Source,base=source.search){try{const u=new URL(value,base);u.hash='';u.search='';return allowedUrl(u.href,source.hosts)&&(paths[source.id]?.test(u.pathname)||source.id==='hollyburn'&&source.coverageTrial&&/^\/building\/[^/]+\/$/.test(u.pathname))?u.href:null;}catch{return null;}}
export function discoveryCards(html:string,source:Source,base=source.search,now=Date.now()):DiscoveryCard[]{
 const $=load(html),found=new Map<string,DiscoveryCard>();
 if(source.id==='easyrent'&&new URL(base).searchParams.has('_city')&&!$('.facetwp-template').length)return [];
 if(source.id==='craigslist'){const category=html.match(/['"]initialCategoryAbbr['"]\s*:\s*['"]([^'"]+)/)?.[1];if(category&&category!=='apa'||/for sale.*craigslist/i.test($('title').text()))return [];}
 $('a[href]').each((_,e)=>{const a=$(e);if(source.id==='easyrent'&&$('.facetwp-template').length&&!a.closest('.facetwp-template').length)return;const url=listingUrl(a.attr('href')!,source,base);if(!url)return;
  const row=a.closest('article,li,tr,[data-testid="property-card"],.result-row,.cl-search-result,.property-card');
  const container=row.length?row:a;
  // A metadata row must refer to one ad, never an entire results list with several prices.
  const rowUrls=new Set(container.find('a[href]').map((_,link)=>listingUrl($(link).attr('href')!,source,base)).get().filter(Boolean));
  const textNode=(rowUrls.size<=1?container:a).clone();textNode.find('*').after(' ');const text=textNode.text().replace(/\s+/g,' ').trim();
  const availabilityEvidence=source.id==='easyrent'?text.match(/\bAvailable\s*:\s*(.*?)(?=\s*View details|$)/i)?.[1]?.trim():source.id==='sunstar'&&/\bRented\b/i.test(text)&&!/FOR RENT/i.test(text)?'Rented':undefined;
  const unavailable=!!availabilityEvidence&&/^(?:rented|leased|unavailable|not available|no longer available)\b/i.test(availabilityEvidence);
  const prices=[...new Set([...text.matchAll(/\$\s*([\d,]+)(?:\.\d{2})?/g)].map(m=>Number(m[1].replaceAll(',',''))).filter(n=>n>1))];
  const scoped=rowUrls.size<=1?container:a;
  const time=scoped.find('time[datetime]').first(),label=(time.attr('itemprop')??'')+' '+time.parent().text();
  const datetime=/updated|modified|available|availability/i.test(label)||source.id!=='craigslist'&&!/posted|listed|published/i.test(label)?undefined:time.attr('datetime');
  const card:DiscoveryCard={url,title:a.text().replace(/\s+/g,' ').trim().slice(0,500),rent:prices.length===1?prices[0]:null,beds:Number(text.match(/\b(\d+)\s*(?:bedrooms?|beds?|br)\b/i)?.[1])||null};
  if(source.id==='easyrent'||source.id==='sunstar')card.availability=unavailable?'unavailable':availabilityEvidence&&/^(?:available\s+now|now|immediately|January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(availabilityEvidence)?'available':'unknown';
  if(availabilityEvidence)card.availabilityEvidence=availabilityEvidence.slice(0,300);
  const city=text.match(/\b(North Vancouver|West Vancouver|New Westminster|Port Moody|Vancouver|Burnaby|Richmond|Coquitlam|Surrey|Calgary|Toronto|Ottawa|Edmonton|Victoria|Kelowna)\b/i)?.[0];if(city)card.city=city;
  const area=text.match(/\b(Coal Harbour|West End|Yaletown|Downtown(?: Vancouver)?|Kitsilano|Mount Pleasant|Olympic Village|Fairview)\b/i)?.[0];if(area)card.area=area;
  card.postedAt=parsePostingDate(datetime,now)??(source.id==='craigslist'?parsePostingDate(scoped.find('.result-posted-date').text(),now):undefined);
  const previous=found.get(url),availabilityCard=previous?.availabilityEvidence?previous:card;
  found.set(url,{...card,...previous,rent:previous?.rent??card.rent,city:previous?.city??card.city,area:previous?.area??card.area,postedAt:previous?.postedAt??card.postedAt,availability:availabilityCard.availability,availabilityEvidence:availabilityCard.availabilityEvidence});
 });
 if(source.id==='zumper')try{
  // Current unit cards are buttons, with their source URLs in embedded search data.
  // Parse only the current results list; never evaluate page scripts or recommendations.
  const rows=zumperState(html).currentSearch?.listables?.listables;
  if(Array.isArray(rows))for(const row of rows){
   if(typeof row?.url!=='string')continue;const url=listingUrl(row.url,source,base);if(!url)continue;
   const existing=found.get(url);
   found.set(url,{url,title:typeof row.title==='string'?row.title.slice(0,500):undefined,rent:Number.isFinite(row.min_price)&&row.min_price===row.max_price?row.min_price:null,beds:Number.isFinite(row.min_bedrooms)&&row.min_bedrooms===row.max_bedrooms?row.min_bedrooms:null,city:typeof row.city==='string'?row.city:undefined,area:typeof row.neighborhood_name==='string'?row.neighborhood_name:undefined,...existing,postedAt:parsePostingDate(row.listed_on,now)??existing?.postedAt});
  }
 }catch{/* Recognized visible links remain usable when embedded data is absent. */}
 for(const [url,date] of sourcePostingDates(html,source.id,[...found.keys()],now))found.get(url)!.postedAt=date;
 return [...found.values()];
}
export function discoverSource(html:string,source:Source,base=source.search){return discoveryCards(html,source,base).filter(card=>card.availability!=='unavailable').map(card=>card.url);}

/** An empty result area is evidence; unrelated marketing copy is not. */
export function discoveryEmpty(html:string,source:Source,url=source.search){
 const $=load(html);$('script,style,template,noscript,[hidden],[aria-hidden="true"]').remove();
 if(source.id==='vada'){
  const form=$('form#search-filters-for-rent-form'),results=$('.c-search-results__main');
  try{if(form.length&&new URL(form.attr('action')??'',url).pathname===new URL(url).pathname&&results.find('h3').text().trim()==='More Rentals Coming Soon'&&!results.find('a[href]').toArray().some(a=>listingUrl($(a).attr('href')!,source,url)))return true;}catch{}
 }
 const text=$('body').text().replace(/\s+/g,' ').trim();
 return text.split(/\s+/).length<80&&/\b(?:no (?:matching |available )?(?:rentals|listings|results|vacancies)|0 results|no properties found)\b/i.test(text);
}

/** EasyRent advertises clickable FacetWP pages without href attributes. */
export function facetPagination(html:string,source:Source){
 if(source.id!=='easyrent')return null;
 const $=load(html),pager=$('.facetwp-pager').first();
 if(!$('.facetwp-template').length||!pager.length)return null;
 const current=Number(pager.find('.facetwp-page.active').attr('data-page'));
 const pages=pager.find('.facetwp-page[data-page]').map((_,el)=>Number($(el).attr('data-page'))).get();
 if(!Number.isSafeInteger(current)||current<1||pages.some(n=>!Number.isSafeInteger(n)||n<1))return null;
 const last=Math.max(current,...pages),next=Number(pager.find('.facetwp-page.next').attr('data-page'));
 return {current,last,next:Number.isSafeInteger(next)&&next>current?next:null,exhausted:current===last&&!pager.find('.facetwp-page.next').length};
}
export function nextDiscovery(html:string,source:Source,base=source.search){const $=load(html);const next=$('a[rel="next"],a[aria-label="Next page"],a[title="Next page"],a.next');const href=next.first().attr('href')??$('a[href]').filter((_,e)=>/^next(?:\s+page)?\s*[›»→]?$/i.test($(e).text().trim())).first().attr('href');if(!href)return null;try{const u=new URL(href,base);return allowedUrl(u.href,source.hosts)&&u.href!==base&&!listingUrl(u.href,source)?u.href:null;}catch{return null;}}
/** Definite advertised failures only; absent/ranged prices and unknown places remain candidates. */
export function discoveryFailure(card:DiscoveryCard,maxRent:number|null){if(card.availability==='unavailable')return 'Search card explicitly marks this rental unavailable: '+(card.availabilityEvidence??'unavailable');if(maxRent!==null&&card.rent!=null&&card.rent>=maxRent)return 'Advertised rent reaches or exceeds the configured ceiling';if(card.city&&/^(Calgary|Toronto|Ottawa|Edmonton|Victoria|Kelowna)$/i.test(card.city))return 'Advertised city is outside the Vancouver search region';return null;}
export function prioritizeCards(cards:DiscoveryCard[],months:number|null=null,now=Date.now()){const area=(c:DiscoveryCard)=>/Coal Harbour|West End|Yaletown|Downtown/i.test(c.area??'')?0:/North Vancouver|West Vancouver|Burnaby|Richmond|Coquitlam|Port Moody|Surrey|New Westminster/i.test(c.city??'')?2:1;return [...cards].sort((a,b)=>postingAgeRank(a.postedAt,months,now)-postingAgeRank(b.postedAt,months,now)||area(a)-area(b)||(Date.parse(b.postedAt??'')||0)-(Date.parse(a.postedAt??'')||0));}
/** The inventory endpoint is advertised by Austeville's own vacancies page. */
export function inventoryEndpoint(html:string,source:Source){if(source.id!=='austeville')return null;const normalized=html.replaceAll('\\/','/').replaceAll('&amp;','&');const url=normalized.match(/https:\/\/www\.austeville\.com\/wp-json\/wp\/v2\/re_property\?[^"<>\s]+/)?.[0];return url&&allowedUrl(url,source.hosts)?url:null;}
export function inventoryUrls(json:string,source:Source){const rows=JSON.parse(json);if(!Array.isArray(rows))throw new Error('Inventory response was not recognized');return [...new Set(rows.filter(r=>r.status==='publish'&&Number(r.acf?.rent?.cost)>0&&r.acf?.available_at).map(r=>listingUrl(r.link,source)).filter((url):url is string=>!!url))];}
/** Source-provided current-page totals, scoped to this exact search URL. */
export function discoveryEnd(html:string,source:Source,url:string){
 if(source.id!=='kijiji')return null;
 try{const $=load(html),state=JSON.parse($('#__NEXT_DATA__').text()).props.pageProps.__APOLLO_STATE__.ROOT_QUERY,u=new URL(url),p=state['searchResultsPageByUrl:'+u.pathname+u.search]?.pagination;
  if(!p||![p.offset,p.limit,p.totalCount].every(n=>Number.isSafeInteger(n)&&n>=0)||p.limit<1)return null;
  return {total:p.totalCount,exhausted:p.offset+p.limit>=p.totalCount};
 }catch{return null;}
}
