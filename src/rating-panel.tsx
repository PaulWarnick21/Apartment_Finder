import {useEffect,useRef,useState} from 'react';
import type {RatingFeedback} from './rating-types';
import type {Stage} from './stage-transitions';
type Props={homeId:number;appScore:number;request:(path:string,method?:string,body?:unknown)=>Promise<any>;onChanged:()=>Promise<void>;decisions?:{stage:Stage;label:string}[];onDecision?:(stage:Stage)=>Promise<void>};
const statusLabel:Record<RatingFeedback['status'],string>={pending:'Saved · queued for automatic review',reviewing:'Reviewing your feedback…',reviewed:'Reviewed · preferences unchanged',applied:'Reviewed · scoring updated',failed:'Saved · review needs retry',reverted:'Scoring change undone','needs-attention':'Reviewed · attention needed'};
const statusText=(rating:RatingFeedback)=>rating.status==='pending'&&rating.error?'Saved · review is waiting':statusLabel[rating.status];
export function RatingPanel({homeId,request,onChanged,decisions=[],onDecision}:Props){
 const [score,setScore]=useState(''),[reason,setReason]=useState(''),[ratings,setRatings]=useState<RatingFeedback[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const initialized=useRef(false),touched=useRef(false),submission=useRef<{id:string;score:number;reason:string}|null>(null);
 const requestRef=useRef(request);requestRef.current=request;
 const changedRef=useRef(onChanged);changedRef.current=onChanged;const previous=useRef('');
 async function accept(ratings:RatingFeedback[]){setRatings(ratings);const signature=JSON.stringify(ratings);if(signature!==previous.current){previous.current=signature;await changedRef.current();}}
 async function refresh(){const data=await requestRef.current(`homes/${homeId}/ratings`);await accept(data.ratings);return data.ratings as RatingFeedback[];}
 useEffect(()=>{let active=true;initialized.current=false;
  async function load(){try{const data=await requestRef.current(`homes/${homeId}/ratings`);if(!active)return;await accept(data.ratings);if(!active)return;if(!initialized.current){initialized.current=true;if(data.ratings[0]&&!touched.current){setScore(String(data.ratings[0].userScore));setReason(data.ratings[0].reason);}}}catch(e){if(active)setError(String(e).replace(/^Error: /,''));}}
  void load();const timer=setInterval(load,3000);return()=>{active=false;clearInterval(timer);};
 },[homeId]);
 async function submit(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError('');setNotice('');
  try{await saveRating();setNotice('Rating saved. Review progress and results appear below.');
  }catch(e){setError(String(e).replace(/^Error: /,''));}finally{setBusy(false);}
 }
 async function saveRating(){const value=Number(score),text=reason.trim();if(!score.trim()||!Number.isFinite(value)||value<.1||value>5||Math.abs(value*10-Math.round(value*10))>1e-8||text.length<3||text.length>2000)throw new Error('Enter a score from 0.1 to 5 and a reason of at least three characters before moving this apartment. Your draft is still here.');if(!submission.current||submission.current.score!==value||submission.current.reason!==text)submission.current={id:crypto.randomUUID(),score:value,reason:text};await requestRef.current(`homes/${homeId}/ratings`,'POST',{requestId:submission.current.id,score:value,reason:text});await refresh();submission.current=null;}
 async function decide(stage:Stage){if(busy||!onDecision)return;setBusy(true);setError('');try{const latest=ratings[0],hasDraft=!!score.trim()||!!reason.trim(),changed=!latest||Number(score)!==latest.userScore||reason.trim()!==latest.reason;if(hasDraft&&changed)await saveRating();await onDecision(stage);}catch(e){setError(String(e).replace(/^Error: /,''));}finally{setBusy(false);}}
 async function reviewAction(id:number,action:'retry'|'undo'){setBusy(true);setError('');try{await requestRef.current(`ratings/${id}/${action}`,'POST',{});await refresh();setNotice(action==='undo'?'Scoring change undone; your feedback is kept.':'Review queued.');}catch(e){setError(String(e).replace(/^Error: /,''));}finally{setBusy(false);}}
 const latest=ratings[0];
 return <section className="rating-panel" aria-label="Your apartment rating"><h3>Your Rating</h3>
  <form onSubmit={submit}><div className="rating-inputs"><label>Your Score<input aria-label="Your Score" type="number" min="0.1" max="5" step="0.1" required value={score} onChange={e=>{touched.current=true;setScore(e.target.value);}} placeholder="3.5"/></label><label>Reason for Your Score<textarea aria-label="Reason for Your Score" rows={1} minLength={3} maxLength={2000} required value={reason} onChange={e=>{touched.current=true;setReason(e.target.value);}} placeholder="What makes this a good or poor match for you?"/></label></div><div className="rating-actions"><button disabled={busy}>{busy?'Saving…':'Submit Rating'}</button>{decisions.map(d=><button type="button" key={d.stage} className={d.stage==='Interested'?'primary':''} disabled={busy} onClick={()=>decide(d.stage)}>{d.label}</button>)}</div></form>
  {error&&<p className="warning" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {latest&&<div className="rating-result" aria-label="Feedback review"><p role="status"><strong>{statusText(latest)}</strong></p>
   {latest.calibrationApplied&&<p>Your rating is already included in scoring.</p>}
   {latest.review&&['applied','reviewed','needs-attention'].includes(latest.status)&&<><p>{latest.review.summary}</p><p>{latest.review.outcome}</p><details><summary>Review details</summary><p>{latest.review.interpretation}</p></details></>}
   {latest.error&&<p className="warning" role="alert">{latest.error} {['pending','failed','needs-attention'].includes(latest.status)&&<button type="button" disabled={busy} onClick={()=>reviewAction(latest.id,'retry')}>Retry Review</button>}</p>}
  </div>}
  {ratings.length>0&&<details className="rating-history"><summary>Rating History ({ratings.length})</summary>{ratings.map(r=><div key={r.id}><strong>{r.userScore.toFixed(1)} / 5</strong> · <time dateTime={r.at}>{new Date(r.at).toLocaleString()}</time>{r.origin==='chat'&&' · Imported from chat'}<p>{r.reason}</p><small>App: {r.appScore.toFixed(1)} · {statusText(r)}</small>{r.error&&<p>{r.error}</p>}{['pending','failed','needs-attention'].includes(r.status)&&<button type="button" disabled={busy} onClick={()=>reviewAction(r.id,'retry')}>Retry review</button>}{r.canUndo&&<button type="button" disabled={busy} onClick={()=>reviewAction(r.id,'undo')}>Undo scoring change</button>}</div>)}</details>}
 </section>;
}
