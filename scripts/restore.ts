import {copyFile,link,lstat,mkdir,mkdtemp,rename,rm,rmdir,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {Store} from '../server/db.ts';
import {restoreBackup,verifyBackup} from '../server/full-backup.ts';

async function exists(path:string){
 try{await lstat(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
}

function pauseRestoredWork(path:string){
 const store=new Store(path);
 try{
  store.transaction(()=>{
   for(const key of ['scanSchedule','availabilitySchedule']){
    store.set(key,{...store.get<object>(key),enabled:false});
   }
   const detail='Private backup restored. Saved work retained; retry with a new approval.';
   const now=new Date().toISOString();
   store.db.prepare("UPDATE plans SET state='interrupted',detail=? WHERE state IN ('approved','running')").run(detail);
   store.db.exec('DELETE FROM parallel_scan_members; DELETE FROM scan_lock;');
   store.db.prepare("DELETE FROM meta WHERE key IN ('areaMixClaims','browserExtension','browserExtensionRuntime')").run();
   store.db.prepare(`UPDATE meta SET value=json_set(json_remove(value,'$.waitingForFeedback'),
     '$.status','paused','$.detail',?,'$.updatedAt',?)
     WHERE key GLOB 'fullReview:*' AND (json_extract(value,'$.status') IN ('queued','running')
     OR json_extract(value,'$.waitingForFeedback'))`).run(detail,now);
   store.db.prepare(`UPDATE meta SET value=json_set(value,'$.state','partial','$.detail',?,'$.finishedAt',?)
     WHERE key='availabilityRun' AND json_extract(value,'$.state')='running'`).run(detail,now);
   store.db.prepare("UPDATE rating_feedback SET status='pending',error=? WHERE status='reviewing'").run(detail);
   store.event('Private backup installed. Discovery and availability are off. Reconnect external accounts before approving work.');
  });
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
 }finally{store.close();}
}

async function installBackup(bundle:string){
 const data=resolve('data'),live=join(data,'live'),privateDir=resolve('private');
 const noLive='data/live already exists. Install into a fresh clone before starting the app.';
 if(await exists(live))throw new Error(noLive);
 await mkdir(data,{recursive:true});
 const temp=await mkdtemp(join(data,'restore-'));
 const staged=join(temp,'bundle');
 const clearStage=()=>rm(temp,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 const addedPrivate:string[]=[];
 let claimedLive=false,movedMedia=false,verified:Awaited<ReturnType<typeof restoreBackup>>;
 try{
  verified=await restoreBackup(bundle,staged);
  const database=join(staged,'apartments.sqlite'),media=join(staged,'media');
  const privateFiles:string[]=[];
  for(const name of ['criteria.md','settings.json']){
   if(!await exists(join(staged,'private',name)))continue;
   if(await exists(join(privateDir,name)))throw new Error(`private/${name} already exists; restore cannot overwrite it.`);
   privateFiles.push(name);
  }
  pauseRestoredWork(database);
  try{await mkdir(live);claimedLive=true;}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new Error(noLive);throw error;}
  if(privateFiles.length)await mkdir(privateDir,{recursive:true});
  for(const name of privateFiles){
   const target=join(privateDir,name);
   await copyFile(join(staged,'private',name),target,constants.COPYFILE_EXCL);
   addedPrivate.push(target);
  }
  if(await exists(media)){await rename(media,join(live,'media'));movedMedia=true;}
  // Publish the finished SQLite file atomically without overwriting a new database.
  await link(database,join(live,'apartments.sqlite'));
 }catch(error){
  const cleanup=await Promise.allSettled([
   ...addedPrivate.map(path=>unlink(path)),
   ...(movedMedia?[rename(join(live,'media'),join(staged,'media'))]:[]),
  ]);
  cleanup.push(...await Promise.allSettled([
   clearStage(),
   ...(claimedLive?[rmdir(live).catch((removal:NodeJS.ErrnoException)=>{
    // A concurrently launched app may already have created its own database.
    if(removal.code!=='ENOTEMPTY'&&removal.code!=='ENOENT')throw removal;
   })]:[]),
  ]));
  const failures=cleanup.filter(result=>result.status==='rejected').map(result=>result.reason);
  if(failures.length)throw new AggregateError([error,...failures],'Backup install failed and cleanup was incomplete.');
  throw error;
 }
 await clearStage();
 return {...verified,destination:live,discoveryEnabled:false,availabilityEnabled:false};
}

const [bundle,destination,...extra]=process.argv.slice(2);
if(!bundle||bundle.startsWith('--')||extra.length||destination?.startsWith('--')&&destination!=='--install'){
 throw new Error('Usage: tsx scripts/restore.ts <backup-folder> [--install | new-staging-folder]. Without a destination this only verifies.');
}
console.log(destination==='--install'?await installBackup(resolve(bundle)):destination?await restoreBackup(resolve(bundle),resolve(destination)):await verifyBackup(resolve(bundle)));
