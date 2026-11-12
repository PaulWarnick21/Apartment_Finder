import {listingSchema,criteriaSchema} from '../src/domain.ts';
import {Store} from './db.ts';
export function seedDemo(store:Store){if(store.homes().length)return;const common={source:'demo',url:'https://example.com/fictional-apartment',rent:2400,beds:1,laundry:'in-unit',parking:'included',parkingCount:1,location:'preferred',area:'Coal Harbour',furnished:false,internet:'Unknown',galleryComplete:false,description:'Fictional fixture for testing the Sorting Desk. This is not a rental listing. No website was contacted.',evidence:{demo:'Synthetic development data; photos and availability are not real.'}};
 const examples=[{...common,sourceId:'demo-1',title:'A little closer to the mountains',address:'Sample Harbour Residence',unit:'1204',sqft:680,workspace:true,gas:true,modern:true,north:true,lease:'6 months',shortLease:true,available:'Demo only'},
 {...common,sourceId:'demo-2',title:'Room to make yourself at home',address:'Sample West End Apartments',unit:'706',area:'West End',rent:2650,sqft:730,openPlan:true,modern:true,parking:'extra',parkingCost:100,laundry:'unknown',available:'Demo only'},
 {...common,sourceId:'demo-3',title:'A different view of the city',address:'Sample Station House',unit:'1802',area:'Port Moody',rent:2100,location:'near-transit',sqft:625,workspace:true,available:'Demo only'},
 {...common,sourceId:'demo-4',title:'The laundry check matters',address:'Sample Bay Apartments',unit:'304',laundry:'shared-only',rent:2200,area:'West End',available:'Demo only'}];
 store.set('criteria',criteriaSchema.parse({requireLaundry:true}));
 for(const sample of examples)store.ingest(listingSchema.parse(sample));store.event('Demo fixtures loaded locally. No listings scanned and no AI calls made.');}
