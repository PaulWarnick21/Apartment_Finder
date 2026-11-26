import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync,gzipSync} from 'node:zlib';
import {listingSchema} from '../src/domain.ts';
import {Store} from '../server/db.ts';
import {readPortableDesk,rebuildPortableDesk,writePortableDesk} from '../server/portable-desk.ts';
import {deskCategory} from '../src/desk-category.ts';

test('portable recovery keeps historical decisions, criteria and split history without live work or sensitive data',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'portable-desk-'));
 const source=join(dir,'source.sqlite'),target=join(dir,'restored.sqlite');
 const archiveNote='Tour the original apartment. old@example.test, +1 (604) 555-0199. Door code: 1936.';
 const sourceId='6045550100',listingUrl=`https://vancouver.craigslist.org/van/apa/d/example/${sourceId}.html`;
 const db=new Store(source);
 let first:number,second:number,mergeId:number;
 try{
  const base={source:'craigslist',title:'Test rental',rent:2500,beds:1,unit:'2',available:'Now'};
  first=db.ingest(listingSchema.parse({...base,sourceId,url:listingUrl+'?tracking=tracking-secret#link-extra',
   address:'100 Example Street',description:'Raw seller description and seller@example.test',
   photos:[{id:'external-photo-id',url:'https://images.craigslist.org/external-photo.jpg?session=photo-secret',
    local:'a'.repeat(64)+'.jpg',status:'reviewed',kind:'interior',scenery:'nature',unitCertain:true,quality:4}],
   galleryComplete:true,evidence:{photoSource:'https://photos.zillowstatic.com/fp/private-file.webp?key=photo-secret'},
  })).id;
  second=db.ingest(listingSchema.parse({...base,sourceId:'6045550101',url:'https://vancouver.craigslist.org/van/apa/d/other/6045550101.html',address:'200 Other Street'})).id;
  db.set('reviewWorkflow',{mode:'quick-first'});
  db.set('criteria',{...db.criteria,requireLaundry:true,maxRent:3300});
  db.set('scanSchedule',{enabled:true});
  db.set('availabilitySchedule',{enabled:true});
  db.set('browserExtension',{id:'old-machine',tokenHash:'extension-secret'});
  db.set('fullReviewPolicy',{stopAt:90,maxPhotos:300,maxAiCalls:22,maxPages:2,accountId:'private-account',profileId:'private-profile'});
  db.set('searchAreaPolicy',{regions:['downtown-vancouver'],existingHomeIds:[first,second],configuredAt:new Date().toISOString(),sourceRoutes:{craigslist:[{region:'downtown-vancouver',url:'https://www.craigslist.org/search/area/vancouver?cat=apa&min_bedrooms=1&api_key=private-route'}]}});
  db.update(first,0,{stage:'Interested',notes:archiveNote,followUp:'',viewing:'',rescued:false});
  db.set(`fullReview:${first}`,{status:'complete',updatedAt:new Date().toISOString(),detail:'Private provider detail: private-provider',planId:'private-plan'});
  const decision=JSON.stringify({nested:{...db.home(second)!.listing,description:'private nested description',photos:[]}});
  db.db.prepare("INSERT INTO history(home_id,at,event,before_json) VALUES (?,?,'Earlier facts',?)").run(first,new Date().toISOString(),decision);
  mergeId=db.mergeHomes(first,second).mergeId;
 }finally{db.close();}

 try{
  const output=writePortableDesk(source);
  const text=gunzipSync(output.bytes).toString('utf8');
  for(const secret of ['tracking-secret','link-extra','photo-secret','external-photo','private-file',
   'description and','private nested description','old@example.test','555-0199','1936','extension-secret',
   'private-account','private-profile','private-route','private-provider','private-plan']){
   assert.ok(!text.includes(secret),`archive excludes ${secret}`);
  }
  const snapshot=readPortableDesk(output.bytes);
  assert.equal(output.homes,2);
  assert.equal(snapshot.tables.postings[0].source_id,sourceId);
  assert.equal(snapshot.tables.postings[0].url,listingUrl);
  assert.throws(()=>readPortableDesk(gzipSync(JSON.stringify({...snapshot,meta:{...snapshot.meta,browserExtension:{}}}))),/Unexpected portable desk metadata/);
  assert.throws(()=>readPortableDesk(gzipSync(JSON.stringify({...snapshot,tables:{...snapshot.tables,plans:[]}}))),/Unexpected portable desk table set/);
  rebuildPortableDesk(snapshot,target);
  const restore=new Store(target);
  try{
   const home=restore.home(first)!;
   assert.equal(home.stage,'Interested');
   assert.match(home.notes,/Tour the original apartment/);
   assert.equal(deskCategory(home),'Excluded');
   assert.deepEqual(home.listing.photos,[]);
   assert.match(home.listing.evidence.archivedScore,/Historical fit score/);
   assert.equal(home.listing.available,'Unknown');
   assert.equal(home.listing.evidence.archivedAvailability,'Now');
   assert.equal(home.fullReview?.status,'paused');
   assert.equal(restore.criteria.requireLaundry,true);
   assert.equal(restore.criteria.maxRent,3300);
   assert.deepEqual(restore.get('scanSchedule'),{enabled:false});
   assert.deepEqual(restore.get('availabilitySchedule'),{enabled:false});
   assert.equal(restore.get('browserExtension'),undefined);
   assert.deepEqual(restore.get('fullReviewPolicy'),{stopAt:90,maxPhotos:300,maxAiCalls:22,maxPages:2});
   const routes=restore.get<{sourceRoutes:{craigslist:{url:string}[]}}>('searchAreaPolicy')!.sourceRoutes;
   assert.equal(new URL(routes.craigslist[0].url).search,'?cat=apa&min_bedrooms=1');
   assert.equal(restore.resolveHomeId(second),first);
   restore.splitMerge(mergeId);
   assert.equal(restore.resolveHomeId(second),second);
  }finally{restore.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});
