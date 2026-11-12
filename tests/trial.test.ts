import test from 'node:test';
import assert from 'node:assert/strict';
import {extractTrial} from '../server/trial-extraction.ts';
import {sourceById} from '../server/sources.ts';
import {validateGallery} from '../server/gallery-review.ts';
test('current Craigslist gallery uses all image links and ignores in-suite AC as a unit number',()=>{
 const html='<h1 id="titletextonly">1BR condo</h1><span class="price">$2400</span><div class="attrgroup">1BR / 1Ba w/d in unit</div><div id="postingbody">In-suite AC. Beautiful apartment with in-suite laundry. 1204-100 Example Street.</div><p>image 1 of 2</p><a href="https://images.craigslist.org/a.jpg"></a><a href="https://images.craigslist.org/b.jpg"></a><a href="https://evil.example/c.jpg"></a>';
 const l=extractTrial(html,'https://www.craigslist.org/view/d/example/abc',sourceById('craigslist'));
 assert.equal(l.unit,'1204');assert.equal(l.laundry,'in-unit');assert.equal(l.photos.length,2);assert.equal(l.galleryComplete,true);
});
test('VADA extraction excludes neighboring listing galleries and building facts',()=>{
 const html='<h1>1 Bedroom Apartment</h1><span class="c-property-price__amount">$2500</span><p>Rental Listing Features Washer / Dryer 1 Parking stall</p><p>Building Amenities Gas stove in shared lounge</p><div class="c-gallery"><div class="c-carousel__slide"><img src="/unit.jpg"></div></div><div class="c-gallery"><div class="c-carousel__slide"><img src="/neighbor.jpg"></div></div>';
 const l=extractTrial(html,'https://vadapm.com/example',sourceById('vada'));assert.equal(l.photos.length,1);assert.equal(l.photos[0].url,'https://vadapm.com/unit.jpg');assert.equal(l.gas,null);assert.equal(l.laundry,'in-unit');
});
test('gallery response must cover every submitted photo with no duplicates or extras',()=>{
 const p={id:'p1',kind:'interior',scenery:'unknown',quality:null,unitCertain:false,note:'Unclear'};
 assert.throws(()=>validateGallery({photos:[p],allOutlooksCovered:false,summary:''},['p1','p2']),/every/);
 assert.throws(()=>validateGallery({photos:[p,p],allOutlooksCovered:false,summary:''},['p1','p2']),/every/);
 assert.equal(validateGallery({photos:[p],allOutlooksCovered:false,summary:''},['p1']).photos.length,1);
});
test('captured-page extraction does not turn a negative laundry statement into a pass',()=>{
 const l=extractTrial('<h1>1 bedroom apartment</h1><div id="postingbody">No in-suite laundry. Comfortable apartment close to downtown.</div>','https://www.craigslist.org/view/d/example/abc',sourceById('craigslist'));assert.equal(l.laundry,'none');
});
