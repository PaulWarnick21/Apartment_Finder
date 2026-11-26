import React,{useId,useState,type ReactNode} from 'react';
import type {Home} from './domain';
import {fullReviewComplete} from './review-presentation';

/** A group occupies one grid slot until explicitly expanded; only matching, eligible units are passed in. */
export function BuildingGroupCards({homes,label,context,renderCard}:{homes:Home[];label:string;context:(shownIds:number[],compact:boolean)=>ReactNode;renderCard:(home:Home)=>ReactNode}){
 const [expanded,setExpanded]=useState(false),cardsId=useId();
 // Prefer completed scores; explicitly grouped pending units use their quick rank.
 const leader=[...homes].sort((a,b)=>Number(fullReviewComplete(b))-Number(fullReviewComplete(a))||(fullReviewComplete(a)?b.score.value-a.score.value:(b.quickRank?.rankValue??0)-(a.quickRank?.rankValue??0))||a.id-b.id)[0];
 if(!leader)return null;
 const others=homes.filter(h=>h.id!==leader.id),shown=expanded?[leader,...others]:[leader];
 return <section className={`building-group ${expanded?'is-expanded':'is-collapsed'}`} aria-label={label}>
  {context(shown.map(h=>h.id),!expanded)}
  {others.length>0&&<div className="building-fold-controls"><span>{fullReviewComplete(leader)?'Highest score':'Highest quick rank · Full assessment pending'} · #{leader.id}</span><button type="button" aria-expanded={expanded} aria-controls={cardsId} onClick={()=>setExpanded(!expanded)}>{expanded?'Hide other units':`Show ${others.length} other ${others.length===1?'unit':'units'}`}</button></div>}
  <div id={cardsId} className="card-grid">{shown.map(renderCard)}</div>
  {expanded&&others.length>1&&<button className="building-fold-bottom" type="button" aria-expanded={true} aria-controls={cardsId} onClick={()=>setExpanded(false)}>Collapse building group</button>}
 </section>;
}
