import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {createPhotoLoader,photoUrl} from '../src/photo-loading.ts';

function fixture(concurrency=2,maxCached=48,maxPixels=16_000_000){
 const requested:string[]=[],images:FakeImage[]=[];
 class FakeImage{
  onload:(()=>void)|null=null;onerror:(()=>void)|null=null;naturalWidth=800;naturalHeight=600;decoding='';fetchPriority='';url='';
  decodingDone!:()=>void;decoded=new Promise<void>(done=>{this.decodingDone=done;});
  set src(value:string){this.url=value;requested.push(value);}get src(){return this.url;}
  decode(){return this.decoded;}
  async finish(){this.onload?.();this.decodingDone();await setImmediate();}
 }
 const loader=createPhotoLoader(()=>{const image=new FakeImage();images.push(image);return image as unknown as HTMLImageElement;},concurrency,maxCached,maxPixels);
 return {loader,requested,images,image:(url:string)=>images.filter(image=>image.url===url).at(-1)!};
}

test('photo preloading bounds active work, prioritizes navigation, and drops stale queued neighbours',async()=>{
 const f=fixture(),cancel=f.loader.preload(['a','b','c','d']);assert.deepEqual(f.requested,['a','b']);
 const foreground=f.loader.warm('selected');await f.image('a').finish();assert.deepEqual(f.requested,['a','b','selected']);
 cancel();await f.image('b').finish();assert.deepEqual(f.requested,['a','b','selected']);
 let ready=false;void foreground.then(value=>{ready=value;});f.image('selected').onload?.();await setImmediate();assert.equal(ready,false,'image must finish decoding before it is shown');
 f.image('selected').decodingDone();assert.equal(await foreground,true);
});

test('rapid navigation cancels queued foreground work and shared images only load once',async()=>{
 const f=fixture(1),first=f.loader.warm('a'),controller=new AbortController(),stale=f.loader.warm('old-selection',controller.signal),shared=f.loader.warm('a');
 controller.abort();assert.equal(await stale,false);await f.image('a').finish();assert.equal(await first,true);assert.equal(await shared,true);assert.deepEqual(f.requested,['a']);
 assert.equal(await f.loader.warm('a'),true);assert.deepEqual(f.requested,['a']);
 const missing=f.loader.warm('missing');f.image('missing').onerror?.();assert.equal(await missing,false);
 const retry=f.loader.warm('missing');await f.image('missing').finish();assert.equal(await retry,true);assert.equal(f.requested.filter(url=>url==='missing').length,2);
});

test('decoded neighbours have a bounded memory budget and display variants leave originals intact',async()=>{
 const f=fixture(1,2,600_000);
 for(const url of ['a','b','c']){const ready=f.loader.warm(url);await f.image(url).finish();await ready;}
 const again=f.loader.warm('a');await f.image('a').finish();await again;assert.equal(f.requested.filter(url=>url==='a').length,2);
 const photo={local:'saved.jpg',sourceLocal:'source.png'};
 assert.equal(photoUrl(photo,'card'),'/media/saved.jpg?size=card&v=1');
 assert.equal(photoUrl(photo,'preview'),'/media/saved.jpg?size=preview&v=1');
 assert.equal(photoUrl(photo,'original'),'/media/source.png');
 assert.equal(photoUrl({local:'saved.jpg'},'original'),'/media/saved.jpg');
});
