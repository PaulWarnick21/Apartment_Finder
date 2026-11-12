import {load} from 'cheerio';
import {listingSchema,type Listing} from '../src/domain.ts';
import {hash} from './db.ts';
const clean=(s:string)=>s.replace(/\s+/g,' ').trim();
const num=(s:unknown)=>{const n=Number(String(s??'').replace(/,/g,''));return Number.isFinite(n)&&n>0?n:null;};
function features(l:Listing,text:string){
 const yes=(field:string,re:RegExp)=>{const m=text.match(re);if(m)l.evidence[field]=m[0];return m?true:null;};
 l.gas=yes('gas',/gas (?:range|stove|cooktop)/i);l.furnished=/\bunfurnished\b/i.test(text)?false:yes('furnished',/(?:fully|beautifully) furnished|Furnished: Yes/i);
 l.workspace=yes('workspace',/\bden\b|space for a home office|dedicated[^.]{0,20}office/i);
 l.modern=yes('modern',/renovated[^.]{0,80}(?:kitchen|bathroom)|modern (?:kitchen|finishes)|brand.new appliances/i);
 l.openPlan=yes('openPlan',/open[- ]concept|open (?:living space|floor plan|kitchen)/i);
 l.north=/south[- ]facing|southern views/i.test(text)?false:yes('north',/north[- ]facing/i);
 if(/shared laundry|in-building laundry|laundry facilities on the main floor/i.test(text))l.laundry='shared-only';
 else if(/in[- ]?(?:unit|suite) (?:laundry|washer)|Laundry:\s*In Unit|in[- ]suite[^.]{0,25}washer\/dryer/i.test(text))l.laundry='in-unit';
 const parking=text.match(/(?:parking[^.]{0,40}\$([\d,]+)\s*\/?month|parking:\s*\$([\d,]+))/i);
 if(parking){l.parking='extra';l.parkingCost=num(parking[1]??parking[2]);l.parkingCount=1;l.evidence.parking=parking[0];}
 else if(/parking (?:stall|spot|space).{0,30}included|includes? (?:1|one) parking|parking included/i.test(text)){l.parking='included';l.parkingCount=1;}
 else if(/parking available[^.]{0,30}(?:additional|fee)|parking[^.]{0,30}additional fee/i.test(text))l.parking='extra';
 const short=text.match(/Minimum\s+(\d+)[ -]month lease/i);if(short){l.shortLease=Number(short[1])<12;if(/1 Year|12 Month/i.test(l.lease)){l.conflicts.push(`Lease terms conflict: ${l.lease}; description says ${short[0]}.`);l.shortLease=null;}l.lease+='; '+short[0];}
 if(/Utilities included:\s*internet|internet (?:is )?included/i.test(text))l.internet='Internet included according to listing; speed and reliability unverified';
 const descSize=num(text.match(/([\d,]+)\s*(?:sq\.?\s*ft\.?|square feet)/i)?.[1]);if(l.source==='zillow'&&l.sqft&&descSize&&l.sqft!==descSize){l.conflicts.push(`Size differs: structured facts ${l.sqft} sq ft; description ${descSize} sq ft.`);l.sqft=null;}
 return l;
}
export function extractRemaining(source:'zillow'|'rew'|'facebook',html:string,url:string):Listing{
 const $=load(html);let l:Listing;
 if(source==='zillow'){
  const next=JSON.parse($('#__NEXT_DATA__').text()),cache=JSON.parse(next.props.pageProps.componentProps.gdpClientCache);const id=url.match(/\/(\d+)_zpid/)?.[1];
  const p=(Object.values(cache) as any[]).map(v=>v.property).find(p=>String(p?.zpid)===id);if(!p)throw new Error('Target Zillow property missing');
  const photos=(p.originalPhotos??[]).map((photo:any)=>[...(photo.mixedSources?.jpeg??[])].sort((a,b)=>b.width-a.width)[0]?.url).filter(Boolean);
  const unit=p.streetAddress?.match(/#([\w-]+)/)?.[1]??'';
  l=listingSchema.parse({source,sourceId:id,url,title:p.streetAddress,address:`${p.streetAddress.replace(/\s*#.*$/,'')}, ${p.city}, ${p.state}`,unit,rent:p.price,beds:p.bedrooms,baths:p.bathrooms,sqft:p.livingArea,description:p.description,area:p.neighborhoodRegion?.name??'Unknown',laundry:p.resoFacts?.laundryFeatures?.includes('In Unit')?'in-unit':'unknown',lease:p.resoFacts?.leaseTerm??'Unknown',photos:photos.map((url:string)=>({id:hash(url).slice(0,16),url})),expectedPhotos:p.responsivePhotos?.length??photos.length,galleryComplete:photos.length>0&&photos.length===(p.responsivePhotos?.length??photos.length),evidence:{gallery:'All photos in this property’s structured originalPhotos gallery.'}});
  if(/Downtown|West End|Yaletown|Coal Harbour/i.test(l.area))l.location='downtown';
  return features(l,l.description+' '+(p.resoFacts?.furnished?'Furnished: Yes':''));
 }
 if(source==='facebook'){
  const id=url.match(/item\/(\d+)/)?.[1],parts:any[]=[];
  const walk=(o:any)=>{if(!o||typeof o!=='object')return;if(o.id===id&&(o.listing_photos||o.redacted_description))parts.push(o);for(const v of Object.values(o))if(typeof v==='object')walk(v);};
  $('script[type="application/json"]').each((_,e)=>{try{walk(JSON.parse($(e).text()));}catch{}});
  const p=Object.assign({},...parts);if(!p.redacted_description)throw new Error('Target Facebook listing data missing');
  const fields=(p.pdp_display_sections??[]).flatMap((s:any)=>s.pdp_fields??[]).map((f:any)=>f.display_label).join(' '),description=p.redacted_description.text;
  const text=fields+' '+description,photos=(p.listing_photos??[]).map((p:any)=>p.image?.uri).filter(Boolean);
  const rawAddress=p.home_address?.street??'',address=rawAddress||'';
  l=listingSchema.parse({source,sourceId:id,url:url.split('?')[0],title:p.marketplace_listing_title,address,unit:'',rent:num(p.listing_price?.amount),beds:num(text.match(/(\d+)\s*(?:bed|bedroom)/i)?.[1]),baths:num(text.match(/(\d+(?:\.\d+)?)\s*(?:bath|bathroom)/i)?.[1]),sqft:num(text.match(/([\d,]+)\s*sq\.?\s*ft/i)?.[1]),description,photos:[...new Set(photos)].map(url=>({id:hash(String(url)).slice(0,16),url})),expectedPhotos:photos.length,galleryComplete:photos.length>0,evidence:{gallery:'Photo array attached to the matching Facebook listing ID; unrelated recommendations and account data excluded.'}});
  if(!address)l.conflicts.push('Exact street address/unit not supplied; confirm with the advertiser.');
  if(/Mount Pleasant/i.test(description)){l.area='Mount Pleasant';l.location='outside';}else if(/\(Downtown\)|Downtown Vancouver/i.test(l.title+' '+description)){l.area='Downtown Vancouver';l.location='downtown';}
  return features(l,text);
 }
 const ld:any[]=[];$('script[type="application/ld+json"]').each((_,e)=>{try{ld.push(JSON.parse($(e).text()));}catch{}});const p=ld.find(d=>d['@type']==='SingleFamilyResidence');if(!p)throw new Error('REW property facts missing');
 const description=clean($('.propertydetails-description').text());const text=clean($('body').text());
 const gallery=$('#photo-gallery-modal img').map((_,e)=>$(e).attr('data-src')||$(e).attr('src')).get().filter(Boolean);
 const photos=[...new Set(gallery)];const unit=description.match(/Suite\s*#\s*(\d+)/i)?.[1]??p.address.streetAddress.match(/^(\d+)\s*-\s*\d+/)?.[1]??'';
 l=listingSchema.parse({source,sourceId:url.match(/rentals\/(\d+)/)?.[1],url,title:p.name,address:p.address.streetAddress.replace(/^\d+\s*-\s*(?=\d)/,''),unit,area:p.address.addressLocality??'Unknown',rent:num(text.match(/\$([\d,]+)\/month/)?.[1]),beds:num(text.match(/(\d+) Bed/)?.[1]),baths:num(text.match(/(\d+(?:\.\d+)?) Bath/)?.[1]),sqft:num(text.match(/([\d,]+) Sqft/)?.[1]),description,photos:photos.map(url=>({id:hash(url).slice(0,16),url})),expectedPhotos:photos.length,galleryComplete:photos.length>0,lease:description.match(/\d+ year lease/i)?.[0]??'Unknown'});
 if(/West End|Downtown|Yaletown|Coal Harbour/i.test(l.area))l.location='downtown';
 return features(l,description+' '+(text.split('Home facts and features')[1]?.split('Schools nearby')[0]??''));
}
