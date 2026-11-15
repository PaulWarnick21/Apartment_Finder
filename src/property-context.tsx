import React,{useEffect,useState} from 'react';
import type {Home} from './domain';
import {recurringCosts} from './listing-costs';
import type {BuildingResearch} from '../server/building-research';
type Context={research:BuildingResearch|null;stale:boolean;airportDirections:string;transitSource:string};
const money=(n:number)=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(n);
export function PropertyContext({home,request,onChanged}:{home:Home;request:(p:string,m?:string,b?:unknown)=>Promise<any>;onChanged:()=>Promise<void>}){
 const [context,setContext]=useState<Context|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const costs=recurringCosts(home.listing);
 async function load(){setContext(await request(`homes/${home.id}/context`));}
 useEffect(()=>{let active=true;request(`homes/${home.id}/context`).then(value=>{if(active)setContext(value);}).catch(()=>{});return()=>{active=false;};},[home.id]);
 async function research(){setBusy(true);setError('');try{await request(`homes/${home.id}/research`,'POST',{confirmation:'APPROVE TWO PUBLIC RESEARCH REQUESTS'});await load();await onChanged();}catch(e){setError(String(e).replace(/^Error: /,''));}finally{setBusy(false);}}
 return <details className="property-context"><summary>Location, Monthly Costs & Building Records</summary>
  <div className="detail-columns"><div><h3>Known Monthly Cost</h3><p><strong>{costs.knownMonthlyTotal===null?'Not Confirmed':money(costs.knownMonthlyTotal)}</strong>{costs.knownMonthlyTotal!==null?' / month':''}</p>
  <p>Advertised rent{costs.charges.length?' plus the charges below':''}. This is an estimate; your rent-ceiling setting remains separate.</p>
  {costs.charges.map((charge,i)=><p key={i}>{charge.label}: {money(charge.amount)} <small>— {charge.evidence}</small></p>)}
  {costs.unknown.length>0&&<p>Still to confirm: {costs.unknown.join(', ')}.</p>}</div>
  <div><h3>Location & Airport Access</h3><p>{home.listing.area==='Unknown'?'Neighbourhood Not Confirmed':home.listing.area}</p>
  {home.listing.evidence.location&&<p>{home.listing.evidence.location}</p>}
  {context&&<p><a href={context.airportDirections} target="_blank" rel="noreferrer">Check Airport Transit Journey ↗</a> · <a href={context.transitSource} target="_blank" rel="noreferrer">TransLink Trip Planner ↗</a></p>}
  <p className="footnote">Walking times, transfers and journey times require a current route check. Station proximity alone does not earn a verified airport-access benefit.</p></div></div>
  <h3>Public Building Records</h3><p>Checks the advertised address and City of Vancouver issued permits. At most two public-data requests; no listing visits or AI calls. Successful results are reused for seven days; unavailable checks can be retried after 24 hours.</p>
  <button disabled={busy} onClick={research}>{busy?'Checking Records…':'Check Address & Building Records'}</button>
  {error&&<p className="warning" role="alert">{error}</p>}
  {context?.research&&<><p>Checked {new Date(context.research.checkedAt).toLocaleString()} · {context.research.status}{context.stale?' · Refresh Available':''}</p>{context.research.notes.map((note,i)=><p key={i}>{note}</p>)}{context.research.permits.map(permit=><article key={permit.number+permit.issued}><p><a href={permit.url} target="_blank" rel="noreferrer">{permit.number}</a> · {permit.issued}</p><p>{permit.description}</p></article>)}<a href={context.research.sourceUrl} target="_blank" rel="noreferrer">City of Vancouver Records ↗</a></>}
 </details>;
}
