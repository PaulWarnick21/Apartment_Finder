import {load} from 'cheerio';
import type {Listing} from '../src/domain.ts';
import type {AvailabilityObservation} from '../src/availability.ts';
import type {Source} from './sources.ts';
import {extractSourceOfferings} from './regular-worker.ts';
import {listingUnavailable} from './listing-availability.ts';

type Finding=Pick<AvailabilityObservation,'status'|'evidence'>;
/** Only listing-scoped notices count. Navigation, related ads and free-form descriptions do not. */
export function inspectAvailability(html:string|null,source:Source,saved:Listing):Finding{
 if(!html)return {status:'unknown',evidence:'Listing page returned no content (including 404/410); availability is unverified.'};
 const $=load(html);
 const visible=$('body').clone();visible.find('script,style,nav,footer,aside,form').remove();
 if(/verify (?:you are|you're) human|access denied|unusual traffic|temporarily unavailable|log in to continue/i.test(visible.text()))return {status:'unknown',evidence:'Access or temporary error page; availability is unverified.'};
 // Structured status must belong to the exact saved ad, never a recommended property.
 if(source.id==='zillow')try{
  const next=JSON.parse($('#__NEXT_DATA__').text()),cache=JSON.parse(next.props.pageProps.componentProps.gdpClientCache);
  const property=(Object.values(cache) as any[]).map(v=>v.property).find(p=>String(p?.zpid)===saved.sourceId);
  if(property&&['OFF_MARKET','RECENTLY_SOLD','FOR_SALE','SOLD'].includes(property.homeStatus))return {status:'unavailable',evidence:`Saved Zillow property is ${property.homeStatus}; it is no longer advertised for rent.`};
 }catch{/* Malformed data is not closure evidence. */}
 if(source.id==='facebook'){
  let closed=false,pending=false;
  const walk=(value:any,depth=0)=>{if(!value||typeof value!=='object'||depth>80)return;if(String(value.id)===saved.sourceId){if(value.is_sold===true||value.is_pending===false&&value.is_live===false)closed=true;if(value.is_pending===true)pending=true;}for(const child of Object.values(value))walk(child,depth+1);};
  $('script[type="application/json"]').each((_,element)=>{try{walk(JSON.parse($(element).text()));}catch{}});
  if(closed)return {status:'unavailable',evidence:'The matching Facebook listing is marked sold or no longer live.'};
  if(pending)return {status:'unknown',evidence:'The matching Facebook listing is marked pending; availability needs confirmation.'};
 }
 $('script,style,nav,footer,aside,form').remove();
 const notices=source.id==='craigslist'?$('.removed,#removed,.postingremoved').toArray():[];
 // Explicit page-level closure notices are valid even after the original facts disappear.
 for(const element of [...notices,...$('h1').toArray()]){
  const text=$(element).text().replace(/\s+/g,' ').trim();
  if(/^(?:(?:sorry[,!]?\s*)?(?:this |the )?(?:posting|listing|rental|apartment|property|ad) (?:has been |is |was )?(?:removed|deleted|expired|rented|leased|no longer available|no longer for rent)|(?:rented|leased|no longer available))[.!\s]*$/i.test(text)||source.id==='craigslist'&&/^This posting has been (?:deleted by its author|expired|flagged for removal)[.!\s]*$/i.test(text))return {status:'unavailable',evidence:text.slice(0,300)};
 }
 try{
  const listing=extractSourceOfferings(source,html,saved.url).find(l=>l.sourceId===saved.sourceId);
  if(!listing)return {status:'unknown',evidence:'The saved unit was not found in this page; missing inventory is not proof of closure.'};
  if(saved.unit&&listing.unit&&saved.unit.toLowerCase()!==listing.unit.toLowerCase())return {status:'unknown',evidence:'The page now describes a different unit.'};
  const address=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'');
  if(saved.address&&listing.address&&address(saved.address)!==address(listing.address))return {status:'unknown',evidence:'The page address changed; the saved apartment identity needs verification.'};
  if(/^(?:rented|leased|unavailable|off[- ]market)\b/i.test(listing.title.trim()))return {status:'unavailable',evidence:listing.title.slice(0,300)};
  if(listingUnavailable(listing))return {status:'unavailable',evidence:listing.evidence.availability??listing.available};
  if(listing.offeringKind!=='unit'||!listing.rent||listing.beds===null||listing.description.length<40)return {status:'unknown',evidence:'The page does not establish a current advertisement for the saved unit.'};
  return {status:'available',evidence:'The same rental listing is still advertised with unit details and rent; landlord confirmation is not implied.'};
 }catch{return {status:'unknown',evidence:'Listing layout could not be verified; no availability conclusion was drawn.'};}
}
