import React,{useId,useState,type ReactNode} from 'react';
import type {Home} from './domain';

/** A group occupies one grid slot until explicitly expanded; only matching, eligible units are passed in. */
export function BuildingGroupCards({homes,label,context,renderCard}:{homes:Home[];label:string;context:(shownIds:number[],compact:boolean)=>ReactNode;renderCard:(home:Home)=>ReactNode}){
 const [expanded,setExpanded]=useState(false),cardsId=useId();
 // The representative is always the highest full score, even when the desk is sorted by rent or recency.
 const leader=[...homes].sort((a,b)=>b.score.value-a.score.value||a.id-b.id)[0];
 if(!leader)return null;
 const others=homes.filter(h=>h.id!==leader.id),shown=expanded?[leader,...others]:[leader];
 return <section className={`building-group ${expanded?'is-expanded':'is-collapsed'}`} aria-label={label}>
  {context(shown.map(h=>h.id),!expanded)}
  {others.length>0&&<div className="building-fold-controls"><span>Highest score · #{leader.id}</span><button type="button" aria-expanded={expanded} aria-controls={cardsId} onClick={()=>setExpanded(!expanded)}>{expanded?'Hide other units':`Show ${others.length} other ${others.length===1?'unit':'units'}`}</button></div>}
  <div id={cardsId} className="card-grid">{shown.map(renderCard)}</div>
  {expanded&&others.length>1&&<button className="building-fold-bottom" type="button" aria-expanded={true} aria-controls={cardsId} onClick={()=>setExpanded(false)}>Collapse building group</button>}
 </section>;
}
