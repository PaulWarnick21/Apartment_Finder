import {load} from 'cheerio';
import {listingSchema,type Listing} from '../src/domain.ts';
import {hash} from './db.ts';
import {allowedUrl, type Source} from './sources.ts';
// Deterministic extraction of captured live pages. Discovery for the newer sources
// stays disabled until its incremental behavior has also been validated.
export function extractTrial(html:string,url:string,source:Source,galleryXml?:string):Listing{
 const $=load(html),ld:any[]=[];
 $('script[type="application/ld+json"]').each((_,e)=>{try{const j=JSON.parse($(e).text());ld.push(...(Array.isArray(j)?j:j['@graph']??[j]));}catch{}});
 const residence=ld.find(j=>['Apartment','SingleFamilyResidence','Accommodation'].includes(j['@type']));
 let next:any;try{next=JSON.parse($('#__NEXT_DATA__').text());}catch{}
 const originalImages=$('img[src]').map((_,e)=>$(e).attr('src')!).get();
 $('script,style,nav,footer,form,noscript').remove();
 const page=$('body').text().replace(/\s+/g,' ').trim();
 let body=source.id==='craigslist'?$('#postingbody').text():source.id==='easyrent'?$('article .entry-content').text():page;
 body=(body||page).replace(/\s+/g,' ').trim();
 if(source.id==='kijiji')body=page.split('Home Insurance')[0];
 if(source.id==='hollyburn')body=page.split('Check availability')[0];
 if(source.id==='austeville')body=page.split('More vacancies')[0];
 if(source.id==='vada')body=page.split('Building Amenities')[0];
 let title=$('#titletextonly').text()||$('h1').first().text()||$('title').text();title=title.trim();
 const text=source.id==='craigslist'?`${title} ${$('.attrgroup').text()} ${body}`:body;
 const n=(v:unknown)=>{const x=Number(String(v??'').replace(/[^\d.]/g,''));return x>0?x:null;};
 const rent=n($('.c-property-price__amount').first().text())??n($('.price').first().text())??n(text.match(/(?:Monthly rent:|Price:|offered at:)\s*\$([\d,]+)/i)?.[1])??n(text.match(/\$([\d,]+)(?:\s*\/month|\/Month|\s*per month)/i)?.[1])??n(residence?.offers?.price);
 let address=typeof residence?.address==='string'?residence.address:residence?.address?.streetAddress??'';
 const unit=text.match(/(?:Unit\s*#?:?|Suite)\s*#?\s*(\d+[A-Za-z]?)(?=\s|[-,]|$)/i)?.[1]??text.match(/\b(\d{3,4})\s*[-–]\s*\d+\s+[A-Za-z]/)?.[1]??'';
 if(source.id==='vada')address=$('.c-property-title__after').text().trim()||address;
 if(source.id==='sunstar')address=text.match(/address:\s*([^]*?)\s+exclusively offered/i)?.[1]??'';
 let urls:string[]=[];
 if(source.id==='craigslist')urls=$('a[href]').map((_,e)=>$(e).attr('href')!).get().filter(s=>s.includes('images.craigslist.org/'));
 if(source.id==='vada')urls=$('.c-gallery').first().find('.c-carousel__slide img[src]').map((_,e)=>$(e).attr('src')!).get();
 if(source.id==='easyrent')urls=$('.er-listing-photos a[href]').map((_,e)=>$(e).attr('href')!).get();
 if(source.id==='kijiji')urls=[residence?.image??[]].flat().map((x:any)=>typeof x==='string'?x:x.contentUrl).filter(Boolean);
 if(source.id==='kijiji'){const entity:any=Object.entries(next?.props?.pageProps?.__APOLLO_STATE__??{}).find(([key])=>key.startsWith('RealEstateListing:'))?.[1];if(entity?.imageUrls)urls=entity.imageUrls;}
 if(source.id==='hollyburn')urls=originalImages.filter(s=>s.includes('/suite-images/'));
 if(source.id==='austeville')urls=$('img').filter((_,e)=>/attachment-large/.test($(e).parent().attr('class')??'')).map((_,e)=>$(e).attr('src')!).get();
 if(source.id==='sunstar'&&galleryXml){const xml=load(galleryXml,{xml:true});urls=xml('image').map((_,e)=>xml(e).attr('imageURL')!).get();}
 const photos=[...new Set(urls.map(s=>new URL(s,url).href))].filter(s=>allowedUrl(s,source.mediaHosts));
 const expected=n(page.match(/image\s+\d+\s+of\s+(\d+)/i)?.[1])??n(page.match(/(\d+)\s+Photos/i)?.[1])??(photos.length||null);
 const evidence:Record<string,string>={};
 function fact(key:string,re:RegExp){const m=text.match(re);if(!m)return null;evidence[key]=m[0];return true;}
 const laundry=fact('laundry',/w\/d in unit|Laundry\s*\(In Unit\)|in[- ]suite\s+(?:laundry|washer)|in[- ]unit laundry|Appliances:[^]*?Washer\/Dryer|Included items:[^.]*?washer,? dryer/i)?'in-unit':fact('laundry',/laundry in bldg|shared[- ]only laundry|coined laundry at \$\d+ per load/i)?'shared-only':'unknown';
 const parkingCount=n(text.match(/Parking:\s*(\d+)|(?:(\d+) Parking Included)/i)?.slice(1).find(Boolean));
 const parkingCost=n(text.match(/Parking:\s*\$([\d,]+)/i)?.[1]);
 const parkingIncluded=fact('parking',/parking included|includes[^.]{0,30}parking|parking:\s*(?:one|1)(?:\b)|one parking stall/i);
 const furnished=/\bunfurnished\b|FurnishedNo/i.test(text)?false:fact('furnished',/\bfurnished\b/i);
 const l=listingSchema.parse({source:source.id,sourceId:page.match(/post id:\s*(\d+)/)?.[1]??url.match(/\/(\d{8,})(?:\/)?$/)?.[1]??hash(url).slice(0,16),url,title,address,unit,rent,
 beds:n(residence?.numberOfBedrooms)??n(text.match(/(\d+)\s*(?:\+\s*Den\s*)?(?:BR\b|Bedrooms?\b)/i)?.[1])??(/\bone-bedroom\b/i.test(text)?1:null),baths:n(residence?.numberOfBathroomsTotal)??n(text.match(/(\d+(?:\.\d+)?)\s*(?:BA\b|Bathrooms?\b)/i)?.[1])??n(text.match(/Bathrooms:\s*(\d+)/i)?.[1]),sqft:n(residence?.floorSize?.value)??n(text.match(/([\d,]+)\s*(?:sq\.?\s*ft|sf\b|ft2)/i)?.[1]),description:body.slice(0,50000),laundry,parking:parkingCost?'extra':parkingIncluded||parkingCount?'included':'unknown',parkingCost,parkingCount,
 furnished,workspace:fact('workspace',/\bden\b|dedicated workspace|separate[^.]{0,20}home office/i),modern:fact('modern',/renovated kitchen|newly renovated|contemporary kitchen|brand-new, never|modern finishes|modern grey laminate/i),openPlan:fact('openPlan',/open concept|open floor plan|wide open planning|open kitchen/i),gas:fact('gas',/gas (?:stove|range|cooktop)/i),north:fact('north',/north[- ]facing|north and west facing/i),shortLease:fact('shortLease',/minimum 90 day|minimum three-month/i),lease:text.match(/Lease Term:\s*[^]*?(?:Minimum|lease)|(?:\d+|one)[ -](?:year|month) lease|minimum 90 day tenancy/i)?.[0]??'Unknown',internet:/internet[^.]{0,30}included|includes cable\/internet|Wi-fi & moreCable \/ TVInternet/i.test(text)?'Internet advertised as included; speed and reliability unverified':'Unknown',
 photos:photos.map((url,i)=>({id:`p${i+1}`,url})),expectedPhotos:expected,galleryComplete:expected!==null&&photos.length>=expected,evidence});
 if(/Images shown are display suites/i.test(body))l.conflicts.push('Display-suite photos: exact-unit views cannot be confirmed.');
 if(source.id==='vada'&&/Rental Listing Features[^]*Washer\s*\/\s*Dryer/i.test(text)){l.laundry='in-unit';l.evidence.laundry='Washer / Dryer under Rental Listing Features';}
 if(source.id==='vada'&&/\b1 Parking stall\b/.test(text)){l.parking='included';l.parkingCount=1;}
 if(/(?:no|without)\s+in[- ](?:suite|unit)\s+(?:laundry|washer)/i.test(text)){l.laundry='none';l.evidence.laundry=text.match(/(?:no|without)\s+in[- ](?:suite|unit)\s+(?:laundry|washer)/i)![0];}
 return l;
}
