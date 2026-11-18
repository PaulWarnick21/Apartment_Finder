import type {Decision} from './decision-queue';

export function DecisionStatus({entries,retry,dismiss}:{entries:Decision[];retry:(id:number)=>void;dismiss:(id:number)=>void}){
 const failed=entries.filter(entry=>entry.status==='failed');
 if(!failed.length)return null;
 return <aside id="decision-save-errors" className="decision-status" aria-label="Decision saves">
  {failed.map(entry=><div className="decision-save-error" role="alert" key={entry.home.id}>
   <p><strong>Apartment #{entry.home.id}: {entry.stage} wasn’t confirmed.</strong> {entry.error}</p>
   <button onClick={()=>retry(entry.home.id)}>Retry Save</button><button onClick={()=>dismiss(entry.home.id)}>Keep Current State</button>
  </div>)}
 </aside>;
}
