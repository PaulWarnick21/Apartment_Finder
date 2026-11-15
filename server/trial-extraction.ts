import {load} from 'cheerio';
import {extractFurnishing} from '../src/furnishing.ts';
import {largestImage,craigslistGallery} from './photo-resolution.ts';
import {listingSchema,type Listing} from '../src/domain.ts';
import {hash} from './db.ts';
import {allowedUrl, type Source} from './sources.ts';
import {workspaceTextEvidence} from './workspace-evidence.ts';
// Deterministic extraction shared by saved-page validation and the approved regular runner.
export function extractTrial(html:string,url:string,source:Source,galleryXml?:string):Listing{
 const $=load(html),ld:any[]=[];
 $('script[type="application/ld+json"]').each((_,e)=>{try{const j=JSON.parse($(e).text());ld.push(...(Array.isArray(j)?j:j['@graph']??[j]));}catch{}});
 const residence=ld.find(j=>['Apartment','SingleFamilyResidence','Accommodation'].includes(j['@type']));
 let next:any;try{next=JSON.parse($('#__NEXT_DATA__').text());}catch{}
 $('script,style,nav,footer,form,noscript').remove();
 const page=$('body').text().replace(/\s+/g,' ').trim();
 let body=source.id==='craigslist'?$('#postingbody').text():source.id==='easyrent'?$('article .entry-content').text():page;
 body=(body||page).replace(/\s+/g,' ').trim();
 if(source.id==='easyrent'&&$('article .entry-content').length){const content=$('article .entry-content').clone();content.find('p,ul,h3').append('\n');body=content.text().replace(/[ \t\r]+/g,' ').replace(/\n\s*/g,'\n').trim();}
 if(source.id==='kijiji')body=page.split('Home Insurance')[0];
 if(source.id==='hollyburn')body=page.split('Check availability')[0].split('Frequently Asked Questions')[0];
 if(source.id==='austeville')body=page.split('More vacancies')[0];
 if(source.id==='vada')body=page.split('Building Amenities')[0];
 if(source.id==='sunstar')body=body.split(/For viewing appointments|Go back to Downtown rental properties|IMPORTANT NOTES:/i)[0].trim();
 let title=$('#titletextonly').text()||$('h1').first().text()||$('title').text();title=title.trim();
 const hollyburnCards=source.id==='hollyburn'?$('.suite--furnished .card__content').filter((_,e)=>/About this rental/i.test($(e).find('.suite__title').text())):null;
 const hollyburnUnitFacts=hollyburnCards?.length===1?hollyburnCards.text().replace(/\s+/g,' ').trim():null;
 if(hollyburnUnitFacts){body=`${title}. ${hollyburnUnitFacts}`;if(/Images shown are display suites/i.test(page))body+=' Images shown are display suites and may not accurately represent this specific listing.';}
 const text=source.id==='craigslist'?`${title} ${$('.attrgroup').text()} ${body}`:body;
 const n=(v:unknown)=>{const x=Number(String(v??'').replace(/[^\d.]/g,''));return x>0?x:null;};
 const kijijiHeaderRent=source.id==='kijiji'?n($('[data-testid="vip-price"]').first().text())??n($('.price').first().text()):null;
 const rent=source.id==='kijiji'?kijijiHeaderRent??n(residence?.offers?.price):n($('.c-property-price__amount').first().text())??n($('.price').first().text())??n(text.match(/(?:Monthly rent:|Price:|offered at:)\s*\$([\d,]+)/i)?.[1])??n(text.match(/\$([\d,]+)(?:\s*\/month|\/Month|\s*per month)/i)?.[1])??n(residence?.offers?.price);
 let address=typeof residence?.address==='string'?residence.address:residence?.address?.streetAddress??'';
 const unit=text.match(/(?:Unit\s*#?:?|Suite)\s*#?\s*(\d+[A-Za-z]?)(?=\s|[-,]|$)/i)?.[1]??text.match(/\b(\d{3,4})\s*[-–]\s*\d+\s+[A-Za-z]/)?.[1]??'';
 if(source.id==='vada')address=$('.c-property-title__after').text().trim()||address;
 if(source.id==='sunstar')address=text.match(/address:\s*([^]*?)\s+exclusively offered/i)?.[1]??'';
 let urls:string[]=[],hollyburnGallery:{expected:number|null;complete:boolean;evidence:string}|null=null;
 if(source.id==='craigslist'){urls=craigslistGallery(html);if(!urls.length)urls=$('a[href]').map((_,e)=>$(e).attr('href')!).get().filter(s=>s.includes('images.craigslist.org/'));}
 if(source.id==='vada')urls=$('.c-gallery').first().find('.c-carousel__slide img[src]').map((_,e)=>largestImage($,e,url,source.mediaHosts)).get();
 if(source.id==='easyrent')urls=$('.er-listing-photos a[href]').map((_,e)=>$(e).attr('href')!).get();
 if(source.id==='kijiji')urls=[residence?.image??[]].flat().map((x:any)=>typeof x==='string'?x:x.contentUrl).filter(Boolean);
 if(source.id==='kijiji'){const entity:any=Object.entries(next?.props?.pageProps?.__APOLLO_STATE__??{}).find(([key])=>key.startsWith('RealEstateListing:'))?.[1];if(entity?.imageUrls)urls=entity.imageUrls;}
 if(source.id==='hollyburn'){
  // Only the advertised rental's masthead can select its popup. Other page galleries
  // and Slick's cloned slides are not this unit's enumerated source gallery.
  const sliders=$('#page-masthead .single-rental__slider'),anchors=sliders.find('a.js-slider-popup-toggle').filter((_,e)=>!$(e).closest('.slick-cloned').length);
  const refs=[...new Set(anchors.map((_,e)=>$(e).attr('href')??'').get())];
  hollyburnGallery={expected:null,complete:false,evidence:'Target rental gallery association is missing or ambiguous; no page-wide image fallback was used.'};
  if(sliders.length===1&&anchors.length&&refs.length===1&&/^#[A-Za-z][\w-]*$/.test(refs[0])){
   const popup=$(refs[0]);
   if(popup.length===1){
    const popupUrls=[...new Set(popup.find('.popup-slider__slide img[src]').filter((_,e)=>!$(e).closest('.slick-cloned').length).map((_,e)=>largestImage($,e,url,source.mediaHosts)).get().filter(s=>s.includes('/suite-images/')))];
    const mainImages=anchors.map((_,e)=>{const background=($(e).attr('style')??'').match(/background-image:\s*url\(["']?([^"')]+)["']?\)/i)?.[1];const image=$(e).find('img[src]').first();const found=background??(image.length?largestImage($,image[0],url,source.mediaHosts):null);if(!found)return '';try{const absolute=new URL(found,url).href;return allowedUrl(absolute,source.mediaHosts)?absolute:'';}catch{return '';}}).get();
    const mainUrls=[...new Set(mainImages.filter(Boolean))];
    const same=mainImages.every(Boolean)&&mainUrls.length>0&&mainUrls.length===popupUrls.length&&mainUrls.every(s=>popupUrls.includes(s));
    urls=popupUrls.filter(s=>mainUrls.includes(s));hollyburnGallery={expected:Math.max(mainUrls.length,popupUrls.length)||null,complete:same,evidence:`Rental masthead references ${refs[0]}; ${mainUrls.length} distinct masthead images and ${popupUrls.length} popup images${same?' match exactly':`; only ${urls.length} images have matching membership; gallery enumeration remains incomplete`}. ${/Images shown are display suites/i.test(page)?'Source display-suite photos do not verify the actual unit.':'Gallery association alone does not verify exact-unit provenance.'}`};
   }
  }
 }
 if(source.id==='austeville')urls=$('img').filter((_,e)=>/attachment-large/.test($(e).parent().attr('class')??'')).map((_,e)=>largestImage($,e,url,source.mediaHosts)).get();
 if(source.id==='sunstar'&&galleryXml){const xml=load(galleryXml,{xml:true});urls=xml('image').map((_,e)=>xml(e).attr('imageURL')!).get();}
 const photos=[...new Set(urls.map(s=>new URL(s,url).href))].filter(s=>allowedUrl(s,source.mediaHosts));
 const expected=hollyburnGallery?hollyburnGallery.expected:n(page.match(/image\s+\d+\s+of\s+(\d+)/i)?.[1])??n(page.match(/(\d+)\s+Photos/i)?.[1])??(photos.length||null);
 const evidence:Record<string,string>={};
 if(hollyburnGallery)evidence.gallery=hollyburnGallery.evidence;
 function fact(key:string,re:RegExp){const m=text.match(re);if(!m)return null;evidence[key]=m[0];return true;}
 const laundry=fact('laundry',/w\/d in unit|Laundry\s*\(In Unit\)|in[- ]suite\s+(?:laundry|washer)|in[- ]unit laundry|Appliances:[^]*?Washer\/Dryer|Included items:[^.]*?washer,? dryer/i)?'in-unit':fact('laundry',/laundry in bldg|shared[- ]only laundry|coined laundry at \$\d+ per load/i)?'shared-only':'unknown';
 const parkingCount=n(text.match(/Parking:\s*(\d+)|(?:(\d+) Parking Included)/i)?.slice(1).find(Boolean));
 const parkingCost=n(text.match(/Parking:\s*\$([\d,]+)/i)?.[1]);
 const parkingIncluded=fact('parking',/parking included|includes[^.]{0,30}parking|parking:\s*(?:one|1)(?:\b)|one parking stall/i);
 const furnishing=extractFurnishing(title+' '+text),furnished=furnishing.value;if(furnishing.statement)evidence.furnishingStatement=furnishing.statement;
 const workspace=workspaceTextEvidence(source.id==='kijiji'&&typeof residence?.description==='string'?residence.description:text);if(workspace.evidence)evidence.workspace=workspace.evidence;
 const l=listingSchema.parse({source:source.id,sourceId:page.match(/post id:\s*(\d+)/)?.[1]??url.match(/\/(\d{8,})(?:\/)?$/)?.[1]??hash(url).slice(0,16),url,title,address,unit,rent,
 beds:n(residence?.numberOfBedrooms)??n(text.match(/(\d+)\s*(?:\+\s*Den\s*)?(?:BR\b|Bedrooms?\b)/i)?.[1])??(/\bone-bedroom\b/i.test(text)?1:null),baths:n(residence?.numberOfBathroomsTotal)??n(text.match(/(\d+(?:\.\d+)?)\s*(?:BA\b|Bathrooms?\b)/i)?.[1])??n(text.match(/Bathrooms:\s*(\d+)/i)?.[1]),sqft:n(residence?.floorSize?.value)??n(text.match(/([\d,]+)\s*(?:sq\.?\s*ft|sf\b|ft2)/i)?.[1]),description:body.slice(0,50000),laundry,parking:parkingCost?'extra':parkingIncluded||parkingCount?'included':'unknown',parkingCost,parkingCount,
 furnished,workspace:workspace.workspace,modern:fact('modern',/renovated kitchen|newly renovated|contemporary kitchen|brand-new, never|modern finishes|modern grey laminate/i),openPlan:fact('openPlan',/open concept|open floor plan|wide open planning|open kitchen/i),gas:fact('gas',/gas (?:stove|range|cooktop)/i),north:fact('north',/north[- ]facing|north and west facing/i),shortLease:fact('shortLease',/minimum 90 day|minimum three-month/i),lease:text.match(/Lease Term:\s*[^]*?(?:Minimum|lease)|(?:\d+|one)[ -](?:year|month) lease|minimum 90 day tenancy/i)?.[0]??'Unknown',internet:/internet[^.]{0,30}included|includes cable\/internet|Wi-fi & moreCable \/ TVInternet/i.test(text)?'Internet advertised as included; speed and reliability unverified':'Unknown',
 photos:photos.map((url,i)=>({id:`p${i+1}`,url})),expectedPhotos:expected,galleryComplete:hollyburnGallery?hollyburnGallery.complete&&expected!==null&&photos.length===expected:expected!==null&&photos.length>=expected,evidence});
 if(/Images shown are display suites/i.test(body))l.conflicts.push('Display-suite photos: exact-unit views cannot be confirmed.');
 if(hollyburnUnitFacts){
  l.evidence.unitFacts='Facts scoped to the About this rental card; building marketing and general FAQ excluded.';
  if(/\bstudio\b/i.test(hollyburnUnitFacts)){l.beds=0;l.evidence.bedrooms='Studio explicitly advertised in About this rental.';}
  // The furnished-unit card states "minimum of three months of tenancy". Keep
  // this supported term while checking contradictory requirements in that same card.
   l.shortLease=null;delete l.evidence.shortLease;
   const duration='(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d{1,3})[ -]+(months?|years?|days?)';
  const words=['one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
  const terms=[new RegExp('\\bminimum(?:\\s+of)?\\s+'+duration+'(?:\\s+of)?(?:\\s+(?:tenancy|lease))?','gi'),new RegExp('\\b'+duration+'(?:\\s+minimum)?\\s+(?:lease|tenancy)\\b','gi'),new RegExp('\\b(?:lease|tenancy)(?:\\s+term)?\\s*[:=-]\\s*'+duration,'gi')]
   .flatMap(pattern=>[...hollyburnUnitFacts.matchAll(pattern)]).filter(m=>{
    const before=hollyburnUnitFacts.slice(Math.max(0,m.index!-50),m.index),after=hollyburnUnitFacts.slice(m.index!+m[0].length,m.index!+m[0].length+45);
    return !/\b(?:no|not|without|optional|longer)\b[^.!?]{0,40}$/i.test(before)&&!/^\s+(?:(?:is|are)\s+)?(?:not required|optional|available|on request)\b/i.test(after);
    }).map(m=>({statement:m[0],months:(Number(m[1])||words.indexOf(m[1].toLowerCase())+1)*(/^year/i.test(m[2])?12:/^day/i.test(m[2])?1/30:1)}));
  if(terms.some(t=>t.months===3&&/^minimum/i.test(t.statement))){
   const statements=[...new Set(terms.map(t=>t.statement))],conflict=terms.some(t=>t.months!==3);
   l.lease=statements.join('; ');l.shortLease=conflict?null:true;l.evidence.shortLease=`About this rental: ${l.lease}`;
   if(conflict)l.conflicts.push(`Lease terms conflict within About this rental: ${l.lease}. Confirm the unit's minimum term.`);
  }
 }
 if(source.id==='vada'&&/Rental Listing Features[^]*Washer\s*\/\s*Dryer/i.test(text)){l.laundry='in-unit';l.evidence.laundry='Washer / Dryer under Rental Listing Features';}
 if(source.id==='vada'&&/\b1 Parking stall\b/.test(text)){l.parking='included';l.parkingCount=1;}
 if(/(?:no|without)\s+in[- ](?:suite|unit)\s+(?:laundry|washer)/i.test(text)){l.laundry='none';l.evidence.laundry=text.match(/(?:no|without)\s+in[- ](?:suite|unit)\s+(?:laundry|washer)/i)![0];}
 if(source.id==='easyrent'){
  // Read individual labeled rows before their text loses DOM boundaries.
  const fields=new Map<string,string>();$('article .entry-content p.details').each((_,e)=>{const row=$(e),label=row.find('strong').first().text().trim().replace(/:$/,'').toLowerCase();const value=row.clone().children('strong').remove().end().text().trim();if(label)fields.set(label,value);});
  const numeric=(key:string)=>{const value=fields.get(key);return value!==undefined&&/^\d+(?:\.\d+)?$/.test(value)?Number(value):null;};
  const available=fields.get('availability');if(available){l.available=available;l.evidence.availability=`Availability: ${available}`;}
  const exactUnit=fields.get('unit #');if(exactUnit&&/^[A-Za-z0-9-]+$/.test(exactUnit)){l.unit=exactUnit;l.evidence.unit=`Unit #: ${exactUnit}`;const prefix=new RegExp('^'+exactUnit.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'[ -]+');if(prefix.test(title))l.address=title.replace(prefix,'');}
  const beds=numeric('bedrooms'),baths=numeric('bathrooms'),size=numeric('size unit (sqft)');if(beds!==null)l.beds=beds;if(baths!==null)l.baths=baths;if(size!==null&&size>0)l.sqft=size;
  const floor=fields.get('located on')?.match(/^(ground|\d{1,3})(?:st|nd|rd|th)?\s+floor$/i);if(floor){const value=floor[1].toLowerCase()==='ground'?0:Number(floor[1]);if(value<=200){l.floorLevel=value;l.evidence.floorLevel=`Located On: ${fields.get('located on')}`;}}
  const lease=fields.get('lease type');if(lease)l.lease=lease;
  const parking=numeric('parking');if(parking!==null){l.parkingCount=parking;l.parking=parking===0?'none':'included';l.evidence.parking=`Parking: ${parking}`;}
 }
 if(source.id==='austeville'){
  const header=$('.property-snapshot').first(),area=header.find('.property-snapshot__header .eyebrow').first().text().trim();
  if(area){l.area=area;l.evidence.location=`Property header: ${area}`;if(/\b(?:West Vancouver|North Vancouver|Burnaby|Richmond|Coquitlam|Surrey|New Westminster)\b/i.test(area)){l.location='outside';l.downtownDistance='far';}else if(/\b(?:Coal Harbour|West End|Yaletown|Downtown Vancouver)\b/i.test(area)){l.location='downtown';l.downtownDistance='downtown';}}
  header.find('.property-snapshot__details').each((_,e)=>{const paragraphs=$(e).children('p').map((_,p)=>$(p).text().trim()).get();if(paragraphs.length&&/^\d{1,6}\s+\S/.test(paragraphs[0]))l.address=paragraphs.join(', ').slice(0,500);});
  const availability=header.find('li').map((_,e)=>$(e).text().trim()).get().find(value=>/^Available:/i.test(value));if(availability){l.available=availability.replace(/^Available:\s*/i,'');l.evidence.availability=availability;}
  if(!l.unit)l.unit=new URL(url).pathname.match(/\/suite-([A-Za-z0-9-]+)\/?$/i)?.[1]??'';
 }
 if(source.id==='kijiji'){
  const header=body.split('Description')[0],studio=header.match(/Bachelor\s*\/\s*Studio\s*Bedrooms/i),parking=header.match(/(\d+)\s+Parking Included/i);
  if(studio){l.beds=0;l.evidence.bedrooms=studio[0];}else if(residence?.numberOfBedrooms===0||residence?.numberOfBedrooms==='0')l.beds=0;
  if(parking){l.parkingCount=Number(parking[1]);l.parking=l.parkingCount===0?'unknown':'included';l.parkingCost=null;l.evidence.parking=l.parkingCount===0?'0 parking spaces are included; paid parking availability and monthly cost are unconfirmed.':parking[0];}
  const description=typeof residence?.description==='string'?residence.description:body.split('Description').slice(1).join('Description');
  const advertised=[...description.matchAll(/\$([\d,]+(?:\.\d{1,2})?)\s*(?:CAD\s*)?(?:\/\s*(?:mo(?:nth)?|mth)\b|per\s+month\b|monthly\b)/gi)]
   .filter(m=>{const prefix=description.slice(0,m.index).split(/[.;\n•*]/).at(-1)??'';return !/\b(?:parking|utilities?|internet|water|hydro|heating|storage|deposit|fees?|other (?:units|suites)|furnished option)\b/i.test(prefix.slice(-100));})
   .map(m=>n(m[1])).filter((amount):amount is number=>amount!==null);
  const structured=n(residence?.offers?.price),amounts=[...new Set([kijijiHeaderRent,structured,...advertised].filter((amount):amount is number=>amount!==null))];
  if(amounts.length>1){l.rent=null;l.evidence.rent=`Listing header rent: ${kijijiHeaderRent===null?'unknown':'$'+kijijiHeaderRent}; structured rent: ${structured===null?'unknown':'$'+structured}; explicit description monthly rent: ${advertised.map(amount=>'$'+amount).join(' / ')}`;l.conflicts.push(`Monthly rent conflicts across the listing header and description: ${amounts.map(amount=>'$'+amount).join(' / ')}. Confirm current rent.`);}
  else if(amounts.length===1){l.rent=amounts[0];l.evidence.rent=`Advertised apartment rent: $${l.rent}/month; separately described fees excluded.`;}
  const internetCharge=description.match(/\b(?:high[- ]speed\s+)?internet\b[^.!?\n]{0,80}\$([\d,]+(?:\.\d{1,2})?)\s*(?:CAD\s*)?(?:\/\s*(?:mo(?:nth)?|mth)\b|per\s+month\b|monthly\b)/i);
  if(internetCharge){l.evidence.internetCharge=internetCharge[0];l.internet=`Internet advertised separately at $${n(internetCharge[1])}/month; inclusion and whether it is optional require confirmation. Speed and reliability unverified.`;}
 }
 if(source.id==='hollyburn'&&new URL(url).pathname.startsWith('/building/')){
  // Expanded discovery can expose a building advertisement. It does not establish any specific suite.
  l.offeringKind='building';l.unit='';l.beds=null;l.baths=null;l.sqft=null;
  l.rent=null;l.laundry='unknown';l.furnished=null;l.workspace=null;l.modern=null;l.openPlan=null;l.gas=null;l.north=null;l.shortLease=null;l.parking='unknown';l.parkingCount=null;l.parkingCost=null;
  l.description+=' Representative building advertisement; exact-unit provenance unverified. Unit prices, availability and included facilities require a specific suite advertisement.';
  l.description=l.description.slice(0,50000);l.galleryComplete=false;l.expectedPhotos=null;
  l.conflicts.push('Building inventory route is an unvalidated coverage trial; this record is not a confirmed available apartment.');
 }
 return l;
}
