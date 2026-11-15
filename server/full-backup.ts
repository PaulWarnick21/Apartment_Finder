import {mkdir,readFile,writeFile,copyFile,stat,access} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import type {Store} from './db.ts';

type Entry={path:string;bytes:number;sha256:string};
export type BackupManifest={version:1;createdAt:string;files:Entry[];credentials:'excluded-reconnect-after-restore'};
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const safeMedia=/^[a-f0-9]{64}\.(jpg|png|webp|avif|gif)$/;
function inside(root:string,name:string){const path=resolve(root,name),rel=relative(resolve(root),path);if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('Unsafe backup path');return path;}
async function absent(path:string){try{await access(path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}throw new Error('Backup/restore destination already exists; choose a new folder');}
function referencedMedia(db:DatabaseSync){
 const names=new Set<string>();
 const collect=(value:any)=>{if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if((key==='local'||key==='sourceLocal')&&typeof item==='string'){if(!safeMedia.test(item))throw new Error('Invalid stored media reference; backup needs repair');names.add(item);}else collect(item);}};
 for(const table of ['homes','posting_details','rating_feedback','history','home_merges']){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
  const columns=(db.prepare(`PRAGMA table_info(${table})`).all() as any[]).filter(c=>['listing','listing_json','before_json','after_json','snapshot'].includes(c.name));
  for(const column of columns)for(const row of db.prepare(`SELECT ${column.name} AS value FROM ${table}`).all() as any[])if(row.value){try{collect(JSON.parse(row.value));}catch(e){if(e instanceof SyntaxError)throw new Error('Invalid saved JSON; backup needs repair');throw e;}}
 }
 return [...names].sort();
}
export async function createFullBackup(store:Store,dataDir:string,destination:string,privateDir=resolve('private')){
 await absent(destination);await mkdir(destination,{recursive:true});
 const database=join(destination,'apartments.sqlite');await store.backupTo(database);
 const db=new DatabaseSync(database,{readOnly:true});let media:string[];try{media=referencedMedia(db);}finally{db.close();}
 const paths=['apartments.sqlite'];
 for(const name of media){await mkdir(join(destination,'media'),{recursive:true});await copyFile(join(dataDir,'media',name),join(destination,'media',name));paths.push(`media/${name}`);}
 for(const name of ['criteria.md','settings.json']){const source=join(privateDir,name);try{await stat(source);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e;}await mkdir(join(destination,'private'),{recursive:true});await copyFile(source,join(destination,'private',name));paths.push(`private/${name}`);}
 const files:Entry[]=[];for(const path of paths){const data=await readFile(inside(destination,path));files.push({path,bytes:data.length,sha256:digest(data)});}
 const manifest:BackupManifest={version:1,createdAt:new Date().toISOString(),files,credentials:'excluded-reconnect-after-restore'};
 await writeFile(join(destination,'manifest.json'),JSON.stringify(manifest,null,2));
 await verifyBackup(destination);return {destination,files:files.length,media:media.length,bytes:files.reduce((sum,file)=>sum+file.bytes,0)};
}
export async function verifyBackup(directory:string){
 const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')) as BackupManifest;
 if(manifest.version!==1||!Array.isArray(manifest.files)||!manifest.files.some(f=>f.path==='apartments.sqlite'))throw new Error('Unsupported or incomplete backup manifest');
 const seen=new Set<string>();
 for(const file of manifest.files){if(seen.has(file.path)||!(/^(apartments\.sqlite|media\/[a-f0-9]{64}\.(jpg|png|webp|avif|gif)|private\/(criteria\.md|settings\.json))$/.test(file.path)))throw new Error('Unexpected backup entry');seen.add(file.path);const data=await readFile(inside(directory,file.path));if(data.length!==file.bytes||digest(data)!==file.sha256)throw new Error(`Backup checksum mismatch: ${file.path}`);}
 const db=new DatabaseSync(join(directory,'apartments.sqlite'),{readOnly:true});try{const check=db.prepare('PRAGMA quick_check').get() as any;if(Object.values(check)[0]!=='ok')throw new Error('Backup database integrity check failed');for(const name of referencedMedia(db))if(!seen.has(`media/${name}`))throw new Error(`Backup is missing referenced media: ${name}`);}finally{db.close();}
 return {valid:true,files:manifest.files.length,createdAt:manifest.createdAt};
}
/** Restore into a fresh staging folder only. Never overwrite the running application. */
export async function restoreBackup(directory:string,destination:string){
 const verified=await verifyBackup(directory);await absent(destination);const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8')) as BackupManifest;await mkdir(destination,{recursive:true});
 for(const file of manifest.files){const target=inside(destination,file.path);await mkdir(resolve(target,'..'),{recursive:true});await copyFile(inside(directory,file.path),target);}
 await copyFile(join(directory,'manifest.json'),join(destination,'manifest.json'));await verifyBackup(destination);return {...verified,destination};
}
