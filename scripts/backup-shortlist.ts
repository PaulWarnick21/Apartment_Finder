import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {shortlistBackup} from '../server/shortlist-backup.ts';

const destination=resolve(process.argv[2]??`data/backups/shortlist-${Date.now()}.json`);
const snapshot=shortlistBackup(resolve('data/live/apartments.sqlite'));
const bytes=Buffer.from(JSON.stringify(snapshot,null,2)+'\n');
await mkdir(dirname(destination),{recursive:true});
await writeFile(destination,bytes,{flag:'wx'});
if(!(await readFile(destination)).equals(bytes))throw new Error('Shortlist backup verification failed');
console.log(JSON.stringify({destination,apartments:snapshot.apartments.length,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),uploaded:false}));
