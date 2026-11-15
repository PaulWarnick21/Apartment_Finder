import {Store} from '../server/db.ts';
import {resolve} from 'node:path';
import {createFullBackup} from '../server/full-backup.ts';
const store=new Store(resolve('data/live/apartments.sqlite'));
try{const destination=resolve(`data/backups/apartments-${Date.now()}`);console.log(await createFullBackup(store,resolve('data/live'),destination));}finally{store.close();}
