import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

function captureWarning(text:string,title='Apartment for rent',heading='Apartment for rent'){
 const clone={attributes:[],querySelectorAll:()=>[],textContent:text,outerHTML:'<main>Rental details</main>'};
 const root={innerText:text,cloneNode:()=>clone,querySelectorAll:()=>[]};
 const document={title,body:root,querySelector:(s:string)=>s==='h1'?{textContent:heading}:s==='#profileApp'?root:null,querySelectorAll:()=>[]};
 const source=readFileSync('extension/capture.js','utf8').replace('export function capturePage','function capturePage');
 return runInNewContext(source+'\ncapturePage()', {document,location:{origin:'https://www.apartments.com',pathname:'/unit/abcdefg/',href:'https://www.apartments.com/unit/abcdefg/'},URL});
}

test('ordinary rental availability does not trigger a source-wide access pause',()=>{
 for(const text of ['The pool is temporarily unavailable during repairs.','Unit 201 is temporarily unavailable. Unit 202 is available.','Apartment for rent\nTemporarily unavailable\n$2,500 monthly']){
  const page=captureWarning(text);assert.equal(page.warning,null);assert.equal(page.warningEvidence,undefined);
 }
});

test('explicit challenges still stop even when normal listing content is underneath',()=>{
 for(const phrase of ['Access Denied','Unusual traffic','Verify that you are human','Too many requests','Press & hold','Press and hold']){
  const page=captureWarning('Rental details '.repeat(300)+phrase+' Reference 123');
  assert.match(page.warning,/access warning/);assert.ok(page.warning.includes(phrase));assert.ok(page.warningEvidence.includes(phrase));assert.ok(page.warningEvidence.length<=2000);
 }
});

test('whole-page service-unavailable headings still stop access',()=>{
 for(const [title,heading,text] of [['Temporarily unavailable','','Please try later'],['Apartments.com','Service unavailable','Please try later'],['Apartments.com','','This website is temporarily unavailable\nPlease try later']])assert.match(captureWarning(text,title,heading).warning,/access warning/);
});

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
