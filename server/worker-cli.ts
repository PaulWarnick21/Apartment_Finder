import {Store} from './db.ts';
import {resolve} from 'node:path';
import {runRegularPlan} from './regular-worker.ts';
import {chromeIpcClient} from './scan-process.ts';
import type {ChromeJobs} from './chrome-jobs.ts';
import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
if(existsSync('.env'))loadEnvFile('.env');
const id=process.argv[2];
if(!id){console.log('No scan started. Create a capped plan in the app and explicitly approve it first. Recurring scans are disabled.');process.exit(0);}
const dataArg=process.argv.indexOf('--data-dir');
const dir=resolve(dataArg>=0?process.argv[dataArg+1]:'data/live'),store=new Store(resolve(dir,'apartments.sqlite'));
try{await runRegularPlan(store,id,dir,process.argv.includes('--ipc')?chromeIpcClient() as ChromeJobs:undefined);}finally{store.close();if(process.connected)process.disconnect();}
