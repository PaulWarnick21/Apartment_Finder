import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadEnvFile} from 'node:process';
import {Store} from './db.ts';
import {criteriaSchema} from '../src/domain.ts';
import {seedDemo} from './demo.ts';
import {createApp} from './api.ts';
if(existsSync('.env'))loadEnvFile('.env');
const demo=process.argv.includes('--demo'),dev=process.argv.includes('--dev');
const dataDir=resolve('data',demo?'demo':'live');mkdirSync(dataDir,{recursive:true});
const store=new Store(resolve(dataDir,'apartments.sqlite'));
if(!demo&&existsSync('private/settings.json')&&!store.get('privateImported')){store.set('criteria',criteriaSchema.parse(JSON.parse(readFileSync('private/settings.json','utf8'))));store.set('privateImported',true);}
if(!demo&&!store.get('idsReserved')){store.db.prepare("INSERT INTO sqlite_sequence(name,seq) SELECT 'homes',13 WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='homes')").run();store.set('idsReserved',true);}
if(demo)seedDemo(store);
// Never clear another worker's lock or resume work on startup. Interrupted scans
// remain locked until the user explicitly recovers them in Activity.
const app=createApp(store,dataDir,{demo,dev});const port=Number(process.env.PORT??(demo?4318:4317));
app.server.listen(port,'127.0.0.1',()=>console.log(`Apartment Finder: http://127.0.0.1:${port}\n${demo?'DEMO fixtures only.':'Live scanning is OFF until you approve a bounded plan.'}`));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void app.close().then(()=>{store.close();process.exit(0);});});
