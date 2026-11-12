import {Store} from '../server/db.ts';
import {resolve} from 'node:path';
const store=new Store(resolve('data/live/apartments.sqlite'));
try{const destination=resolve(`data/backups/apartments-${Date.now()}.sqlite`);await store.backupTo(destination);console.log(destination);}finally{store.close();}
