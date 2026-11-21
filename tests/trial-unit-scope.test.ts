import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractTrial} from '../server/trial-extraction.ts';
import {sourceById} from '../server/sources.ts';
import {enrichListingContext} from '../server/listing-context.ts';
const fixture=(name:string)=>readFileSync(`tests/fixtures/${name}.html`,'utf8');
test('Kijiji scoped header and structured rent win over optional internet charges',()=>{
 const html=fixture('kijiji-optional-internet'),source=sourceById('kijiji'),url='https://www.kijiji.ca/v-apartments-condos/vancouver/example/12345678';
 const l=extractTrial(html,url,source);assert.equal(l.rent,2000);assert.equal(l.beds,0);assert.deepEqual(l.conflicts,[]);assert.match(l.evidence.internetCharge,/\$50 per month/);assert.match(l.internet,/separately at \$50\/month/);assert.deepEqual(enrichListingContext(l).monthlyCharges,[]);
 const noStructured=html.replace('"offers":{"price":"2000"},','');assert.equal(extractTrial(noStructured,url,source).rent,2000);
 const noHeader=html.replace('<p data-testid="vip-price">$2,000</p>','');assert.equal(extractTrial(noHeader,url,source).rent,2000);
 const feeOnly=noStructured.replace('<p data-testid="vip-price">$2,000</p>','');assert.equal(extractTrial(feeOnly,url,source).rent,null);
 const conflict=extractTrial(html.replace('<p data-testid="vip-price">$2,000</p>','<p data-testid="vip-price">$2,100</p>'),url,source);assert.equal(conflict.rent,2100);assert.match(conflict.conflicts.join(' '),/\$2100 \/ \$2000/);
});
test('Hollyburn About this rental determines studio facts while display-suite provenance survives',()=>{
 const l=extractTrial(fixture('hollyburn-unit-studio'),'https://www.hollyburn.com/furnished_rental/unit-8-in-example/',sourceById('hollyburn'));
 assert.equal(l.beds,0);assert.equal(l.rent,3050);assert.equal(l.sqft,452);assert.equal(l.unit,'8');assert.equal(l.furnished,true);assert.equal(l.workspace,null);assert.match(l.evidence.unitFacts,/About this rental/);assert.match(l.description,/display suites/);assert.match(l.conflicts.join(' '),/Display-suite/);assert.doesNotMatch(l.description,/one-bedroom|two bedrooms|Frequently Asked/);
});
test('Hollyburn own-card three-month minimum accepts words/digits and keeps contradictory unit terms uncertain',()=>{
 const source=sourceById('hollyburn'),url='https://www.hollyburn.com/furnished_rental/unit-8-in-example/',original=fixture('hollyburn-unit-studio');
 for(const term of ['minimum of three months of tenancy is required','minimum of 3 months of tenancy is required','minimum three-month tenancy']){
  const html=original.replace('minimum three-month tenancy',term).replace('Penthouses have two bedrooms.','Penthouses require a 1-year lease.');
  const l=extractTrial(html,url,source);assert.equal(l.shortLease,true,term);assert.match(l.lease,/minimum.*(?:three|3)[ -]months?/i);assert.match(l.evidence.shortLease,/About this rental/);assert.ok(!l.conflicts.some(c=>/Lease terms conflict/.test(c)));
  for(const other of ['A 1-year lease is required.','Lease Term: 12 months.']){const conflict=extractTrial(html.replace('This unit is fully furnished.',other+' This unit is fully furnished.'),url,source);assert.equal(conflict.shortLease,null);assert.match(conflict.conflicts.join(' '),/Lease terms conflict within About this rental/);assert.match(conflict.lease,/1-year|12 months/);}
 }
 const noUnitTerm=original.replace(' and a minimum three-month tenancy','').replace('Penthouses have two bedrooms.','All furnished units have a minimum of three months of tenancy.');assert.equal(extractTrial(noUnitTerm,url,source).shortLease,null);
});

test('Hollyburn denied or optional short terms do not retain a positive generic match',()=>{
 const original=fixture('hollyburn-unit-studio'),source=sourceById('hollyburn'),url='https://www.hollyburn.com/furnished_rental/unit-8-in-example/';
 for(const term of ['no minimum three-month tenancy','no minimum 90 day tenancy','minimum three-month tenancy is not required','minimum three-month tenancy is optional']){
  const l=extractTrial(original.replace('a minimum three-month tenancy',term),url,source);assert.equal(l.shortLease,null,term);assert.equal(l.evidence.shortLease,undefined,term);
 }
 const supported=extractTrial(original.replace('minimum three-month tenancy','minimum 90 day tenancy'),url,source);assert.equal(supported.shortLease,true);assert.match(supported.lease,/minimum 90 day tenancy/);
});
test('Hollyburn gallery includes allowed image folders but excludes unrelated popups and cloned slides',()=>{
 const a='https://portal.hollyburn.com/img/suite-images/example-a.jpg',b='https://www.hollyburn.com/drive/uploads/example-b.jpg',other='https://portal.hollyburn.com/img/suite-images/unrelated.jpg';
 const slider=`<section id="page-masthead"><div class="single-rental__slider"><a class="js-slider-popup-toggle" href="#target-gallery" style="background-image:url('${a}')"></a><div class="slick-cloned"><a class="js-slider-popup-toggle" href="#other-gallery" style="background-image:url('${other}')"></a></div><a class="js-slider-popup-toggle" href="#target-gallery" style="background-image:url('${b}')"></a></div></section>`;
 const popup=(id:string,urls:string[])=>`<div id="${id}">${urls.map(url=>`<div class="popup-slider__slide"><img src="${url}"></div>`).join('')}</div>`;
 const html=fixture('hollyburn-unit-studio')+popup('other-gallery',[other])+slider+popup('target-gallery',[a,b])+`<div class="slick-cloned">${popup('unused-clone',[other])}</div>`;
 const url='https://www.hollyburn.com/furnished_rental/unit-8-in-example/',source=sourceById('hollyburn'),l=extractTrial(html,url,source);
 assert.deepEqual(l.photos.map(p=>p.url),[a,b]);assert.equal(l.expectedPhotos,2);assert.equal(l.galleryComplete,true);assert.match(l.evidence.gallery,/#target-gallery/);assert.match(l.description,/display suites/);
 const ambiguous=extractTrial(html.replace(`href="#target-gallery" style="background-image:url('${b}')"`,`href="#other-gallery" style="background-image:url('${b}')"`),url,source);assert.deepEqual(ambiguous.photos,[]);assert.equal(ambiguous.galleryComplete,false);assert.equal(ambiguous.expectedPhotos,null);
 const unassociated=extractTrial(fixture('hollyburn-unit-studio')+popup('other-gallery',[other]),url,source);assert.deepEqual(unassociated.photos,[]);assert.equal(unassociated.galleryComplete,false);
 const popupExtra=extractTrial(html.replace(popup('target-gallery',[a,b]),popup('target-gallery',[a,b,other])),url,source);assert.deepEqual(popupExtra.photos.map(p=>p.url),[a,b]);assert.equal(popupExtra.expectedPhotos,3);assert.equal(popupExtra.galleryComplete,false);
 const popupMissing=extractTrial(html.replace(popup('target-gallery',[a,b]),popup('target-gallery',[a])),url,source);assert.deepEqual(popupMissing.photos.map(p=>p.url),[a]);assert.equal(popupMissing.expectedPhotos,2);assert.equal(popupMissing.galleryComplete,false);
 const disjoint=extractTrial(html.replace(popup('target-gallery',[a,b]),popup('target-gallery',[other])),url,source);assert.deepEqual(disjoint.photos,[]);assert.equal(disjoint.expectedPhotos,2);assert.equal(disjoint.galleryComplete,false);
 const untrusted=extractTrial(html.replaceAll(b,'https://evil.test/drive/uploads/example-b.jpg'),url,source);assert.deepEqual(untrusted.photos.map(p=>p.url),[a]);assert.equal(untrusted.galleryComplete,false);
});
