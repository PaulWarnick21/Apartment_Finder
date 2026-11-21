import {useEffect,useImperativeHandle,useRef,useState,type Ref} from 'react';
import type {RatingFeedback,RatingSubmission} from './rating-types';
import type {Stage} from './stage-transitions';
export type RatingPanelHandle={withRating:(action:(rating?:RatingSubmission)=>void)=>void};
type Props={ref?:Ref<RatingPanelHandle>;disabled?:boolean;homeId:number;appScore:number;request:(path:string,method?:string,body?:unknown)=>Promise<any>;onChanged:()=>Promise<void>;decisions?:{stage:Stage;label:string;disabled?:boolean;revisitLater?:boolean}[];onDecision?:(stage:Stage,rating?:RatingSubmission,revisitLater?:boolean)=>void};
const statusLabel:Record<RatingFeedback['status'],string>={pending:'Saved · queued for automatic review',reviewing:'Reviewing your feedback…',reviewed:'Reviewed · preferences unchanged',applied:'Reviewed · scoring updated',failed:'Saved · review needs retry',reverted:'Scoring change undone','needs-attention':'Reviewed · attention needed'};
const statusText=(rating:RatingFeedback)=>rating.status==='pending'&&rating.error?'Saved · review is waiting':statusLabel[rating.status];
export function RatingPanel({ref,disabled=false,homeId,request,onChanged,decisions=[],onDecision}:Props){
 const [score,setScore]=useState(''),[reason,setReason]=useState(''),[ratings,setRatings]=useState<RatingFeedback[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const initialized=useRef(false),touched=useRef(false),saving=useRef(false);
 const requestRef=useRef(request);requestRef.current=request;
 const changedRef=useRef(onChanged);changedRef.current=onChanged;const previous=useRef('');
 async function accept(ratings:RatingFeedback[]){setRatings(ratings);const signature=JSON.stringify(ratings);if(signature!==previous.current){previous.current=signature;await changedRef.current();}}
 async function refresh(){const data=await requestRef.current(`homes/${homeId}/ratings`);await accept(data.ratings);return data.ratings as RatingFeedback[];}
 useEffect(()=>{let active=true;initialized.current=false;
  async function load(){try{const data=await requestRef.current(`homes/${homeId}/ratings`);if(!active)return;await accept(data.ratings);if(!active)return;if(!initialized.current){initialized.current=true;if(data.ratings[0]&&!touched.current){setScore(String(data.ratings[0].userScore));setReason(data.ratings[0].reason);}}}catch(e){if(active)setError(String(e).replace(/^Error: /,''));}}
  void load();const timer=setInterval(load,3000);return()=>{active=false;clearInterval(timer);};
 },[homeId]);
 function prepareRating():RatingSubmission{const value=Number(score),text=reason.trim();if(!score.trim()||!Number.isFinite(value)||value<.1||value>5||Math.abs(value*10-Math.round(value*10))>1e-8||text.length<3||text.length>2000)throw new Error('Enter a score from 0.1 to 5 and a reason of at least three characters before moving this apartment. Your draft is still here.');return {requestId:crypto.randomUUID(),score:value,reason:text};}
 function withRating(action:(rating?:RatingSubmission)=>void){if(disabled||busy||saving.current)return;saving.current=true;setError('');setNotice('');try{const latest=ratings[0],hasDraft=!!score.trim()||!!reason.trim(),changed=!latest||Number(score)!==latest.userScore||reason.trim()!==latest.reason;action((hasDraft||touched.current)&&changed?prepareRating():undefined);}catch(e){setError(String(e).replace(/^Error: /,''));}finally{saving.current=false;}}
 useImperativeHandle(ref,()=>({withRating}));
 async function reviewAction(id:number,action:'retry'|'undo'){setBusy(true);setError('');try{await requestRef.current(`ratings/${id}/${action}`,'POST',{});await refresh();setNotice(action==='undo'?'Scoring change undone; your feedback is kept.':'Review queued.');}catch(e){setError(String(e).replace(/^Error: /,''));}finally{setBusy(false);}}
 const latest=ratings[0];
 return <section className="rating-panel" aria-label="Your apartment rating"><h3>Your Rating</h3>
  <div className="rating-inputs"><label>Your Score<input aria-label="Your Score" type="number" min="0.1" max="5" step="0.1" disabled={busy||disabled} value={score} onChange={e=>{touched.current=true;setScore(e.target.value);}} placeholder="3.5"/></label><label>Reason for Your Score<textarea aria-label="Reason for Your Score" rows={1} minLength={3} maxLength={2000} disabled={busy||disabled} value={reason} onChange={e=>{touched.current=true;setReason(e.target.value);}} placeholder="What makes this a good or poor match for you?"/></label></div>
  <p className="footnote">{decisions.length?'Choose a stage to move this apartment immediately. Your score and explanation save in the background and update scoring. A new rating is optional.':'Save Changes saves your score and explanation in the background and updates scoring.'}</p>
  <div className="rating-actions">{decisions.map(d=><button type="button" key={d.stage} className={d.revisitLater===undefined&&['Interested','Serious Candidates','Ready to Apply','In Progress'].includes(d.stage)?'primary':''} disabled={busy||disabled||d.disabled||!onDecision} onClick={()=>withRating(rating=>onDecision!(d.stage,rating,d.revisitLater))}>{d.label}</button>)}{busy&&<span role="status">Saving…</span>}</div>
  {error&&<p className="warning" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {latest&&<div className="rating-result" aria-label="Feedback review"><p role="status"><strong>{statusText(latest)}</strong></p>
   {latest.calibrationApplied&&<p>Your rating is already included in scoring.</p>}
   {latest.review&&['applied','reviewed','needs-attention'].includes(latest.status)&&<><p>{latest.review.summary}</p><p>{latest.review.outcome}</p><details><summary>Review details</summary><p>{latest.review.interpretation}</p></details></>}
   {latest.error&&<p className="warning" role="alert">{latest.error} {['pending','failed','needs-attention'].includes(latest.status)&&<button type="button" disabled={busy} onClick={()=>reviewAction(latest.id,'retry')}>Retry Review</button>}</p>}
  </div>}
  {ratings.length>0&&<details className="rating-history"><summary>Rating History ({ratings.length})</summary>{ratings.map(r=><div key={r.id}><strong>{r.userScore.toFixed(1)} / 5</strong> · <time dateTime={r.at}>{new Date(r.at).toLocaleString()}</time>{r.origin==='chat'&&' · Imported from chat'}<p>{r.reason}</p><small>App: {r.appScore.toFixed(1)} · {statusText(r)}</small>{r.error&&<p>{r.error}</p>}{['pending','failed','needs-attention'].includes(r.status)&&<button type="button" disabled={busy} onClick={()=>reviewAction(r.id,'retry')}>Retry review</button>}{r.canUndo&&<button type="button" disabled={busy} onClick={()=>reviewAction(r.id,'undo')}>Undo scoring change</button>}</div>)}</details>}
 </section>;
}
