import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('normal Chrome gallery resumes a small allowance in its retained tab, then closes on completion',async()=>{
 const url='https://www.apartments.com/example/abcdefg/';let index=0,open=false,created=0,removed=0;const storage:Record<string,any>={},tabs=new Map<number,any>();
 const image=(i:number)=>({url:`https://images1.apartments.com/i2/photo-${i}/112/photo.jpg`,alt:'',width:1200,height:800});
 const page=()=>({url,title:'Example',text:'$2400 Total Monthly Price',html:'<main>Unit details</main>',images:open?[image(index)]:[],advertisedPhotos:4,galleryComplete:false,warning:null,truncated:false});
 const listener={addListener:()=>{}};
 const chrome={storage:{local:{get:async(key:string)=>({[key]:storage[key]}),set:async(value:object)=>Object.assign(storage,value),setAccessLevel:async()=>{}}},tabs:{create:async()=>{created++;index=0;open=false;const tab={id:created,url,status:'complete'};tabs.set(created,tab);return tab;},get:async(id:number)=>{const tab=tabs.get(id);if(!tab)throw new Error('Closed tab');return tab;},remove:async(id:number)=>{removed++;tabs.delete(id);}},scripting:{executeScript:async({func}:any)=>{const text=func.toString();let result;if(func.name==='capturePage')result=page();else if(text.includes('getClientRects'))result=open;else if(text.includes('carouselPillPhotosLink')){open=true;result=undefined;}else if(text.includes('next.click')){index++;result=true;}else throw new Error('Unexpected script '+text);return [{result}];}},alarms:{onAlarm:listener,create:()=>{}},runtime:{getManifest:()=>({version:'0.5.2'}),onInstalled:listener,onStartup:listener,onMessage:listener}};
 const code=readFileSync('extension/background.js','utf8').replace(/^import .*\r?\n/gm,'');
 const context=runInNewContext(code+'\n({collect})',{chrome,URL,Date,Map,Set,fetch:async(input:string,init:any)=>{assert.equal(init.headers['X-AF-Extension-Version'],'0.5.2');assert.match(input,/^http:\/\/127\.0\.0\.1:4317\/api\/browser-bridge\/jobs\/check$/);return {ok:true,json:async()=>({active:true})};},AbortSignal,setTimeout:(fn:()=>void)=>{fn();return 0;},capturePage:function capturePage(){},captureZillow:function captureZillow(){},captureApartmentDiscovery:function captureApartmentDiscovery(){}});
 const job={id:'fixture',url,kind:'listing',maxRent:3600,maxPhotos:2,expires:Date.now()+10000};
 const first=await context.collect(job,'fixture-token');assert.equal(first.galleryComplete,false);assert.equal(first.images.length,2);assert.equal(created,1);assert.equal(removed,0);assert.equal(storage.galleryProgress[url].cursor,1);
 const second=await context.collect(job,'fixture-token');assert.equal(second.galleryComplete,true);assert.equal(second.images.length,4);assert.equal(second.gallerySlots,4);assert.equal(created,1);assert.equal(removed,1);assert.equal(storage.galleryProgress[url],undefined);
});

test('Chrome discovery returns a distinct validated pagination link',()=>{
 const base='https://www.apartments.com/condos/vancouver-bc/',listing='https://www.apartments.com/example/abcdefg/',next=base+'2/';
 const anchor=(href:string,text:string,rel='')=>({href,textContent:text,rel,getAttribute:()=>null});
 const document={querySelectorAll:()=>[anchor(listing,'Unit'),anchor(next,'Next','next'),anchor('https://evil.example/','Other')]};
 const code=readFileSync('extension/discovery.js','utf8').replace('export function captureApartmentDiscovery','function captureApartmentDiscovery');const result=runInNewContext(code+'\ncaptureApartmentDiscovery()',{document,location:{href:base,origin:'https://www.apartments.com'},URL,Set});assert.equal(result.next,next);assert.deepEqual(Array.from(result.links),[listing]);
});
