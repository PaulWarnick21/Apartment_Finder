import type {Home} from './domain';

export function AvailabilityStatus({home,details=false}:{home:Home;details?:boolean}){
 const status=home.availability;
 if(status?.status!=='unavailable')return null;
 return <div className="availability-status availability-unavailable" role="status">
  <strong>Unavailable</strong><small>Checked {new Date(status.checkedAt).toLocaleString()}</small>
  {details?<><p>{status.detail}</p><ul>{status.postings.map(p=><li key={`${p.source}:${p.sourceId}`}><a href={p.url} target="_blank" rel="noreferrer">{p.source}</a>: {p.status==='available'?'still listed':p.status==='unavailable'?'unavailable':'unverified'} — {p.evidence}</li>)}</ul></>:null}
 </div>;
}
