import {readFile,writeFile} from 'node:fs/promises';
import {extractTrial} from '../server/trial-extraction.ts';
import {sourceById} from '../server/sources.ts';
const dir='data/live/initial-trial',list=[];
for(const source of ['craigslist','vada','kijiji','easyrent','hollyburn','austeville','sunstar'])for(let i=1;i<=3;i++){
 const m=JSON.parse(await readFile(dir+'/'+source+'-detail-'+i+'.json','utf8'));
 const l=extractTrial(await readFile(dir+'/'+source+'-detail-'+i+'.html','utf8'),m.url,sourceById(source),source==='sunstar'?await readFile(dir+'/sunstar-gallery-'+i+'.html','utf8'):undefined);
 l.location='downtown';list.push({source,index:i,listing:l});
}
await writeFile(dir+'/extracted.json',JSON.stringify(list,null,2));
console.log(JSON.stringify(list.map(x=>({source:x.source,i:x.index,title:x.listing.title,rent:x.listing.rent,address:x.listing.address,unit:x.listing.unit,beds:x.listing.beds,laundry:x.listing.laundry,photos:x.listing.photos.length,expected:x.listing.expectedPhotos})),null,2));
