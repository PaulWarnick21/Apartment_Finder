import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceTextEvidence} from '../server/workspace-evidence.ts';
import {extractTrial} from '../server/trial-extraction.ts';
import {extractRemaining} from '../server/remaining-extraction.ts';
import {extractApartments} from '../server/apartments-extraction.ts';
import {sourceById} from '../server/sources.ts';
import {applyVisualFeatures} from '../server/gallery-review.ts';

test('den and flex labels advertise a room without establishing usable office space',()=>{
 for(const text of ['1 bedroom + den','A separate den','Spacious flex room','Den with storage shelves']){const result=workspaceTextEvidence(text);assert.equal(result.workspace,null,text);assert.equal(result.advertisedDen,true);assert.match(result.evidence!,/unverified/);}
 for(const text of ['The apartment has a dedicated home office.','A separate home office.','Dedicated workspace in the unit.','Space for a home office.','Room for an office.','A den/office.'])assert.equal(workspaceTextEvidence(text).workspace,true,text);
});
test('storage conversion and office denials override optimistic advertising while shared or nearby offices do not count',()=>{
 for(const text of ['Den/office. Den converted into a custom walk-in closet.','Bedrooms: 1 + Den (converted to a walk-in closet).','A separate home office. The den is used for storage.','Den is a walk-in closet.','Den too small for a desk.','No dedicated home office.','Not a separate home office.','No space for a home office.'])assert.equal(workspaceTextEvidence(text).workspace,null,text);
 for(const text of ['Building amenities include a dedicated home office.','The building has a separate home office.','Shared dedicated workspace.','Dedicated workspace in the coworking lounge.','Steps from a dedicated office.','Other suites offer a separate home office.','Separate home office in the residents lounge.'])assert.equal(workspaceTextEvidence(text).workspace,null,text);
 assert.equal(workspaceTextEvidence('This unit has a dedicated home office. Building amenities include a shared coworking lounge.').workspace,true);
});

test('verb-based office denials and shared lounges cannot establish private workspace',()=>{
 for(const text of ['The unit does not have a dedicated home office.','The apartment does not include a separate workspace.','The unit does not provide any usable office.']){const result=workspaceTextEvidence(text);assert.equal(result.workspace,null,text);assert.match(result.evidence!,/unconfirmed/);}
 for(const text of ['Dedicated workspace in the shared lounge.','A separate home office in the common room.','Dedicated workspace in a communal area.'])assert.equal(workspaceTextEvidence(text).workspace,null,text);
 assert.equal(workspaceTextEvidence('The apartment has a dedicated home office. There is also a shared lounge in the building.').workspace,true);
});
test('Kijiji converted-den structure stays unknown and later supported unit photos can establish workspace',()=>{
 const description='Bright 1-bedroom + den condo. Features: Den converted into a custom walk-in closet. Bedrooms: 1 + Den (converted to a walk-in closet).';
 const html=`<script type="application/ld+json">${JSON.stringify({'@type':'SingleFamilyResidence',name:'Example apartment',address:'100 Example Street',numberOfBedrooms:1,offers:{price:2400},description,image:[]})}</script><h1>Example apartment</h1><p data-testid="vip-price">$2,400</p><div>1 + Den Bedrooms1 Bathrooms</div><h2>Description</h2><p>${description}</p>`;
 const l=extractTrial(html,'https://www.kijiji.ca/v-apartments-condos/vancouver/example/12345678',sourceById('kijiji'));
 assert.equal(l.workspace,null);assert.match(l.evidence.workspace,/walk-in closet/);
 l.photos=[{id:'office',url:'https://example.com/office.jpg',status:'reviewed',kind:'interior',scenery:'unknown',quality:null,unitCertain:true,note:'Usable office in the actual apartment',visualFeatures:{gas:null,workspace:true,openPlan:null,laundry:'unknown',note:'An actual separate office with a desk and usable circulation.'}}];applyVisualFeatures(l);assert.equal(l.workspace,true);assert.match(l.evidence['visual:workspace'],/office/);
});
test('Facebook separate-den and Apartments den labels use the same conservative text rule',()=>{
 const item={id:'123456',marketplace_listing_title:'Example unit',listing_price:{amount:'2400'},home_address:{street:'100 Example Street'},redacted_description:{text:'One bedroom apartment with a separate den.'},listing_photos:[],pdp_display_sections:[{pdp_fields:[{display_label:'1 bedroom'}]}]};
 const facebook=extractRemaining('facebook',`<script type="application/json">${JSON.stringify(item)}</script>`,'https://www.facebook.com/marketplace/item/123456/');assert.equal(facebook.workspace,null);assert.match(facebook.evidence.workspace,/Den\/flex/);
 const capture={url:'https://www.apartments.com/example/abcdefg/',title:'100 Example Street Unit 8',html:'<header id="profileHeaderWrapper"><h1>100 Example Street Unit 8</h1>$2400 Total Monthly Price Bedrooms 1 Bathrooms 1</header><section id="descriptionSection"><p>One-bedroom apartment with two dens.</p></section>',images:[],advertisedPhotos:0,warning:null,truncated:false};
 const apartment=extractApartments({...capture,html:capture.html.replace('two dens','a separate den')});assert.equal(apartment.workspace,null);assert.match(apartment.evidence.workspace,/unverified/);
 assert.equal(extractApartments({...capture,html:capture.html.replace('two dens','a dedicated home office')}).workspace,true);
});
