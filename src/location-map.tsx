import React,{useEffect,useState} from 'react';
import type {MapLocation} from '../server/location-map';
export function LocationMap({homeId,request}:{homeId:number;request:(path:string,method?:string)=>Promise<any>}){
 const [state,setState]=useState<MapLocation|null>(null);
 useEffect(()=>{let active=true;setState(null);request(`homes/${homeId}/map`,'POST').then(value=>{if(active)setState(value);}).catch(()=>{if(active)setState({status:'unavailable',label:''});});return()=>{active=false;};},[homeId]);
 const ready=state?.status==='ready'&&Number.isFinite(state.lat)&&Number.isFinite(state.lon);
 const lat=state?.lat??0,lon=state?.lon??0,span=state?.approximate?.035:.009;
 const query=new URLSearchParams({bbox:[lon-span,lat-span*.55,lon+span,lat+span*.55].join(','),layer:'mapnik',...(!state?.approximate?{marker:`${lat},${lon}`}:{})});
 const link=ready?`https://www.openstreetmap.org/?${state?.approximate?'':`mlat=${lat}&mlon=${lon}&`}#map=${state?.approximate?13:15}/${lat}/${lon}`:state?.label?`https://www.openstreetmap.org/search?query=${encodeURIComponent(state.label+', British Columbia, Canada')}`:null;
 return <section className="location-map" aria-label="Apartment Location"><div className="location-map-heading"><h3>Location</h3>{link&&<a href={link} target="_blank" rel="noreferrer">Open Larger Map ↗</a>}</div>
  {state?.label&&<p>{state.label}{state.approximate?' · Approximate Area':''}</p>}
  {ready?<iframe key={homeId} title={`Map of Apartment #${homeId}${state?.approximate?' — approximate area':''}`} src={`https://www.openstreetmap.org/export/embed.html?${query}`} loading="eager" referrerPolicy="strict-origin-when-cross-origin"/>:<div className="location-map-placeholder" role="status">{state?'Location Not Confirmed':'Loading Map…'}</div>}
  {ready&&<div className="location-map-caption"><span>{state?.approximate?'Area shown; exact address not supplied.':'Map based on the advertised street address.'}</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap Contributors</a></div>}
 </section>;
}
