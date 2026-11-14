import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {load} from 'cheerio';
import {storePhoto} from '../server/photo-storage.ts';
import {largestImage,craigslistGallery} from '../server/photo-resolution.ts';
import {extractApartments} from '../server/apartments-extraction.ts';
import {Store} from '../server/db.ts';
import {createApp} from '../server/api.ts';
test('source bytes and full dimensions survive while the analysis copy remains bounded',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'apartment-photo-'));
 const original=await sharp({create:{width:3000,height:2100,channels:3,background:'#59735e'}}).png().toBuffer();
 const photo=await storePhoto(original,dir);assert.deepEqual(await readFile(join(dir,'media',photo.sourceLocal!)),original);
 assert.equal(photo.sourceWidth,3000);assert.equal(photo.sourceHeight,2100);assert.equal(photo.sourceBytes,original.length);
 const preview=await sharp(join(dir,'media',photo.local!)).metadata();assert.equal(preview.width,2048);assert.equal(preview.format,'jpeg');
 await assert.rejects(()=>storePhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"></svg>'),dir),/Unsupported/);
});
test('the largest advertised image variant wins without guessing URLs or accepting outside hosts',()=>{
 const $=load('<img src="/small.jpg" srcset="/small.jpg 300w, /large.jpg 2400w, https://other.test/huge.jpg 9000w">');
 assert.equal(largestImage($,$('img')[0],'https://example.com/listing',['example.com']),'https://example.com/large.jpg');
 const small=load('<img src="/small.jpg">');assert.equal(largestImage(small,small('img')[0],'https://example.com/listing',['example.com']),'https://example.com/small.jpg');
});
test('Craigslist uses advertised sizes for the matching photo type and preserves the original fallback',()=>{
 const url='https://images.craigslist.org/sample_600x450.jpg';
 const html=`<script>'imageConfig': {"3":{"hostname":"https://images.craigslist.org","sizes":["50x50c","600x450","1200x900"]}},\nvar imgList = [{"url":"${url}","imgid":"3:sample"}];</script>`;
 assert.deepEqual(craigslistGallery(html),[url.replace('600x450','1200x900')]);assert.deepEqual(craigslistGallery(html.replace('"3:sample"','"0:sample"')),[url]);assert.deepEqual(craigslistGallery('bad markup'),[]);
});
test('Apartments duplicate resolutions retain the largest captured variant',()=>{
 const small='https://images1.apartments.com/i2/same/112/photo.jpg',large='https://images1.apartments.com/i2/same/117/photo.jpg';
 const listing=extractApartments({url:'https://www.apartments.com/example/abcdefg/',title:'Example',warning:null,truncated:false,advertisedPhotos:1,images:[{url:small,width:400},{url:large,width:2000}],html:'<div id="descriptionSection"><p>A one-bedroom rental apartment with space to work from home.</p></div>'});
 assert.equal(listing.photos.length,1);assert.equal(listing.photos[0].url,large);
});
test('the local media endpoint serves preserved source bytes with their real content type',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'apartment-original-api-')),store=new Store(':memory:');
 const bytes=await sharp({create:{width:40,height:30,channels:3,background:'#567890'}}).webp().toBuffer(),photo=await storePhoto(bytes,dir);
 const app=createApp(store,dir,{demo:true});await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(app.server.address() as any).port}`;
 try{const response=await fetch(base+'/media/'+photo.sourceLocal);assert.equal(response.headers.get('content-type'),'image/webp');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.equal((await fetch(base+'/media/not-an-image.svg')).status,404);}finally{await app.close();store.close();}
});
