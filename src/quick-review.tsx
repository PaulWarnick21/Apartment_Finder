import type {Home} from './domain';
import type {ReactNode} from 'react';
import {PhotoGallery} from './photo-gallery';
import {fullReviewLabels,reviewDecisions} from './review-presentation';

export function GradeBadge({home}:{home:Home}){
 return <span className="score quick-grade" aria-label={`Quick rank ${home.quickRank?.grade??'pending'}`}>{home.quickRank?.grade??'—'} <small>QUICK RANK</small></span>;
}

export function FullReviewStatus({home,busy=false,retry}:{home:Home;busy?:boolean;retry?:()=>void}){
 const job=home.fullReview;
 if(job?.status==='complete')return null;
 if(!job)return home.reviewMode==='quick'&&home.stage==='Interested'?<div className="full-review-status" role="status"><strong>Full scoring not started</strong><p>This apartment is waiting for a full assessment.</p>{retry&&<button disabled={busy} onClick={retry}>Start full scoring</button>}</div>:null;
 return <div className={`full-review-status full-review-${job.status}`} role="status"><strong>{job.waitingForFeedback?'Waiting for feedback resolution':fullReviewLabels[job.status]}</strong>{job.detail&&<p>{job.detail}</p>}{retry&&!job.waitingForFeedback&&['failed','paused','cancelled'].includes(job.status)&&home.stage==='Interested'&&<button disabled={busy} onClick={retry}>Retry full scoring</button>}</div>;
}

export function ReviewActions({home,busy,onDecision}:{home:Home;busy:boolean;onDecision:(stage:Home['stage'],revisitLater?:boolean)=>void}){
 return <div className="interest-actions">{reviewDecisions(home).map(({stage,label,disabled,revisitLater})=><button key={stage} disabled={busy||disabled} className={revisitLater===undefined&&['Interested','Serious Candidates','Ready to Apply','In Progress'].includes(stage)?'primary':''} onClick={()=>onDecision(stage,revisitLater)}>{label}</button>)}</div>;
}

export function QuickReviewContent({home:h,busy,onDecision,onRetry,decisionNotice}:{home:Home;busy:boolean;onDecision:(stage:Home['stage'])=>void;onRetry:()=>void;decisionNotice?:ReactNode}){
 const l=h.listing,known=l.photos.length,saved=l.photos.filter(p=>p.local).length;
 const archived=saved===0&&l.evidence.archivedScore;
 const money=l.rent===null?'Rent not listed':new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(l.rent);
 return <div className="quick-review-content">
  <div className="quick-review-facts"><div><span className="eyebrow">MONTHLY RENT</span><h3>{money}</h3></div><div><span className="eyebrow">LOCATION</span><p>{l.address||l.area||'Location not confirmed'}</p>{l.address&&l.area!=='Unknown'&&<small>{l.area}</small>}{l.evidence.searchAreaBasis&&<small className="quick-location-status">Area from website filter · exact address not independently verified</small>}{!l.evidence.searchAreaBasis&&l.evidence.addressLookupStatus&&<small className="quick-location-status">{l.evidence.addressLookupStatus==='verified'?'Address location verified':l.evidence.addressLookupDetail}</small>}</div><GradeBadge home={h}/></div>
  {archived?<div className="quick-review-explainer"><p><strong>Saved decision</strong> {h.stage}</p><p>{archived}</p></div>:<p className="quick-review-explainer">{h.stage==='Interested'?'This apartment stays in Scoring in Progress until its full assessment is complete, then moves automatically to Interested for your review.':'Quick rank from listing details and saved evidence. Choose Interested to queue full scoring in Scoring in Progress.'}</p>}
  {decisionNotice??<ReviewActions home={h} busy={busy} onDecision={onDecision}/>}
  {h.deskExclusion&&<p className="warning" role="status">{h.deskExclusion}</p>}
  {!archived&&<FullReviewStatus home={h} busy={busy} retry={onRetry}/>}
  {h.quickRank&&!h.quickRank.eligible&&h.quickRank.reasons.map(reason=><p className="warning" key={reason}>{reason}</p>)}
  <div className="quick-photo-heading"><h3>Listing Photos</h3><span>{saved} saved · {l.expectedPhotos??known} {l.expectedPhotos===null?'known ':''}photos</span></div>
  {(saved<known||!l.galleryComplete)&&<p className="quick-photo-note">{saved<known?'Some listing photos are still pending or inaccessible. ':''}{!l.galleryComplete?'Complete gallery not confirmed.':''}</p>}
  <PhotoGallery photos={l.photos} apartmentId={h.id} rent={l.rent} grade={h.quickRank?.grade} quick/>
  {!known&&<p className="photo-pending">Listing photos have not been collected yet.</p>}
  {!!(h.quickRank?.reasons.length||h.quickRank?.flags.length)&&<details><summary>Quick Rank Details</summary><ul>{[...(h.quickRank?.reasons??[]),...(h.quickRank?.flags??[])].map((reason,index)=><li key={index}>{reason}</li>)}</ul><p>S: exceptional fit with strong verified evidence · A: promising candidate · B–E: lower priority · F: unlikely fit. Grades do not remove apartments from your review.</p></details>}
  {h.notes&&<details><summary>Your Saved Notes</summary><p className="prewrap">{h.notes}</p></details>}
  <div className="source-links">{h.postings.map(p=><a key={p.url} href={p.url} target="_blank" rel="noreferrer">Open {p.source} listing ↗</a>)}</div>
 </div>;
}
