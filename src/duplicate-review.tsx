import React,{useEffect,useState} from 'react';
import type {Home} from './domain';
export function DuplicateReview({home,request,onChanged,onMerged}:{home:Home;request:(p:string,m?:string,b?:unknown)=>Promise<any>;onChanged:()=>Promise<void>;onMerged:()=>void}){
 const [others,setOthers]=useState<Home[]>([]),[merges,setMerges]=useState<any[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function load(){const value=await request(`homes/${home.id}/duplicates`);setOthers(value.candidates);setMerges(value.history);}
 useEffect(()=>{void load().catch(()=>{});},[home.id,home.revision]);
 async function command(path:string,value:unknown,merged=false){setBusy(true);setError('');try{await request(path,'POST',value);await onChanged();if(merged)onMerged();else await load();}catch(e){setError(String(e).replace(/^Error: /,''));}finally{setBusy(false);}}
 if(!others.length&&!merges.length&&!home.aliases?.length)return null;
 return <details><summary>Possible Duplicates & Linked Apartments</summary>
  {home.aliases?.length&&<p>Also referenced as {home.aliases.map(id=>`Apartment #${id}`).join(', ')}.</p>}
  <p>Matching addresses can contain different units. Confirm the same apartment only when unit identity is supported. Both source records and histories are retained.</p>
  {others.map(other=><div className="panel" key={other.id}><p><strong>Apartment #{other.id}</strong> · {other.listing.address} · Unit {other.listing.unit||'Not Confirmed'}</p><p>{other.listing.rent===null?'Rent Unknown':`$${other.listing.rent}`} · {other.listing.beds??'?'} bedrooms · {other.stage}</p><p>{other.postings.map(p=><a key={p.url} href={p.url} target="_blank" rel="noreferrer">Open {p.source} Listing ↗ </a>)}</p><button disabled={busy} onClick={()=>command('duplicates/different',{a:home.id,b:other.id})}>Different Apartments</button> <button disabled={busy} onClick={()=>command('duplicates/merge',{keepId:home.id,duplicateId:other.id,revisions:{keep:home.revision,duplicate:other.revision},confirmation:'SAME APARTMENT'},true)}>Same Apartment — Keep #{home.id}</button></div>)}
  {merges.filter(m=>!m.split).map(m=><p key={m.id}>Linked #{m.duplicate_id} to #{m.keep_id}. <button disabled={busy} onClick={()=>command('duplicates/split',{mergeId:m.id})}>Undo Merge</button></p>)}
  {error&&<p role="alert" className="warning">{error}</p>}
 </details>;
}
