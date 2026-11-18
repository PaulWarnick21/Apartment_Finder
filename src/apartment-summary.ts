import type {Home} from './domain';
import {furnishingForListing} from './furnishing';
export function apartmentSummary(h:Pick<Home,'listing'|'score'>){
 const l=h.listing,s=h.score,money=(n:number)=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(n);
 const type=l.beds===0?'studio':l.beds===null?'apartment':`${l.beds}-bedroom apartment`,area=l.area==='Unknown'?'':` in ${l.area}`;
 const facts=`This ${type}${area} ${l.rent===null?'has no confirmed rent':`is listed at ${money(l.rent)} per month`}, with an app score of ${s.value.toFixed(1)} out of 5.`;
 const windows=l.photos.filter(p=>p.status==='reviewed'&&p.kind==='interior'&&p.unitCertain),nature=windows.some(p=>p.scenery==='nature');
 const outlook=s.view==='Partial nature'?'The window photos show a partial nature view with limitations':nature?'The reviewed window photos show a nature outlook':windows.some(p=>p.scenery==='buildings')?'The reviewed windows look mainly toward buildings; a qualifying nature view is unconfirmed':'A nature view through this specific apartment’s windows is not confirmed';
 const view=outlook+(!l.galleryComplete||l.photos.some(p=>p.status!=='reviewed')?'; the photo review is incomplete.':'.');
 const furnishing=furnishingForListing(l),features=[l.gas===true?'gas cooking':null,l.workspace===true&&l.beds!==2?'a workspace':null,l.laundry==='in-unit'?'in-unit laundry':null,l.parking==='included'?'included parking':null,furnishing.value===true?'included furniture':null,l.shortLease===true?'a shorter lease':null].filter(Boolean);
 const details=(features.length?`Listing evidence indicates ${features.slice(0,4).join(', ')}`:'No additional preferred amenities are confirmed')+(l.modern===false?'; the interior appears dated':furnishing.assumed?'; furniture is not mentioned, so it is assumed unfurnished':furnishing.value===false?'; it is advertised unfurnished':'')+'.';
 const unknowns=s.flags.filter(f=>!['Photo review pending','View Unverified'].includes(f)).slice(0,3).map(f=>f.replace(/ Unsure$/,'').toLowerCase());
 const caution=unknowns.length?`Still to confirm: ${unknowns.join(', ')}.`:s.reasons.length?`It does not currently pass your review requirements: ${s.reasons.join('; ').toLowerCase()}.`:'The recorded essentials are covered; confirm availability and lease terms with the advertiser.';
 return [facts,view,details,caution].join(' ');
}
