import {load} from 'cheerio';
import {listingSchema,type Listing} from '../src/domain.ts';
import {extractFurnishing} from '../src/furnishing.ts';
/** Parse JSON only: page scripts are never evaluated. */
export function zumperState(html:string){const $=load(html);for(const script of $('script').toArray()){const text=$(script).text(),start=text.indexOf('window.__PRELOADED_STATE__ = ');if(start<0)continue;const value=text.slice(start+'window.__PRELOADED_STATE__ = '.length).trim();let depth=0,quoted=false,escape=false;for(let i=0;i<value.length;i++){const c=value[i];if(quoted){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')quoted=false;}else if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0)return JSON.parse(value.slice(0,i+1));}}throw new Error('Zumper listing data not recognized');}
export function extractZumper(html:string,url:string):Listing{
 const state=zumperState(html),entity=state.detail?.entity?.data;if(!entity)throw new Error('Zumper unit data missing');
 const floorplans=entity.floorplan_listings??[];
 const unit=floorplans.length?[...floorplans].filter(p=>p.min_price>0).sort((a,b)=>(a.bedrooms===1?0:a.bedrooms===2?1:2)-(b.bedrooms===1?0:b.bedrooms===2?1:2)||a.min_price-b.min_price)[0]:entity;
 if(!unit)throw new Error('No priced Zumper unit type found');
 const representative=floorplans.length>0,media=[...(entity.media??[]),...(representative?unit.media??[]:[])].filter(p=>p.is_available!==false);
 const ids=[...new Set(media.map(p=>String(p.media_id)))];
 // This size is advertised in captured gallery markup; never invent a larger size.
 const photoUrls=ids.map(id=>({id,url:`https://img.zumpercdn.com/${id}/1280x960?auto=format`,kind:media.find(p=>String(p.media_id)===id)?.media_type===2?'floorplan':'unknown'}));
 const description=load(entity.description??'').text()+' '+load(unit.description??'').text();
 const furnishing=extractFurnishing(description),amenities=(unit.amenity_tags??[]).join('; ');
 const rent=unit.min_price??unit.price??null;
 return listingSchema.parse({source:'zumper',sourceId:String(unit.listing_id??entity.building_id),url,title:`${entity.name??unit.title??'Apartment'}${representative?' · '+unit.title:''}`,address:entity.address??entity.formatted_address??'',unit:representative?'':entity.unit??'',area:entity.neighborhood_name??unit.neighborhood?.name??'Unknown',rent,beds:unit.bedrooms??null,baths:unit.bathrooms??null,sqft:unit.square_feet||null,description:(description+(representative?' Representative photos of the building and unit type; exact-unit provenance unverified.':'')).slice(0,50000),furnished:representative?null:furnishing.value,laundry:/In-Unit Laundry/i.test(amenities)?'in-unit':'unknown',lease:unit.min_lease_days?`Minimum ${unit.min_lease_days} days`:'Unknown',shortLease:unit.min_lease_days?unit.min_lease_days<365:null,photos:photoUrls,expectedPhotos:ids.length,galleryComplete:ids.length>0,conflicts:representative?['Building / floor-plan advertisement: exact suite and availability must be confirmed.']:[],evidence:{amenities,...(furnishing.statement&&!representative?{furnishingStatement:furnishing.statement}:{})}});
}
