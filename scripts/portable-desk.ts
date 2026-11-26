import {link,lstat,mkdir,mkdtemp,readFile,rename,rm,rmdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {readPortableDesk,rebuildPortableDesk,writePortableDesk} from '../server/portable-desk.ts';

const [mode,archiveName,...extra]=process.argv.slice(2);
if(!['--export','--verify','--restore'].includes(mode)||extra.length||archiveName?.startsWith('--')){
 throw Error('Usage: tsx scripts/portable-desk.ts --export|--verify|--restore [backups/desk.json.gz]');
}
const archive=resolve(archiveName??'backups/desk.json.gz'),data=resolve('data'),live=join(data,'live');

if(mode==='--export'){
 const snapshot=writePortableDesk(join(live,'apartments.sqlite'));
 if(!snapshot.homes)throw Error('The live desk is empty. Restore existing data before refreshing the portable backup.');
 await mkdir(dirname(archive),{recursive:true});
 const temp=archive+'.'+randomUUID()+'.tmp';
 try{
  await writeFile(temp,snapshot.bytes,{flag:'wx'});
  readPortableDesk(await readFile(temp));
  await rename(temp,archive);
 }finally{await rm(temp,{force:true});}
 console.log({archive,homes:snapshot.homes,history:snapshot.history,bytes:snapshot.bytes.length});
}else{
 const snapshot=readPortableDesk(await readFile(archive));
 if(mode==='--restore'){
  const occupied='data/live already exists. Restore the portable desk in a fresh clone before starting the app.';
  try{await lstat(live);throw Error(occupied);}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  await mkdir(data,{recursive:true});
  const stage=await mkdtemp(join(data,'portable-desk-'));
  let claimed=false;
  try{
   const database=join(stage,'apartments.sqlite');
   rebuildPortableDesk(snapshot,database);
   try{await mkdir(live);claimed=true;}
   catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw Error(occupied);throw error;}
   await link(database,join(live,'apartments.sqlite'));
  }catch(error){
   if(claimed)await rmdir(live).catch((secondary:NodeJS.ErrnoException)=>{
    // Preserve a database that a concurrently started app created first.
    if(secondary.code!=='ENOTEMPTY'&&secondary.code!=='ENOENT')throw new AggregateError([error,secondary],'Restore and cleanup failed.');
   });
   throw error;
  }finally{await rm(stage,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
 }
 console.log({archive,createdAt:snapshot.createdAt,homes:snapshot.tables.homes.length,history:snapshot.tables.history.length,...(mode==='--restore'?{restoredTo:live,discoveryEnabled:false,availabilityEnabled:false}:{valid:true})});
}
