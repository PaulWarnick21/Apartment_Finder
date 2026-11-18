import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryCards} from '../server/source-discovery.ts';
import {sourceById} from '../server/sources.ts';
test('EasyRent city results exclude the unfiltered recent-listings sidebar',()=>{
 const html='<main><div class="facetwp-template"><article><a href="/listings/north-suite/">North Vancouver 1 bedroom $2400 Available: Now</a></article></div><aside class="easyrent-recent-listings"><article><a href="/listings/surrey-suite/">Surrey 1 bedroom $2200 Available: Now</a></article></aside></main>';
 const cards=discoveryCards(html,sourceById('easyrent'),'https://www.easyrent.ca/listings/?_city=north-vancouver');
 assert.deepEqual(cards.map(c=>c.url),['https://www.easyrent.ca/listings/north-suite/']);
 assert.deepEqual(discoveryCards('<aside><a href="/listings/unfiltered/">Rental</a></aside>',sourceById('easyrent'),'https://www.easyrent.ca/listings/?_city=north-vancouver'),[]);
});
