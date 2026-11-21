import type {Home} from './domain';

export function AvailabilityStatus({home,details=false}:{home:Home;details?:boolean}){
 const status=home.availability;
 if(!status)return null;
 if(status.status==='available'&&!details)return null;
 const closed=status.postings.filter(p=>p.status==='unavailable');
 if(status.status!=='unavailable'&&!closed.length)return null;
 const unavailable=status.status==='unavailable';
 const checkedAt=unavailable?status.checkedAt:closed.map(p=>p.checkedAt).sort().at(-1)!;
 return <div className={`availability-status ${unavailable?'availability-unavailable':status.status==='available'?'availability-available':'availability-unknown'}`} role="status">
  <strong>{unavailable?'Unavailable':status.status==='available'?'Still advertised elsewhere':'Other postings need verification'}</strong><small>Checked {new Date(status.status==='available'?status.checkedAt:checkedAt).toLocaleString()}</small>
  {!unavailable&&<p>{status.status==='available'?'The expired posting has been superseded by a live listing of the same apartment.':'A saved posting expired; the apartment is not confirmed unavailable while other sources are being checked.'}</p>}
  {details?<><p>{status.detail}</p><ul>{status.postings.map(p=><li key={`${p.source}:${p.sourceId}`}><a href={p.url} target="_blank" rel="noreferrer">{p.source}</a>: {p.status==='available'?'still listed':p.status==='unavailable'?'unavailable':'unverified'} — {p.evidence}</li>)}</ul></>:null}
 </div>;
}
