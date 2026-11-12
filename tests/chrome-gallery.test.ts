import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('open Chrome gallery captures its active photo, excluding separate building previews',()=>{
 const url=(key:string)=>`https://images1.apartments.com/i2/${key}/112/photo.jpg`;
 const photo=(key:string,id='')=>({id,src:url(key),currentSrc:url(key),alt:'',naturalWidth:1200,naturalHeight:800,getAttribute:(name:string)=>name==='src'?url(key):null,closest:()=>null,getClientRects:()=>[{}]});
 const active=photo('unit-photo','activeMedia'),building=photo('separate-building');
 const clone={attributes:[],querySelectorAll:()=>[],textContent:'Unit details',outerHTML:'<main>Unit details</main>'};
 const root={cloneNode:()=>clone,querySelectorAll:(selector:string)=>selector==='img'?[building,active]:[]};
 const document={title:'Unit',body:{innerText:'Unit details'},querySelector:(selector:string)=>selector==='#profileApp'?root:selector==='#carouselPillPhotosLink'?{textContent:'41 Photos'}:selector==='#rentalDetailContainer #activeMedia'?active:null,querySelectorAll:(selector:string)=>selector.startsWith('#rentalDetailContainer #activeMedia')?[active]:[]};
 const source=readFileSync('extension/capture.js','utf8').replace('export function capturePage','function capturePage');
 const result=runInNewContext(source+'\ncapturePage()', {document,location:{origin:'https://www.apartments.com',pathname:'/unit/abcdefg/',href:'https://www.apartments.com/unit/abcdefg/'},URL});
 assert.equal(result.images.length,1);
 assert.equal(result.images[0].url,url('unit-photo'));
 assert.equal(result.advertisedPhotos,41);
 assert.equal(result.galleryComplete,false);
});
