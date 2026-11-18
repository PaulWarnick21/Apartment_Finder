import test from 'node:test';
import assert from 'node:assert/strict';
import {photoSchema} from '../src/domain.ts';
import {loadViewerPhoto} from '../src/photo-gallery.tsx';
import {photoUrl} from '../src/photo-loading.ts';

const photo=photoSchema.parse({id:'one',url:'https://example.test/one.jpg',local:'preview.jpg',sourceLocal:'a'.repeat(64)+'.jpg',note:'Saved photo'});
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(){
 const pending=new Map<string,(ready:boolean)=>void>(),signals:AbortSignal[]=[];
 const load=(url:string,signal?:AbortSignal)=>{if(signal)signals.push(signal);return new Promise<boolean>(resolve=>pending.set(url,resolve));};
 const shown:Array<{photoId:string;url:string;kind:string}>=[];let missing=0,sourceFailed=0;
 const stop=loadViewerPhoto(photo,image=>shown.push(image),()=>missing++,()=>sourceFailed++,load);
 const finish=async(size:'card'|'preview'|'original',ready:boolean)=>{pending.get(photoUrl(photo,size))!(ready);await tick();};
 return {pending,signals,shown,stop,finish,missing:()=>missing,sourceFailed:()=>sourceFailed};
}

test('viewer progressively shows decoded photos and never downgrades a ready original',async()=>{
 const f=fixture();await f.finish('card',true);assert.equal(f.shown.at(-1)!.kind,'card');
 await f.finish('original',true);await f.finish('preview',true);
 assert.deepEqual(f.shown.map(image=>image.kind),['card','source']);assert.equal(f.missing(),0);f.stop();
});

test('rapid navigation aborts queued work and late old-photo results cannot replace the selection',async()=>{
 const f=fixture();f.stop();assert.ok(f.signals.every(signal=>signal.aborted));
 await f.finish('card',true);await f.finish('preview',true);await f.finish('original',false);
 assert.deepEqual(f.shown,[]);assert.equal(f.missing(),0);assert.equal(f.sourceFailed(),0);
});

test('missing original retains the decoded preview with an explicit source failure',async()=>{
 const f=fixture();await f.finish('preview',true);await f.finish('original',false);await f.finish('card',true);
 assert.deepEqual(f.shown.map(image=>image.kind),['preview']);assert.equal(f.sourceFailed(),1);assert.equal(f.missing(),0);f.stop();
});

test('failed derivatives and source still try the original saved preview before declaring unavailable',async()=>{
 const f=fixture();await f.finish('card',false);await f.finish('preview',false);await f.finish('original',false);
 assert.equal(f.missing(),0);f.pending.get('/media/preview.jpg')!(true);await tick();
 assert.equal(f.shown.at(-1)!.kind,'saved');assert.equal(f.missing(),0);f.stop();
 const absent=fixture();await absent.finish('card',false);await absent.finish('preview',false);await absent.finish('original',false);
 absent.pending.get('/media/preview.jpg')!(false);await tick();assert.equal(absent.missing(),1);absent.stop();
});
