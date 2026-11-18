import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {criteriaSchema,listingSchema} from '../src/domain.ts';
import {studioTitleEvidence} from '../src/bedrooms.ts';
import {deskCategory} from '../src/desk-category.ts';
import {Store} from '../server/db.ts';
import {extractTrial} from '../server/trial-extraction.ts';
import {sourceById} from '../server/sources.ts';
import {quickRank} from '../server/quick-rank.ts';
import {bedroomIntakeExclusion} from '../server/bedroom-intake.ts';
import {discoveryIntakeFailure} from '../server/discovery-queue.ts';
import {createPlan,approvePlan,getPlan} from '../server/plans.ts';
import {runRegularPlan} from '../server/regular-worker.ts';

const criteria=criteriaSchema.parse({requireLaundry:false,quickIntake:{minRent:1000,maxRent:3500,minPhotos:0,allowedBeds:[1,2]}});
const url='https://www.austeville.com/property/example/suite-1202/suite-105-2/';
const page=(title='Studio w/ ocean view')=>`<h1>${title}</h1><div class="property-snapshot"><p>Monthly rent: $2,150</p><p>Size: 433 sq ft</p></div><h2>Virtual Tours</h2><a>Sample Studio</a><a>Sample 1 Bedroom</a><a>Sample Guest Suite</a><div class="attachment-large"><img src="https://www.austeville.com/example.jpg"></div>`;
const legacy=()=>listingSchema.parse({source:'austeville',sourceId:'studio',url,title:'Studio w/ ocean view',description:'Virtual Tours Sample Studio Sample 1 Bedroom',address:'',rent:2150,beds:1,galleryComplete:true,photos:[{id:'p',url:'https://www.austeville.com/example.jpg',local:'saved.jpg',status:'downloaded'}]});

test('Austeville studio title overrides sample one-bedroom tours; unknown titles never borrow tour bedroom counts',()=>{
 for(const [title,beds] of [['Studio w/ ocean view',0],['1 Bedroom with ocean view',1],['One-bedroom apartment',1],['Apartment with ocean view',null]] as const){
  const l=extractTrial(page(title),url,sourceById('austeville'));assert.equal(l.beds,beds);if(beds===0)assert.match(l.evidence.bedrooms,/unit title/);
 }
 for(const title of ['One bedroom with yoga studio','Apartment near an art studio','Studio-style one bedroom','Not a studio','Studios and one-bedroom apartments','Apartment in Studio City'])assert.equal(studioTitleEvidence(title),undefined,title);
 for(const title of ['Studio with a den','Bright bachelor apartment'])assert.ok(studioTitleEvidence(title));
});

test('current bedroom exclusions supersede preserved grades without overwriting records or user decisions',()=>{
 const store=new Store(':memory:');try{
  store.set('reviewWorkflow',{mode:'quick-first'});store.set('criteria',criteria);const id=store.ingest(legacy()).id;
  const rank={grade:'S',rankValue:95,eligible:true,reasons:['Historical rank'],flags:[]};store.set(`preservedQuickRank:${id}`,rank);
  const before=store.db.prepare('SELECT * FROM homes WHERE id=?').get(id),h=store.home(id)!;
  assert.equal(h.listing.beds,0);assert.equal(deskCategory(h),'Excluded');assert.match(h.deskExclusion!,/Studio/);assert.deepEqual(h.quickRank,rank);
  assert.deepEqual(store.db.prepare('SELECT * FROM homes WHERE id=?').get(id),before);
  assert.throws(()=>store.update(id,h.revision,{stage:'Interested',notes:'',followUp:'',viewing:'',rescued:false}),/Studio/);assert.equal(store.get(`fullReview:${id}`),undefined);
  const closed=store.update(id,h.revision,{stage:'Not Interested',notes:'My decision',followUp:'',viewing:'',rescued:false})!;
  assert.equal(deskCategory(closed),'Closed');const reopened=store.reopen(id,closed.revision)!;assert.equal(deskCategory(reopened),'Excluded');assert.equal(reopened.notes,'My decision');assert.deepEqual(reopened.quickRank,rank);
 }finally{store.close();}
});

test('studio facts and search titles fail before collection while uncertainty and allowed studios remain configurable',()=>{
 const store=new Store(':memory:');try{
  store.set('reviewWorkflow',{mode:'quick-first'});store.set('criteria',criteria);
  assert.ok(discoveryIntakeFailure(store,{url,title:'Studio w/ ocean view',beds:1}));
  assert.equal(quickRank(legacy(),criteria).eligible,false);
  assert.equal(bedroomIntakeExclusion({...legacy(),title:'Apartment',beds:null},criteria),undefined);
  assert.equal(bedroomIntakeExclusion({...legacy(),title:'Apartment',beds:0,conflicts:['Conflicting bedroom count']},criteria),undefined);
  assert.equal(bedroomIntakeExclusion(legacy(),criteriaSchema.parse({...criteria,quickIntake:{...criteria.quickIntake,allowedBeds:[0,1,2]}})),undefined);
 }finally{store.close();}
});

test('a newly discovered studio never downloads photos or starts AI even when the page advertises one-bedroom sample tours',async()=>{
 const store=new Store(':memory:'),dir=mkdtempSync(join(tmpdir(),'studio-intake-'));let details=0;
 try{
  store.set('reviewWorkflow',{mode:'quick-first'});store.set('criteria',criteria);
  const p=createPlan(store,{assessmentMode:'quick',sources:['austeville'],maxPages:3,maxListings:1,maxPhotos:3,maxAiCalls:0,maxAddressLookups:0,maxReservedUsd:0});approvePlan(store,p.id,'APPROVE ONE SCAN');
  await runRegularPlan(store,p.id,dir,undefined,{session:(_s,b)=>({stopped:false,start:async()=>{},close:async()=>{},resource:async()=>'',html:async u=>{b.reserve('pages');if(u===url){details++;return page();}return `<a href="${url}">Apartment</a>`;},image:async()=>{throw Error('Studio must not download photos');}}),review:async()=>{throw Error('Studio must not start AI');}});
  assert.equal(details,1);assert.equal(getPlan(store,p.id).usage.photos,0);assert.equal(getPlan(store,p.id).usage.aiCalls,0);assert.equal(store.homes().length,1);assert.equal(deskCategory(store.homes()[0]),'Excluded');assert.match(store.homes()[0].deskExclusion!,/Studio/);
 }finally{store.close();}
});
