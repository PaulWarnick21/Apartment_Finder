import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,stat,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {Store} from '../server/db.ts';
import {createApp} from '../server/api.ts';
import {storePhoto} from '../server/photo-storage.ts';

async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'af-display-photo-')),store=new Store(':memory:');
 const bytes=await sharp({create:{width:2400,height:1800,channels:3,background:'#567890'}}).png().toBuffer(),photo=await storePhoto(bytes,dir);
 const app=createApp(store,dir,{demo:true});await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 return {dir,photo,bytes,base:`http://127.0.0.1:${(app.server.address() as {port:number}).port}`,close:async()=>{await app.close();store.close();}};
}

test('display variants resize once into persistent cache while preserving original and scoring bytes',async()=>{
 const f=await fixture();try{
  const sourceUrl=f.base+'/media/'+f.photo.sourceLocal,cardUrl=sourceUrl+'?size=card&v=1';
  const analysisBefore=await readFile(join(f.dir,'media',f.photo.local!));
  const responses=await Promise.all(Array.from({length:6},()=>fetch(cardUrl)));
  const buffers=await Promise.all(responses.map(async response=>{assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');assert.match(response.headers.get('cache-control')!,/private.*31536000.*immutable/);return Buffer.from(await response.arrayBuffer());}));
  for(const bytes of buffers)assert.deepEqual(bytes,buffers[0]);
  const card=await sharp(buffers[0]).metadata();assert.equal(card.width,800);assert.equal(card.height,600);
  const cached=join(f.dir,'media','display-v1','card',f.photo.sourceLocal+'.webp'),before=await stat(cached);
  assert.deepEqual(await readdir(join(f.dir,'media','display-v1','card')),[f.photo.sourceLocal+'.webp']);
  const again=await fetch(cardUrl);await again.arrayBuffer();assert.equal((await stat(cached)).mtimeMs,before.mtimeMs);
  const preview=await fetch(sourceUrl+'?size=preview&v=1'),previewMeta=await sharp(Buffer.from(await preview.arrayBuffer())).metadata();assert.equal(previewMeta.width,1600);assert.equal(previewMeta.height,1200);
  const original=await fetch(sourceUrl);assert.equal(original.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await original.arrayBuffer()),f.bytes);
  assert.deepEqual(await readFile(join(f.dir,'media',f.photo.local!)),analysisBefore);
 }finally{await f.close();}
});

test('private media validators, HEAD and invalid variants keep the existing access boundary',async()=>{
 const f=await fixture();try{
  const sourceUrl=f.base+'/media/'+f.photo.sourceLocal,url=sourceUrl+'?size=card&v=1';
  const first=await fetch(url),etag=first.headers.get('etag')!;await first.arrayBuffer();
  const unchanged=await fetch(url,{headers:{'if-none-match':etag}});assert.equal(unchanged.status,304);assert.equal(await unchanged.text(),'');
  const weak=await fetch(url,{headers:{'if-none-match':'W/'+etag}});assert.equal(weak.status,304);
  const head=await fetch(url,{method:'HEAD'});assert.equal(head.status,200);assert.ok(Number(head.headers.get('content-length'))>0);assert.equal(await head.text(),'');
  for(const query of ['?size=original','?size=toString','?size=card&size=preview','?size=card&v=2','?size=card&path=../../secret'])assert.equal((await fetch(sourceUrl+query)).status,404);
  assert.equal((await fetch(url,{headers:{'x-forwarded-host':'untrusted.example.test','if-none-match':etag}})).status,403);
  await unlink(join(f.dir,'media',f.photo.sourceLocal!));assert.equal((await fetch(url,{headers:{'if-none-match':etag}})).status,404);
  assert.equal((await fetch(f.base+'/media/not-an-image.jpg?size=card')).status,404);
 }finally{await f.close();}
});

test('a failed display-cache write still serves the unchanged saved image',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.dir,'media','display-v1'),'Prevent cache directory creation');
  const response=await fetch(f.base+'/media/'+f.photo.sourceLocal+'?size=card&v=1');
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('cache-control'),'private, max-age=60');assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.bytes);
 }finally{await f.close();}
});
