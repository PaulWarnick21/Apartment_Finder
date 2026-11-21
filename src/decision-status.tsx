import type {Decision} from './decision-queue';

type DecisionNoticeProps={entry:Decision;retry:(id:number)=>void;dismiss:(id:number)=>void};
export function DecisionSaveNotice({entry,retry,dismiss}:DecisionNoticeProps){
 const label=entry.edits.revisitLater===undefined?entry.stage:entry.edits.revisitLater?'Revisit Later':'Review Now';
 if(entry.status==='saved')return null;
 if(entry.status!=='failed')return <p className="footnote" role="status">{entry.status==='queued'?'Waiting to save':'Saving'} your {entry.rating?'rating and ':''}“{label}” decision… You can keep reviewing other apartments.</p>;
 return <div className="decision-save-error" role="alert">
  <p><strong>Apartment #{entry.home.id}: {label} wasn’t confirmed.</strong> {entry.error}</p>
  {entry.rating&&<p className="prewrap"><strong>{entry.ratingSaved?'Rating saved':'Rating retained for retry'}: {entry.rating.score.toFixed(1)} / 5.</strong> {entry.rating.reason}</p>}
  <p className="footnote">Retry checks whether it saved before trying again. Other apartments are ready to review.</p>
  <button onClick={()=>retry(entry.home.id)}>Retry Save</button><button onClick={()=>dismiss(entry.home.id)}>Keep Current State</button>
 </div>;
}

export function DecisionStatus({entries,retry,dismiss}:{entries:Decision[];retry:(id:number)=>void;dismiss:(id:number)=>void}){
 const failed=entries.filter(entry=>entry.status==='failed');
 if(!failed.length)return null;
 return <aside id="decision-save-errors" className="decision-status" aria-label="Decision saves">
  {failed.map(entry=><DecisionSaveNotice key={entry.home.id} entry={entry} retry={retry} dismiss={dismiss}/>)}
 </aside>;
}
