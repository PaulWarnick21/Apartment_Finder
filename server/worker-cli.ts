import {Store} from './db.ts';
import {resolve} from 'node:path';
import {runPlan} from './worker.ts';
import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
if(existsSync('.env'))loadEnvFile('.env');
const id=process.argv[2];
if(!id){console.log('No scan started. Create a capped plan in the app and explicitly approve it first. Recurring scans are disabled.');process.exit(0);}
const dir=resolve('data/live'),store=new Store(resolve(dir,'apartments.sqlite'));
try{await runPlan(store,id,dir);}finally{store.close();}
