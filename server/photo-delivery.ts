import {mkdir,open,rename,stat,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import type {IncomingMessage,ServerResponse} from 'node:http';
import sharp from 'sharp';

const filename=/^[a-f0-9]{64}\.(?:jpg|png|webp|avif|gif)$/;
const types:Record<string,string>={jpg:'image/jpeg',png:'image/png',webp:'image/webp',avif:'image/avif',gif:'image/gif'};
const variants={card:{width:800,quality:82},preview:{width:1600,quality:88}};
type Size=keyof typeof variants;
const missing=(error:unknown)=>(error as NodeJS.ErrnoException)?.code==='ENOENT';

/** Browser display copies are separate from both source bytes and scoring evidence.
 * Two encodes at most; duplicate requests share one atomic, persistent cache fill. */
export class PhotoDelivery {
 private pending=new Map<string,Promise<string>>();
 private encoding=0;private waiting:Array<()=>void>=[];
 constructor(private dataDir:string){}
 private async acquire(){if(this.encoding<2){this.encoding++;return;}await new Promise<void>(resolve=>this.waiting.push(resolve));}
 private release(){const next=this.waiting.shift();if(next)next();else this.encoding--;}
 private derivative(name:string,size:Size){
  const key=`${size}/${name}`,active=this.pending.get(key);if(active)return active;
  const task=this.makeDerivative(name,size).finally(()=>{this.pending.delete(key);});this.pending.set(key,task);return task;
 }
 private async makeDerivative(name:string,size:Size){
  const directory=join(this.dataDir,'media','display-v1',size),target=join(directory,name+'.webp');
  try{await stat(target);return target;}catch(error){if(!missing(error))throw error;}
  await this.acquire();let temporary:string|undefined;
  try{
   await mkdir(directory,{recursive:true});temporary=join(directory,`${name}.${randomUUID()}.tmp`);
   const config=variants[size];
   await sharp(join(this.dataDir,'media',name),{limitInputPixels:50000000}).rotate().resize({width:config.width,height:config.width,fit:'inside',withoutEnlargement:true}).webp({quality:config.quality}).toFile(temporary);
   await rename(temporary,target);temporary=undefined;return target;
  }finally{if(temporary)await unlink(temporary).catch(()=>{});this.release();}
 }
 /** Returns false only for an unknown/missing local image or unsupported variant. */
 async serve(req:IncomingMessage,res:ServerResponse,name:string,query:URLSearchParams):Promise<boolean>{
  const size=query.get('size');
  if(!filename.test(name)||size!==null&&size!=='card'&&size!=='preview'||query.getAll('size').length>1||query.getAll('v').length>1||query.has('v')&&query.get('v')!=='1'||[...query.keys()].some(key=>key!=='size'&&key!=='v'))return false;
  const original=join(this.dataDir,'media',name);
  // A derivative must never make a removed or missing original appear available.
  try{if(!(await stat(original)).isFile())return false;}catch(error){if(missing(error))return false;throw error;}
  const etag=`"${name}${size?`-${size}-v1`:''}"`;
  const headers={'Cache-Control':'private, max-age=31536000, immutable','ETag':etag,'Content-Type':size?'image/webp':types[name.split('.').at(-1)!]};
  const tags=String(req.headers['if-none-match']??'').split(',').map(value=>value.trim().replace(/^W\//,''));
  if(tags.includes('*')||tags.includes(etag)){res.writeHead(304,headers);res.end();return true;}
  let path=original;
  if(size){try{path=await this.derivative(name,size as Size);}catch{
   // Display optimization must not hide a readable saved image if encoding or
   // cache storage fails. Retry the derivative on a later request.
   headers['Content-Type']=types[name.split('.').at(-1)!];headers['Cache-Control']='private, max-age=60';headers.ETag=`"${name}-display-fallback"`;
  }}
  let file;
  try{file=await open(path,'r');}catch(error){if(missing(error))return false;throw error;}
  try{
   const info=await file.stat();res.writeHead(200,{...headers,'Content-Length':info.size});
   if(req.method==='HEAD'){res.end();return true;}
   // pipeline closes the file stream on client disconnect or I/O failure.
   await pipeline(file.createReadStream({autoClose:false}),res);
  }catch(error){if(!res.destroyed)res.destroy(error instanceof Error?error:undefined);}
  finally{await file.close().catch(()=>{});}
  return true;
 }
}
