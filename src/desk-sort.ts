import type {Home} from './domain';
export function compareHomes(a:Home,b:Home,tab:string,sort:string){
 if(tab==='Excluded'||tab==='Closed')return Date.parse(b.categoryEnteredAt??b.firstSeen)-Date.parse(a.categoryEnteredAt??a.firstSeen)||b.id-a.id;
 return sort==='rent'?(a.listing.rent??Infinity)-(b.listing.rent??Infinity):sort==='recent'?b.id-a.id:b.score.value-a.score.value;
}
