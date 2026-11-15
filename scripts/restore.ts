import {resolve} from 'node:path';
import {restoreBackup,verifyBackup} from '../server/full-backup.ts';
const [bundle,destination]=process.argv.slice(2);
if(!bundle)throw new Error('Usage: tsx scripts/restore.ts <backup-folder> [new-staging-folder]. Without a destination this only verifies.');
console.log(destination?await restoreBackup(resolve(bundle),resolve(destination)):await verifyBackup(resolve(bundle)));
