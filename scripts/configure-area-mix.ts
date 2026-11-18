import {readFileSync} from 'node:fs';
import {Store} from '../server/db.ts';
import {areaMixSettings,updateAreaMixSettings} from '../server/area-mix-settings.ts';

const [database,configuration]=process.argv.slice(2);
if(!database||!configuration)throw Error('Usage: configure-area-mix.ts <database> <private configuration.json>');
const input=JSON.parse(readFileSync(configuration,'utf8')) as {downtownPercent:number};
const store=new Store(database);
try{console.log(JSON.stringify({...updateAreaMixSettings(store,{revision:areaMixSettings(store).revision,downtownPercent:input.downtownPercent}),scansStarted:0}));}finally{store.close();}
