import {execFile} from 'node:child_process';
import {mkdir,readFile,writeFile,rename,open,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

// Secrets travel over stdin, never command arguments, environment variables or logs.
export function protect(value:string,decrypt=false):Promise<string>{
 if(process.platform!=='win32')throw new Error('ChatGPT credential storage currently requires Windows.');
 const operation=decrypt?'Unprotect':'Protect';
 const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=${decrypt?'[Convert]::FromBase64String($v)':'[Text.Encoding]::UTF8.GetBytes($v)'}; $r=[Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write(${decrypt?'[Text.Encoding]::UTF8.GetString($r)':'[Convert]::ToBase64String($r)'})`;
 return new Promise((resolve,reject)=>{const child=execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:15000,maxBuffer:2_000_000,encoding:'utf8'},(error,stdout)=>error?reject(new Error('Windows could not access protected ChatGPT credentials.')):resolve(stdout));child.stdin!.on('error',()=>{});child.stdin!.end(value);});
}
export class CredentialVault<T>{
 constructor(public dir:string,private empty:()=>T){}
 async read():Promise<T>{try{return JSON.parse(await protect(await readFile(join(this.dir,'credentials.dpapi'),'utf8'),true));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return this.empty();throw e;}}
 async write(value:T){await mkdir(this.dir,{recursive:true});const tmp=join(this.dir,`credentials-${randomUUID()}.tmp`);try{await writeFile(tmp,await protect(JSON.stringify(value)),{mode:0o600});await rename(tmp,join(this.dir,'credentials.dpapi'));}finally{await unlink(tmp).catch(()=>{});}}
 async locked<R>(work:()=>Promise<R>):Promise<R>{
  await mkdir(this.dir,{recursive:true});const path=join(this.dir,'credentials.lock');const deadline=Date.now()+45000;let file;
  while(!file){try{file=await open(path,'wx');await file.writeFile(String(process.pid));}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
   // A dead process can leave a lock; a slow live process must never lose its lock.
   try{const pid=Number(await readFile(path,'utf8'));if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')await unlink(path);}}}catch{}
   if(Date.now()>deadline)throw new Error('ChatGPT credentials are busy. Try again shortly.');await new Promise(r=>setTimeout(r,150));}}
  try{return await work();}finally{await file.close();await unlink(path);}
 }
}
