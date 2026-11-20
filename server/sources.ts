export type Source={assetHosts?:string[];dailyImages?:number;visibleChrome?:boolean;id:string;name:string;hosts:string[];mediaHosts:string[];search:string;adapter:'craigslist'|'vada'|'apartments'|'captured'|'pending';status:string;coverageScope?:string;unvalidatedExpansion?:string[];expandedSearches?:string[];coverageTrial?:boolean};
export const sources:Source[]=[
 {id:'apartments',name:'Apartments.com',hosts:['www.apartments.com'],mediaHosts:['images1.apartments.com'],search:'https://www.apartments.com/condos/vancouver-bc/',adapter:'apartments',status:'Chrome extension · capped validation'},
 {id:'craigslist',name:'Craigslist',hosts:['vancouver.craigslist.org','www.craigslist.org'],mediaHosts:['images.craigslist.org'],search:'https://www.craigslist.org/search/area/vancouver?cat=apa',adapter:'craigslist',status:'Ready for capped validation'},
 {id:'vada',name:'VADA',hosts:['vadapm.com'],mediaHosts:['vadapm.com'],search:'https://vadapm.com/search/for-rent/vancouver',adapter:'vada',status:'Needs live validation'},
 ...[['zillow','Zillow','www.zillow.com'],['zumper','Zumper','www.zumper.com'],['facebook','Facebook Marketplace','www.facebook.com'],['rew','REW','www.rew.ca'],['kijiji','Kijiji','www.kijiji.ca'],['hollyburn','Hollyburn','www.hollyburn.com'],['austeville','Austeville','www.austeville.com'],['easyrent','EasyRent','www.easyrent.ca'],['sunstar','Sunstar','www.mybcrental.com']].map(([id,name,host])=>({id,name,hosts:[host],mediaHosts:[host],search:`https://${host}/`,adapter:'pending' as const,status:'Awaiting adapter validation'}))
];
for(const [id,host] of [['kijiji','media.kijiji.ca'],['hollyburn','portal.hollyburn.com'],['zumper','img.zumpercdn.com']])sources.find(s=>s.id===id)!.mediaHosts.push(host);
// Three captured Zumper galleries contain 119 images; bounded sequential trial media allowance.
sources.find(s=>s.id==='zumper')!.dailyImages=150;
sources.find(s=>s.id==='apartments')!.dailyImages=150;
const searches:Record<string,string>={zillow:'https://www.zillow.com/vancouver-bc/rentals/',zumper:'https://www.zumper.com/apartments-for-rent/vancouver-bc',facebook:'https://www.facebook.com/marketplace/vancouver/propertyrentals/',rew:'https://www.rew.ca/rentals/areas/vancouver-bc',kijiji:'https://www.kijiji.ca/b-apartments-condos/vancouver/apartment__condo/c37l1700287a29276001',hollyburn:'https://www.hollyburn.com/furnished-rental-suites/',austeville:'https://www.austeville.com/vacancies/',easyrent:'https://www.easyrent.ca/listings/',sunstar:'https://www.mybcrental.com/property_downtown.htm'};
for(const source of sources){if(searches[source.id])Object.assign(source,{search:searches[source.id],adapter:'captured',status:'Connected to approved scans; live access checked during each run'});source.visibleChrome=['craigslist','zillow','rew','facebook'].includes(source.id);}
sources.find(s=>s.id==='zillow')!.mediaHosts.push('photos.zillowstatic.com');
sources.find(s=>s.id==='rew')!.mediaHosts.push('assets-listings.rew.ca');
sources.find(s=>s.id==='facebook')!.mediaHosts.push('*.fbcdn.net');
// Rendering dependencies observed in the November 16 inventory captures. These do
// not expand allowed listing or photo hosts, or permit bypassing access challenges.
sources.find(s=>s.id==='kijiji')!.assetHosts=['webapp-static.ca-kijiji-production.classifiedscloud.io'];
// Every application script in the saved Zumper search comes from this CDN.
// Blocking it leaves only 25 SSR rows while Next advances by 50 results.
sources.find(s=>s.id==='zumper')!.assetHosts=['d214hhm15p4t1d.cloudfront.net'];
sources.find(s=>s.id==='hollyburn')!.assetHosts=['cdnjs.cloudflare.com','maps.googleapis.com','maps.gstatic.com'];
// The saved vacancies page includes Google Maps before its dynamic property-search app.
sources.find(s=>s.id==='austeville')!.assetHosts=['maps.googleapis.com','maps.gstatic.com'];
// These limitations are explicit. Broader routes are not silently enabled or claimed as tested.
Object.assign(sources.find(s=>s.id==='apartments')!,{coverageScope:'Vancouver condo search; broader apartment categories require validation.',unvalidatedExpansion:['Vancouver apartment buildings and non-condo rentals','Exceptional nearby municipalities']});
Object.assign(sources.find(s=>s.id==='hollyburn')!,{coverageScope:'Furnished inventory; advertised cities outside Metro Vancouver are filtered.',unvalidatedExpansion:['Vancouver unfurnished unit inventory']});
Object.assign(sources.find(s=>s.id==='sunstar')!,{coverageScope:'Downtown portfolio page only.',unvalidatedExpansion:['Other Vancouver and nearby-area portfolio pages']});
Object.assign(sources.find(s=>s.id==='zumper')!,{coverageScope:'Vancouver search; all advertised floorplan offerings are retained separately as unit-unverified.'});
// Advertised links preserved in the November 14 captures. They are opt-in trials, not claimed coverage.
sources.find(s=>s.id==='apartments')!.expandedSearches=['https://www.apartments.com/vancouver-bc/1-bedrooms/','https://www.apartments.com/vancouver-bc/2-bedrooms/','https://www.apartments.com/vancouver-bc/'];
sources.find(s=>s.id==='hollyburn')!.expandedSearches=['https://www.hollyburn.com/find-an-apartment/?city=Vancouver'];
export function expandedSource(source:Source,index=0):Source{return source.expandedSearches?.length?{...source,search:source.expandedSearches[index%source.expandedSearches.length],coverageTrial:true}:source;}
export function sourceById(id:string){const s=sources.find(s=>s.id===id);if(!s)throw new Error('Unknown or excluded source');return s;}
export function allowedUrl(url:string,hosts:string[]){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&hosts.some(host=>host.startsWith('*.')?u.hostname.endsWith(host.slice(1)):u.hostname===host);}catch{return false;}}
