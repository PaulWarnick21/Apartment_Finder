import {mkdir,writeFile,readFile,link,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import type {Photo} from '../src/domain.ts';
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes.toString('base64')).digest('hex');
export class EmptyPhotoError extends Error {constructor(){super('Source returned an empty image response');}}
/** Content-addressed files are immutable. Never truncate a file open in the desk
 * or another gallery worker. Publish a complete temporary file with no overwrite.
 */
export async function storeImmutablePhoto(path:string,bytes:Buffer){
 const verify=async()=>{const saved=await readFile(path);if(!saved.equals(bytes))throw Error('Saved photo content does not match its content-addressed filename');};
 try{await verify();return;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const temporary=path+'.'+randomUUID()+'.tmp';
 try{
  await writeFile(temporary,bytes,{flag:'wx'});
  try{await link(temporary,path);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;await verify();}
 }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
/** Retain the exact downloaded file; make a separate, bounded JPEG for analysis/cards. */
export async function storePhoto(bytes:Buffer,dataDir:string):Promise<Pick<Photo,'hash'|'local'|'sourceLocal'|'sourceWidth'|'sourceHeight'|'sourceBytes'>>{
 if(!bytes.length)throw new EmptyPhotoError();
 if(bytes.length>15*1024*1024)throw new Error('Photo exceeds 15MB limit');
 const input=sharp(bytes,{limitInputPixels:50000000}),meta=await input.metadata();
 const ext=({jpeg:'jpg',png:'png',webp:'webp',avif:'avif',gif:'gif'} as Record<string,string>)[meta.format??''];
 if(!ext||(meta.pages??1)>1)throw new Error('Unsupported or animated source photo');
 const preview=await input.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer();
 const hash=digest(preview),sourceLocal=`${digest(bytes)}.${ext}`,local=`${hash}.jpg`;
 await mkdir(join(dataDir,'media'),{recursive:true});
 await storeImmutablePhoto(join(dataDir,'media',sourceLocal),bytes);await storeImmutablePhoto(join(dataDir,'media',local),preview);
 const swapped=[5,6,7,8].includes(meta.orientation??1);
 return {hash,local,sourceLocal,sourceWidth:swapped?meta.height:meta.width,sourceHeight:swapped?meta.width:meta.height,sourceBytes:bytes.length};
}
