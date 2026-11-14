import type {Home} from './domain';
export function SourceBadges({postings,sources}:{postings:Home['postings'];sources:{id:string;name:string}[]}){
 return <span className="source-badges" aria-label="Listing Sources">{[...new Set(postings.map(p=>p.source))].map(id=><span className="source-badge" key={id}>{sources.find(s=>s.id===id)?.name??id}</span>)}</span>;
}
