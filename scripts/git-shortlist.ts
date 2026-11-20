import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {shortlistBackup} from '../server/shortlist-backup.ts';

const git=(args:string[])=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024});
const root=git(['rev-parse','--show-toplevel']).trim();
process.chdir(root);
const file='backups/shortlist.json';
// Missing/unreadable databases must fail, never replace a saved shortlist with an invented empty one.
const snapshot=shortlistBackup(resolve('data/live/apartments.sqlite'));
const comparable=(value:ReturnType<typeof shortlistBackup>)=>{const {exportedAt,...data}=value;return JSON.stringify(data);};
const mode=process.argv[2];
if(mode==='commit'||mode==='refresh'){
 const destination=resolve(file),temporary=destination+'.'+randomUUID()+'.tmp';
 mkdirSync(dirname(destination),{recursive:true});
 const bytes=Buffer.from(JSON.stringify(snapshot,null,2)+'\n');
 try{writeFileSync(temporary,bytes,{flag:'wx'});if(!readFileSync(temporary).equals(bytes))throw new Error('Backup write verification failed');renameSync(temporary,destination);}finally{rmSync(temporary,{force:true});}
 if(mode==='commit')git(['add','--',file]);
 console.log(`Shortlist backup refreshed: ${snapshot.apartments.length} apartments, ${bytes.length} bytes${mode==='commit'?'; staged for this commit':''}.`);
}else if(mode==='push'){
 const refs=readFileSync(0,'utf8').trim().split(/\r?\n/).filter(Boolean).map(line=>line.split(/\s+/)[1]).filter(sha=>!/^0+$/.test(sha));
 if(!refs.length)refs.push(git(['rev-parse','HEAD']).trim());
 for(const sha of new Set(refs)){
  if(!/^[a-f0-9]{40,64}$/.test(sha))throw new Error('Unrecognized push reference');
  let committed:ReturnType<typeof shortlistBackup>;
  try{committed=JSON.parse(git(['show',`${sha}:${file}`]));}catch{throw new Error('Push blocked: outgoing commit has no readable shortlist backup. Make a commit with hooks enabled first.');}
  if(comparable(committed)!==comparable(snapshot))throw new Error('Push blocked: saved apartments changed since the outgoing backup. Run git commit --allow-empty -m "Refresh shortlist backup", then push again.');
 }
 console.log('Outgoing shortlist backup matches the saved apartments.');
}else throw new Error('Usage: tsx scripts/git-shortlist.ts commit|refresh|push');
