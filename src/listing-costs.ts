import type {Listing} from './domain';
export type MonthlyCharge={label:string;amount:number;evidence:string};
/** Display only. The user's unresolved ceiling basis is not changed by this estimate. */
export function recurringCosts(listing:Listing){
 const rent=listing.rent!==null&&listing.rent>1&&listing.evidence.rentPlaceholder!=='true'?listing.rent:null;
 const charges:MonthlyCharge[]=[];
 if(listing.parking==='extra'&&listing.parkingCost!==null)charges.push({label:'Parking',amount:listing.parkingCost,evidence:listing.evidence.parking??'Advertised parking fee'});
 for(const charge of listing.monthlyCharges??[])if(!charges.some(c=>c.label.toLowerCase()===charge.label.toLowerCase()&&c.amount===charge.amount))charges.push(charge);
 const unknown:string[]=[];
 if(rent===null)unknown.push('Base rent');
 if(listing.parking==='unknown'||listing.parking==='extra'&&listing.parkingCost===null)unknown.push('Parking cost');
 if(listing.evidence.monthlyCostsComplete!=='true')unknown.push('Other required monthly charges');
 if(listing.internet==='Unknown')unknown.push('Internet cost');
 const total=rent===null?null:rent+charges.reduce((sum,c)=>sum+c.amount,0);
 return {rent,charges,knownMonthlyTotal:total,unknown,complete:unknown.length===0};
}
