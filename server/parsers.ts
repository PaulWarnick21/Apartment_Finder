import {load} from 'cheerio';
import {listingSchema,type Listing} from '../src/domain.ts';
import {hash} from './db.ts';
import type {Source} from './sources.ts';
import {allowedUrl} from './sources.ts';
import {extractTrial} from './trial-extraction.ts';
const number=(value:string|undefined)=>{const n=Number(value?.replace(/[^\d.]/g,''));return n>0?n:null;};
export function discover(html:string,source:Source){const $=load(html);const found:string[]=[];$('a[href]').each((_,a)=>{try{const u=new URL($(a).attr('href')!,source.search);u.hash='';const eligible=source.adapter==='craigslist'?/\/\d+\.html$|\/view\/d\//.test(u.pathname):/bedroom.*rental|rental.*bedroom/i.test(u.pathname);if(eligible&&allowedUrl(u.href,source.hosts))found.push(u.href);}catch{}});return [...new Set(found)];}
export function parseListing(html:string,url:string,source:Source):Listing {
 if(source.id==='vada')return extractTrial(html,url,source);
 const $=load(html);$('script:not([type="application/ld+json"]),style,nav,footer,form').remove();
 const title=source.adapter==='craigslist'?$('#titletextonly').text().trim()||$('h1').first().text().trim():$('h1').first().text().trim();
 const body=source.adapter==='craigslist'?$('#postingbody').text().replace('QR Code Link to This Post','').trim():$('main').text().trim()||$('body').text().trim();
 const text=`${title}\n${$('.attrgroup').text()}\n${body}`.replace(/[ \t]+/g,' ');
 if(!title||body.length<40)throw new Error('Listing layout not recognized; no facts were inferred');
 const address=source.adapter==='craigslist'?$('.mapaddress').text().trim():$('meta[property="og:street-address"]').attr('content')||text.match(/\d+\s*[-–]\s*\d+[^\n]{5,80}/)?.[0]||'';
 const rent=number($('.price').first().text())??number(text.match(/\$\s*([\d,]+)\s*(?:\/\s*(?:Month|mo)|monthly|per month)/i)?.[1]);
 const bedsMatch=text.match(/(\d+)\s*(?:BR\b|bedrooms?\b|beds?\b)/i);
 const unit=text.match(/(?:suite|unit)\s*#?\s*(\d+[A-Za-z]?)(?=\s|[,.-]|$)/i)?.[1]??text.match(/\b(\d{3,4})\s*[-–]\s*\d+\s+[A-Za-z]/)?.[1]??'';
 const deniedLaundry=/(?:no|without)\s+in[- ](?:suite|unit)\s+(?:washer|laundry)/i.test(text);
 const hookups=/(?:washer|dryer|laundry)[^.\n]{0,25}hook[- ]?ups?\s*(?:only)?/i.test(text);
 const inUnit=!deniedLaundry&&!hookups&&/(?:in[- ](?:suite|unit)\s+(?:washer|laundry)|private\s+in[- ]suite\s+laundry|w\/d in unit|washer\s*\/\s*dryer\s+in\s+(?:the\s+)?(?:unit|suite))/i.test(text);
 const shared=/(?:shared\s+(?:laundry|washer)|laundry\s+in\s+(?:the\s+)?(?:building|bldg)|laundry\s+room\s+(?:on|in))/i.test(text);
 const urls:string[]=[];
 if(source.adapter==='craigslist')$('a[href]').each((_,a)=>{const href=$(a).attr('href')!;if(allowedUrl(href,source.mediaHosts))urls.push(href);});
 else $('a[href],img[src]').each((_,a)=>{const s=$(a).attr('href')||$(a).attr('src')||'';if(/\/rentals\/.*\.(?:jpg|png|webp)/i.test(s))urls.push(new URL(s,url).href);});
 if(!urls.length&&source.adapter==='craigslist')$('img[src]').each((_,a)=>{const s=$(a).attr('src')!;if(s.includes('images.craigslist.org/'))urls.push(s);});
 const photoUrls=[...new Set(urls)].filter(u=>allowedUrl(u,source.mediaHosts));
 const pageText=$('body').text();
 const expected=number(pageText.match(/image\s+\d+\s+of\s+(\d+)/i)?.[1])??number(pageText.match(/(\d+)\s+Photos/i)?.[1]);
 const evidence:Record<string,string>={};
 function matched(key:string,re:RegExp){const m=text.match(re);if(!m)return false;const before=text.slice(Math.max(0,(m.index??0)-20),m.index);if(/(?:no|not|without)\s*$/i.test(before))return false;evidence[key]=m[0];return true;}
 const gas=matched('gas',/gas\s+(?:stove|cooktop|range)/i)?true:null;
 const north=matched('north',/north[- ]facing\s+(?:unit|apartment|view|suite)/i)?true:null;
 const furnished=/\bunfurnished\b/i.test(text)?false:matched('furnished',/fully furnished|furnished apartment/i)?true:null;
 if(inUnit)evidence.laundry=text.match(/.{0,35}(?:in[- ](?:suite|unit).{0,35}(?:laundry|washer)|washer\s*\/\s*dryer).{0,50}/i)?.[0]??'Unit laundry stated';
 else if(shared)evidence.laundry=text.match(/.{0,20}(?:shared laundry|laundry in (?:the )?(?:building|bldg)).{0,80}/i)?.[0]??'Shared laundry stated';
 const parkingIncluded=/(?:parking\s+(?:stall\s+)?included|includes?\s+(?:one\s+)?parking|one parking stall and)/i.test(text);
 const parkingFee=number(text.match(/parking[^.\n]{0,55}\$\s*([\d,]+)/i)?.[1]);
 const conflicts:string[]=[];if(inUnit&&shared)conflicts.push('Both shared and in-unit laundry mentioned; confirm unit-specific facilities');
 return listingSchema.parse({source:source.id,sourceId:url.match(/\/(\d+)\.html/)?.[1]??hash(url).slice(0,16),url,title,address,unit,rent,beds:bedsMatch?Number(bedsMatch[1]):/studio/i.test(title)?0:null,baths:number(text.match(/(\d+(?:\.\d+)?)\s*(?:BA\b|bath)/i)?.[1]),sqft:number(text.match(/([\d,]+)\s*(?:sq\.?\s*ft|sf\b|ft2)/i)?.[1]),description:body.slice(0,50000),laundry:deniedLaundry?'none':hookups?'hookups':inUnit&&!shared?'in-unit':shared&&!inUnit?'shared-only':'unknown',parking:parkingFee?'extra':parkingIncluded?'included':'unknown',parkingCost:parkingFee,gas,north,furnished,lease:text.match(/(?:minimum\s+)?(?:\d+|one)\s*[- ]?(?:month|year)[^.\n]{0,50}(?:lease|tenancy)|(?:lease term:)[^\n]{0,60}/i)?.[0]??'Unknown',available:text.match(/available\s+[^.\n]{1,60}/i)?.[0]??'Unknown',photos:photoUrls.map((url,i)=>({id:`p${i+1}`,url})),galleryComplete:expected!==null&&photoUrls.length>=expected,expectedPhotos:expected,evidence,conflicts});
}
