import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {sources} from '../server/sources.ts';
import {readQueue} from '../server/discovery-queue.ts';
import {inventoryRoutes} from '../server/inventory-discovery.ts';
import {areaSearchRoutes,sourceFilteredIntake} from '../server/search-area.ts';
import type {Store} from '../server/db.ts';
import type {Listing} from '../src/domain.ts';
import {criteriaSchema} from '../src/domain.ts';

// Read-only audit. No Store constructor, migrations, browser, network or model calls.
const [database='data/live/apartments.sqlite',output='data/live/source-health-audit.json',since=new Date(Date.now()-86400000).toISOString()]=process.argv.slice(2);
if(!Number.isFinite(Date.parse(since)))throw Error('Invalid audit start time');
if(resolve(database)===resolve(output))throw Error('Audit output cannot replace the database');
const db=new DatabaseSync(database,{readOnly:true});
try{
 db.exec('BEGIN');
 const get=<T>(key:string):T|undefined=>{const row=db.prepare('SELECT value FROM meta WHERE key=?').get(key) as {value:string}|undefined;return row?JSON.parse(row.value):undefined;};
 // These read helpers only use get(); never expose a mutating store instance.
 const reader={get,criteria:criteriaSchema.parse(get('criteria')??{})} as Store;
 const homes=(db.prepare('SELECT id,listing,first_seen FROM homes').all() as {id:number;listing:string;first_seen:string}[]).map(h=>({...h,listing:JSON.parse(h.listing) as Listing}));
 const scans=db.prepare("SELECT p.id,p.created_at,p.state,m.value FROM plans p JOIN meta m ON m.key='sourceResults:'||p.id WHERE COALESCE(json_array_length(json_extract(p.caps,'$.fullReviewHomeIds')),0)=0 AND COALESCE(json_extract(p.caps,'$.purpose'),'listings')='listings' ORDER BY p.created_at DESC").all() as {id:string;created_at:string;state:string;value:string}[];
 const last=new Map<string,unknown>();
 for(const plan of scans)for(const result of JSON.parse(plan.value))if(result.state!=='pending'&&!last.has(result.source))last.set(result.source,{planId:plan.id,at:plan.created_at,...result});
 const report={capturedAt:new Date().toISOString(),since,readOnly:true,activePlans:db.prepare("SELECT id,state,created_at FROM plans WHERE state IN ('running','approved')").all(),sources:sources.map(source=>{
  const homesHere=homes.filter(h=>h.listing.source===source.id),fresh=homesHere.filter(h=>Date.parse(h.first_seen)>=Date.parse(since));
  const raw=get<{urls:string[];offerings?:unknown[]}>(`discoveryQueue:${source.id}`),queue=readQueue(reader,source.id);
  const routes=areaSearchRoutes(reader,source.id),needsFilter=sourceFilteredIntake(reader)&&!routes.length;
  const health=db.prepare('SELECT * FROM source_health WHERE source=?').get(source.id) as {paused_until?:string;needs_attention?:number;reason?:string}|undefined;
  return {source:source.id,name:source.name,needsFilter,paused:!!health&&(!!health.needs_attention||Date.parse(health.paused_until??'')>Date.now()),health,
   savedPrimaryRecords:homesHere.length,newPrimaryRecords:fresh.length,newPrimaryRecordsWithSavedPhotos:fresh.filter(h=>h.listing.photos.some(p=>p.local)).length,
   lastNewAt:homesHere.map(h=>h.first_seen).sort().at(-1),configuredRoutes:routes,queuedRaw:(raw?.urls.length??0)+(raw?.offerings?.length??0),queuedInScope:queue.urls.length+(queue.offerings?.length??0),
   lastDiscovery:get(`discoverySummary:${source.id}`),latestIntakeAttempt:last.get(source.id),inventory:inventoryRoutes(reader,source),
   candidateFailures:get(`candidateFailures:${source.id}`)??[]};
 }),countNote:'New records and records with photos are not counts of eligible apartments. Primary source avoids counting cross-postings twice. Old discovery outcomes are historical evidence; no current website access is implied.'};
 db.exec('COMMIT');mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2));
 console.log(JSON.stringify({report:resolve(output),capturedAt:report.capturedAt,sources:report.sources.map(s=>({source:s.source,needsFilter:s.needsFilter,paused:s.paused,newWithPhotos:s.newPrimaryRecordsWithSavedPhotos,queuedInScope:s.queuedInScope}))},null,2));
}finally{db.close();}
