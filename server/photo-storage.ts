import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import type {Photo} from '../src/domain.ts';
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes.toString('base64')).digest('hex');
/** Retain the exact downloaded file; make a separate, bounded JPEG for analysis/cards. */
export async function storePhoto(bytes:Buffer,dataDir:string):Promise<Pick<Photo,'hash'|'local'|'sourceLocal'|'sourceWidth'|'sourceHeight'|'sourceBytes'>>{
 if(bytes.length>15*1024*1024)throw new Error('Photo exceeds 15MB limit');
 const input=sharp(bytes,{limitInputPixels:50000000}),meta=await input.metadata();
 const ext=({jpeg:'jpg',png:'png',webp:'webp',avif:'avif',gif:'gif'} as Record<string,string>)[meta.format??''];
 if(!ext||(meta.pages??1)>1)throw new Error('Unsupported or animated source photo');
 const preview=await input.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer();
 const hash=digest(preview),sourceLocal=`${digest(bytes)}.${ext}`,local=`${hash}.jpg`;
 await mkdir(join(dataDir,'media'),{recursive:true});
 await writeFile(join(dataDir,'media',sourceLocal),bytes);await writeFile(join(dataDir,'media',local),preview);
 const swapped=[5,6,7,8].includes(meta.orientation??1);
 return {hash,local,sourceLocal,sourceWidth:swapped?meta.height:meta.width,sourceHeight:swapped?meta.width:meta.height,sourceBytes:bytes.length};
}
