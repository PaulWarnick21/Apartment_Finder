import {load} from 'cheerio';
import {listingSchema,type Listing} from '../src/domain.ts';
import {extractFurnishing} from '../src/furnishing.ts';
import {parsePostingDate} from './listing-age.ts';
/** Parse JSON only: page scripts are never evaluated. */
export function zumperState(html:string){const $=load(html);for(const script of $('script').toArray()){const text=$(script).text(),start=text.indexOf('window.__PRELOADED_STATE__ = ');if(start<0)continue;const value=text.slice(start+'window.__PRELOADED_STATE__ = '.length).trim();let depth=0,quoted=false,escape=false;for(let i=0;i<value.length;i++){const c=value[i];if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0)return JSON.parse(value.slice(0,i+1));}}throw new Error('Zumper listing data not recognized');}
export function extractZumper(html:string,url:string):Listing{
 return extractZumperOfferings(html,url)[0];
}
type UnitIdentity={id:string;permanent:boolean};
function unitIdentity(value:unknown,base:string):UnitIdentity|undefined{
 if(typeof value!=='string')return undefined;
 try{const url=new URL(value,base),match=url.pathname.match(/^\/(?:listings|apartments-for-rent)\/(\d+)(p)?(?:\/|$)/);return url.origin==='https://www.zumper.com'&&match?{id:match[1],permanent:!!match[2]}:undefined;}catch{return undefined;}
}
function matchesUnit(row:any,wanted:UnitIdentity,url:string){
 if(!row||typeof row!=='object')return false;
 // The advertised URL is authoritative when present. Address pages can put a
 // sibling unit in entity.data even while the requested unit remains active.
 const advertised=unitIdentity(row.url,url);
 if(advertised?.permanent===wanted.permanent)return advertised.id===wanted.id;
 // A listing_id URL and a permanent pl_id URL may identify the same unit;
 // accept that alias only when the row explicitly supplies the requested ID.
 if(advertised){const id=wanted.permanent?row.pl_id:row.listing_id;return id!==undefined&&String(id)===wanted.id;}
 const id=wanted.permanent?row.pl_id??row.listing_id:row.listing_id;
 return id!==undefined&&String(id)===wanted.id;
}
function requestedUnit(state:any,url:string){
 const wanted=unitIdentity(url,url);if(!wanted)throw Error('Zumper requested unit URL is not recognized');
 const rows=[state.detail?.entity?.data,...(Array.isArray(state.detail?.activeListings)?state.detail.activeListings:[]),...(Array.isArray(state.detail?.units?.data)?state.detail.units.data:[]),...(Array.isArray(state.permanentAddress?.activeListings)?state.permanentAddress.activeListings:[])].filter(row=>matchesUnit(row,wanted,url));
 if(!rows.length)throw Error('Zumper requested unit was not found in the captured active listings; sibling facts were not imported');
 const ids=new Set(rows.map(row=>row.listing_id).filter(id=>id!==undefined).map(String));
 if(ids.size>1)throw Error('Zumper requested unit identity is ambiguous; sibling facts were not imported');
 // Enrich only duplicate representations of this exact unit. Never borrow an
 // address-level sibling's description, price, bedroom count or photographs.
 const selected={...rows[0]};
 for(const row of rows.slice(1))for(const [key,value]of Object.entries(row))if(selected[key]==null)selected[key]=value;
 selected.media=rows.flatMap(row=>Array.isArray(row.media)?row.media:[]);
 selected.image_ids=rows.flatMap(row=>Array.isArray(row.image_ids)?row.image_ids:[]);
 return selected;
}
export function extractZumperOfferings(html:string,url:string):Listing[]{
 const state=zumperState(html),building=/^\/apartment-buildings\/p\d+(?:\/|$)/.test(new URL(url).pathname),entity=building?state.detail?.entity?.data:requestedUnit(state,url);if(!entity)throw new Error('Zumper unit data missing');
 const floorplans=entity.floorplan_listings??[];
 // Some advertised types carry $1 placeholders instead of a usable monthly rent.
 const units=floorplans.length?[...floorplans].filter(p=>p.min_price>1||p.min_price==null).sort((a,b)=>(a.bedrooms===1?0:a.bedrooms===2?1:2)-(b.bedrooms===1?0:b.bedrooms===2?1:2)||(a.min_price??Infinity)-(b.min_price??Infinity)):[entity];
 if(!units.length)throw new Error('No priced Zumper unit type found');
 return units.map((unit:any,index:number)=>{
 const representative=floorplans.length>0,allMedia=[...(entity.media??[]),...(representative?unit.media??[]:[])],media=allMedia.filter(p=>p.is_available!==false),unavailable=new Set(allMedia.filter(p=>p.is_available===false).map(p=>String(p.media_id)));
 // Permanent-address pages expose the requested unit's whole gallery as
 // image_ids; the selected sibling's media array is not that unit's gallery.
 const ids=[...new Set([...media.map(p=>String(p.media_id)),...(!representative&&Array.isArray(unit.image_ids)?unit.image_ids.map(String):[])])].filter(id=>/^\d+$/.test(id)&&!unavailable.has(id));
 // This size is advertised in captured gallery markup; never invent a larger size.
 const photoUrls=ids.map(id=>({id,url:`https://img.zumpercdn.com/${id}/1280x960?auto=format`,kind:media.find(p=>String(p.media_id)===id)?.media_type===2?'floorplan':'unknown'}));
 const description=load(entity.description??'').text()+' '+load(unit.description??'').text();
 const furnishing=extractFurnishing(description),amenities=(unit.amenity_tags??[]).join('; ');
 const rent=unit.min_price??unit.price??null;
 if(rent!==null&&rent<=1)throw new Error('Zumper advertises a placeholder price; monthly rent needs confirmation');
 const offeringId=String(unit.listing_id??unit.floorplan_id??`${entity.building_id??'building'}:${unit.title??index}`);
 return listingSchema.parse({source:'zumper',sourceId:offeringId,postedAt:parsePostingDate(unit.listed_on),offeringId,offeringKind:representative?'floorplan':'unit',parentListingUrl:representative?url:undefined,url,title:`${entity.name??unit.title??'Apartment'}${representative?' · '+unit.title:''}`,address:entity.address??entity.formatted_address??'',unit:representative?'':entity.unit??'',area:entity.neighborhood_name??unit.neighborhood?.name??'Unknown',rent,beds:unit.bedrooms??null,baths:unit.bathrooms??null,sqft:unit.square_feet||null,description:(description+(representative?' Representative photos of the building and unit type; exact-unit provenance unverified.':'')).slice(0,50000),furnished:representative?null:furnishing.value,laundry:/In-Unit Laundry/i.test(amenities)?'in-unit':'unknown',lease:unit.min_lease_days?`Minimum ${unit.min_lease_days} days`:'Unknown',shortLease:unit.min_lease_days?unit.min_lease_days<365:null,photos:photoUrls,expectedPhotos:ids.length,galleryComplete:ids.length>0,conflicts:representative?['Building / floor-plan advertisement: exact suite and availability must be confirmed.']:[],evidence:{amenities,...(furnishing.statement&&!representative?{furnishingStatement:furnishing.statement}:{})}});
 });
}
