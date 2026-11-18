import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {Store} from '../server/db.ts';
import {allowedUrl,sourceById} from '../server/sources.ts';
import type {SearchAreaPolicy} from '../server/search-area.ts';

// Configuration only. Never starts a scan, source request or model request.
const [database,config]=process.argv.slice(2);
if(!database||!config)throw Error('Usage: configure-source-filters.ts <database> <private route configuration>');
const region=z.enum(['downtown-vancouver','north-vancouver','west-vancouver']);
const input=z.object({regions:z.array(region).min(1),sourceRoutes:z.record(z.string(),z.array(z.object({url:z.url(),region})))})
 .parse(JSON.parse(readFileSync(config,'utf8')));
for(const [source,routes] of Object.entries(input.sourceRoutes))for(const route of routes)if(!allowedUrl(route.url,sourceById(source).hosts))throw Error('Source route host mismatch');
const store=new Store(database);
try{store.transaction(()=>{
 if(store.db.prepare('SELECT 1 FROM scan_lock').get()||store.db.prepare("SELECT 1 FROM plans WHERE state IN ('running','approved')").get())throw Error('Finish or cancel the active batch before configuring filters');
 const previous=store.get<SearchAreaPolicy>('searchAreaPolicy'),homes=store.homes();
 for(const home of homes)if(home.quickRank&&!store.get(`preservedQuickRank:${home.id}`))store.set(`preservedQuickRank:${home.id}`,home.quickRank);
 const existingHomeIds=[...new Set([...(previous?.existingHomeIds??[]),...homes.filter(h=>!h.deskExclusion&&h.quickRank?.eligible).map(h=>h.id)])];
 store.set('searchAreaPolicy',{...input,mode:'source-filters',configuredAt:new Date().toISOString(),existingHomeIds} satisfies SearchAreaPolicy);
 store.event('Quick intake now uses website geographic search filters without address lookups. Existing ranks and decisions preserved; scan scheduling unchanged.');
 console.log(JSON.stringify({mode:'source-filters',sources:Object.keys(input.sourceRoutes),preservedRanks:homes.length}));
});}finally{store.close();}
