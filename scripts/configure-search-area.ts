import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {z} from 'zod';
import type {SearchAreaPolicy} from '../server/search-area.ts';

// Local configuration only: this never opens a source or starts a worker.
const [database,preferences]=process.argv.slice(2);
if(!database||!preferences)throw new Error('Usage: configure-search-area.ts <database.sqlite> <private-preferences.json>');
const input=z.object({regions:z.array(z.enum(['downtown-vancouver','west-vancouver','north-vancouver']))}).parse(JSON.parse(readFileSync(resolve(preferences),'utf8')));
const db=new DatabaseSync(resolve(database));
try{
 db.exec('BEGIN IMMEDIATE');
 if(db.prepare("SELECT 1 FROM plans WHERE state IN ('approved','running') LIMIT 1").get())throw new Error('Wait until the active or approved scan is finished before changing the search area.');
 if(db.prepare("SELECT 1 FROM meta WHERE key LIKE 'fullReview:%' AND json_extract(value,'$.status') IN ('queued','running') LIMIT 1").get())throw new Error('Wait until the active apartment assessment is finished.');
 const row=db.prepare("SELECT value FROM meta WHERE key='searchAreaPolicy'").get() as {value:string}|undefined;
 const previous=row?JSON.parse(row.value) as SearchAreaPolicy:undefined;
 const existingHomeIds=previous?.existingHomeIds??(db.prepare('SELECT id FROM homes').all() as {id:number}[]).map(home=>home.id);
 const policy:SearchAreaPolicy={regions:[...new Set(input.regions)],existingHomeIds,configuredAt:new Date().toISOString()};
 db.prepare("INSERT INTO meta(key,value) VALUES ('searchAreaPolicy',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(policy));
 db.exec('COMMIT');
 console.log(JSON.stringify({configured:true,regions:policy.regions,existingApartmentsPreserved:existingHomeIds.length,scansStarted:0}));
}catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
