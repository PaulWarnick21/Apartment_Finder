import {load} from 'cheerio';
import {listingSchema,type Listing} from '../src/domain.ts';
import {allowedUrl,sourceById} from './sources.ts';
import {extractTrial} from './trial-extraction.ts';

/** Building pages expose real vacancy rows separately from recommendation cards.
 * Only a row with one booking vacancy ID and one associated popup becomes an offer.
 * No booking URL is requested, and representative galleries never verify the unit. */
export function extractHollyburnOfferings(html:string,url:string):Listing[]{
 const source=sourceById('hollyburn');
 if(!/^\/building\/[^/]+\/$/.test(new URL(url).pathname))return [extractTrial(html,url,source)];
 const $=load(html),offers=new Map<string,Listing>();
 const title=$('h1.entry-title').first().text().trim()||$('h1').first().text().trim();
 const address=$('h1.entry-title').first().siblings('.sub').first().text().trim();
 for(const el of $('.card.suite').toArray()){
  const card=$(el);if(card.is('a')||card.hasClass('suite--borderless'))continue;
  const refs=[...new Set(card.find('a[href^="#suite-popup-"]').map((_,a)=>$(a).attr('href')!).get())];
  const ids=[...new Set(card.find('a[href]').map((_,a)=>{try{const u=new URL($(a).attr('href')!,url);return u.protocol==='https:'&&u.hostname==='booking.hollyburn.com'&&/^\d+$/.test(u.searchParams.get('vacancy_id')??'')?u.searchParams.get('vacancy_id'):null;}catch{return null;}}).get().filter(Boolean))];
  if(refs.length!==1||ids.length!==1||!/^#suite-popup-\d+$/.test(refs[0]))continue;
  const popup=$(refs[0]);if(popup.length!==1)continue;
  const id=ids[0]!,cardText=card.find('.suite__title').text().trim(),popupText=popup.find('.suite-popup__content h2').first().text().trim();
  const bed=(text:string)=>/\bstudio\b/i.test(text)?0:Number(text.match(/\b(\d+)\s*Bed(?:room)?/i)?.[1]??NaN);
  const beds=[...new Set([bed(cardText),bed(popupText)].filter(Number.isFinite))];
  const amounts=[...new Set([card.find('.suite__price').text(),popup.find('.suite-popup__price').text()].map(text=>Number(text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/)?.[1].replaceAll(',','')??NaN)).filter(n=>Number.isFinite(n)&&n>0))];
  const available=card.find('.suite__availability').text().trim()||popup.find('.suite-popup__availability').text().trim()||'Unknown';
  const gallery=popup.find('.popup-suite-slider');
  const images=[...new Set(gallery.find('img').map((_,img)=>$(img).attr('data-lazy')||$(img).attr('data-src')||$(img).attr('src')||'').get().flatMap(raw=>{try{const image=new URL(raw,url).href;return raw&&allowedUrl(image,source.mediaHosts)?[image]:[];}catch{return [];}}))];
  const slots=gallery.find('.slick-slide:not(.slick-cloned) img').length||gallery.find('.slider__slide img').length||gallery.find('img').length;
  const expected=Math.max(slots,images.length),complete=expected>0&&images.length>=expected;
  const disclaimer=popup.find('.popup-suite-slider-disclaimer').text().replace(/\s+/g,' ').trim();
  const conflicts=['Advertised vacancy with a source vacancy ID; physical suite number is not published. Confirm the exact suite before applying.','Building vacancy photos are representative; exact-unit photo provenance is unverified.'];
  if(amounts.length>1)conflicts.push('Monthly rent conflicts between the vacancy card and its detail popup.');
  if(beds.length>1)conflicts.push('Bedroom count conflicts between the vacancy card and its detail popup.');
  const description=[cardText,available,popup.find('.suite-popup__content').text().replace(/\s+/g,' ').trim(),disclaimer,'Representative vacancy gallery; exact-unit provenance unverified.'].filter(Boolean).join('\n');
  const listing=listingSchema.parse({source:'hollyburn',sourceId:`vacancy:${id}`,offeringId:id,offeringKind:'unit',parentListingUrl:url,url,title:`${title} · ${cardText||popupText} vacancy`,address,unit:'',area:'Unknown',rent:amounts.length===1?amounts[0]:null,beds:beds.length===1?beds[0]:null,available,description:description.slice(0,50000),photos:images.map((image,i)=>({id:`p${i+1}`,url:image,note:'Representative building vacancy photo; exact-unit provenance unverified'})),expectedPhotos:expected||null,galleryComplete:complete,conflicts,evidence:{photoProvenance:'Representative display-suite gallery; exact unit is unverified',vacancyId:id,vacancySource:'Advertised Book Viewing vacancy_id in the associated vacancy card; booking link was not visited',gallery:`Gallery associated only with ${refs[0]}; ${images.length} distinct advertised images for ${expected} image slots. ${disclaimer||'Exact-unit provenance unverified.'}`,rent:amounts.map(n=>`$${n}`).join(' / '),availability:available}});
  const prior=offers.get(id);if(prior&&JSON.stringify(prior)!==JSON.stringify(listing))throw Error('Hollyburn vacancy ID has conflicting cards; extraction needs review');
  offers.set(id,listing);
 }
 return offers.size?[...offers.values()]:[extractTrial(html,url,source)];
}
