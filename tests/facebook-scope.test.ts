import test from 'node:test';import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';import {adoptFacebookRadiusRoute} from '../server/facebook-scope.ts';
import {areaSearchRoute} from '../server/search-area.ts';
const from='https://www.facebook.com/marketplace/vancouver/propertyrentals/';
test('verified Facebook native radius URL preserves older candidate provenance and cannot broaden to other surfaces',()=>{
 const store=new Store(':memory:');try{
  store.set('searchAreaPolicy',{mode:'source-filters',regions:['downtown-vancouver'],existingHomeIds:[123],configuredAt:'test',sourceRoutes:{facebook:[{url:from,region:'downtown-vancouver',scope:'vancouver-approximate'}]}});
  const to=from+'?radius=4';assert.equal(adoptFacebookRadiusRoute(store,from,to,4),true);assert.ok(areaSearchRoute(store,'facebook',from));assert.ok(areaSearchRoute(store,'facebook',to));
  assert.equal(adoptFacebookRadiusRoute(store,from,to,4),true);assert.equal(store.get<any>('searchAreaPolicy').sourceRoutes.facebook.length,2);assert.deepEqual(store.get<any>('searchAreaPolicy').existingHomeIds,[123]);
  for(const bad of ['https://untrusted.test/marketplace/vancouver/propertyrentals/','https://www.facebook.com/marketplace/item/123/','https://www.facebook.com/messages/','http://www.facebook.com/marketplace/vancouver/propertyrentals/'])assert.equal(adoptFacebookRadiusRoute(store,from,bad,4),false);
  assert.equal(adoptFacebookRadiusRoute(store,from,from+'?radius=72',72),false);assert.equal(adoptFacebookRadiusRoute(store,'https://www.facebook.com/marketplace/toronto/propertyrentals/',to,4),false);
  assert.equal(adoptFacebookRadiusRoute(store,from,from+'?radius=72',4),false,'a conflicting explicit radius cannot be recorded as verified');
 }finally{store.close();}
});
