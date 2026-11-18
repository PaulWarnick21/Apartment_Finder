import test from 'node:test';
import assert from 'node:assert/strict';
import {listingSchema} from '../src/domain.ts';
import {reconcileListing,unionPhotos} from '../server/listing-integrity.ts';

test('same-source gallery retains advertised slots with duplicate image content',()=>{
 const previous=listingSchema.parse({source:'fixture',sourceId:'unit',url:'https://example.com/unit',title:'Apartment',address:'Example',rent:2400,beds:1,galleryComplete:true,expectedPhotos:2,photos:[{id:'one',url:'https://example.com/one.jpg',hash:'identical',local:'same.jpg',status:'reviewed'},{id:'two',url:'https://example.com/two.jpg',hash:'identical',local:'same.jpg',status:'reviewed'}]});
 const capture=listingSchema.parse({...previous,photos:previous.photos.map(p=>({id:p.id,url:p.url}))});
 const next=reconcileListing(previous,capture);
 assert.equal(next.photos.length,next.expectedPhotos);
 assert.equal(next.galleryComplete,true);
 assert.ok(next.photos.every(p=>p.status==='reviewed'&&p.local==='same.jpg'));
 assert.equal(unionPhotos([],previous.photos).length,1,'cross-post content deduplication remains available');
});
