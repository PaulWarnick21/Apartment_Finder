import type {Store} from './db.ts';
import {areaSearchRoute,type SearchAreaPolicy} from './search-area.ts';

/** Retain an actual URL produced by the verified public Vancouver radius control.
 * Earlier broad provenance stays valid for already discovered candidates. */
export function adoptFacebookRadiusRoute(store:Store,fromUrl:string,toUrl:string,verifiedRadiusKm:number){
 if(![3,4,5].includes(verifiedRadiusKm))return false;
 const original=areaSearchRoute(store,'facebook',fromUrl),policy=store.get<SearchAreaPolicy>('searchAreaPolicy');
 if(!original||original.region!=='downtown-vancouver'||original.scope!=='vancouver-approximate'||!policy?.sourceRoutes)return false;
 let observed:URL;try{observed=new URL(toUrl);}catch{return false;}
 if(observed.protocol!=='https:'||observed.hostname!=='www.facebook.com'||observed.username||observed.password||!/^\/marketplace\/(?:[A-Za-z0-9_-]+\/)?propertyrentals\/?$/.test(observed.pathname))return false;
 if(observed.searchParams.getAll('radius').some(value=>Number(value)!==verifiedRadiusKm))return false;
 const routes=policy.sourceRoutes.facebook??[];
 if(!routes.some(route=>route.url===toUrl)){
  policy.sourceRoutes.facebook=[...routes,{url:toUrl,region:original.region,scope:original.scope}];
  store.set('searchAreaPolicy',policy);
 }
 store.set('facebookObservedRadiusRoute',{fromUrl,toUrl,verifiedRadiusKm,verifiedAt:new Date().toISOString(),basis:'Verified visible Vancouver search-radius control; individual addresses remain approximate'});
 return true;
}
