export type Source={dailyImages?:number;id:string;name:string;hosts:string[];mediaHosts:string[];search:string;adapter:'craigslist'|'vada'|'apartments'|'pending';status:string};
export const sources:Source[]=[
 {id:'apartments',name:'Apartments.com',hosts:['www.apartments.com'],mediaHosts:['images1.apartments.com'],search:'https://www.apartments.com/condos/vancouver-bc/',adapter:'apartments',status:'Chrome extension · capped validation'},
 {id:'craigslist',name:'Craigslist',hosts:['vancouver.craigslist.org','www.craigslist.org'],mediaHosts:['images.craigslist.org'],search:'https://vancouver.craigslist.org/search/apa',adapter:'craigslist',status:'Ready for capped validation'},
 {id:'vada',name:'VADA',hosts:['vadapm.com'],mediaHosts:['vadapm.com'],search:'https://vadapm.com/search/for-rent/vancouver',adapter:'vada',status:'Needs live validation'},
 ...[['zillow','Zillow','www.zillow.com'],['zumper','Zumper','www.zumper.com'],['facebook','Facebook Marketplace','www.facebook.com'],['rew','REW','www.rew.ca'],['kijiji','Kijiji','www.kijiji.ca'],['hollyburn','Hollyburn','www.hollyburn.com'],['austeville','Austeville','www.austeville.com'],['easyrent','EasyRent','www.easyrent.ca'],['sunstar','Sunstar','www.mybcrental.com']].map(([id,name,host])=>({id,name,hosts:[host],mediaHosts:[host],search:`https://${host}/`,adapter:'pending' as const,status:'Awaiting adapter validation'}))
];
for(const [id,host] of [['kijiji','media.kijiji.ca'],['hollyburn','portal.hollyburn.com'],['zumper','img.zumpercdn.com']])sources.find(s=>s.id===id)!.mediaHosts.push(host);
// Three captured Zumper galleries contain 119 images; bounded sequential trial media allowance.
sources.find(s=>s.id==='zumper')!.dailyImages=150;
export function sourceById(id:string){const s=sources.find(s=>s.id===id);if(!s)throw new Error('Unknown or excluded source');return s;}
export function allowedUrl(url:string,hosts:string[]){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&hosts.includes(u.hostname);}catch{return false;}}
