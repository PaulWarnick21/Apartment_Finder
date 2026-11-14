import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/db.ts';
import {listingSchema,criteriaSchema} from '../src/domain.ts';
import {RatingFeedbackService} from '../server/rating-feedback.ts';
import {explicitPreferences,assertFeedbackReady} from '../server/feedback-learning.ts';
import {scoreListing} from '../server/scoring.ts';
import {scoringFacts} from '../server/scoring-facts.ts';
import {applyInteriorAssessment} from '../server/gallery-review.ts';
import {createPlan,approvePlan,Budget} from '../server/plans.ts';
import {runRegularPlan} from '../server/regular-worker.ts';

const listing=(extra:Record<string,unknown>={})=>listingSchema.parse({source:'fixture',sourceId:'a',url:'https://example.com/a',title:'Test apartment',address:'Example Street',rent:2500,beds:1,location:'downtown',laundry:'in-unit',photos:[{id:'p',url:'https://example.com/p.jpg',status:'reviewed',kind:'interior',scenery:'nature',unitCertain:true,quality:4}],galleryComplete:true,expectedPhotos:1,...extra});
const rating=(score:number,reason='This outlook is not worth the asking price.')=>({requestId:randomUUID(),score,reason});
const noChange=async()=>({summary:'Covered by immediate calibration.',interpretation:'Comparable apartments should score similarly.',unresolved:[],changes:[]});

test('submission changes an unseen comparable apartment synchronously and survives restart without AI',async()=>{
 const s=new Store(':memory:'),id=s.ingest(listing()).id,service=new RatingFeedbackService(s,null);
 const saved=service.submit(id,rating(3));assert.equal(saved.calibrationApplied,true);
 assert.equal(scoreListing(listing({sourceId:'unseen',address:'Another address'}),s.criteria).value,3);
 assert.ok(scoreListing(listing({sourceId:'cheaper',rent:2400}),s.criteria).value<=3.2);
 assert.ok(scoreListing(listing({sourceId:'different-view',photos:[{...listing().photos[0],quality:5}]}),s.criteria).value>3);
 const restored=criteriaSchema.parse(JSON.parse(JSON.stringify(s.criteria)));assert.equal(scoreListing(listing({sourceId:'later'}),restored).value,3);
 assert.throws(()=>assertFeedbackReady(s),/feedback review/);await service.close();s.close();
});

test('latest rating replaces its example; no-change AI review still leaves active learning',async()=>{
 const s=new Store(':memory:'),id=s.ingest(listing()).id,service=new RatingFeedbackService(s,noChange);
 service.submit(id,rating(3.2));await service.idle();service.submit(id,rating(2.7));
 assert.equal(s.criteria.learnedExamples.length,1);assert.equal(scoreListing(listing({sourceId:'future'}),s.criteria).value,2.7);
 await service.idle();assert.equal(service.list(id)[0].status,'applied');assert.doesNotThrow(()=>assertFeedbackReady(s));assert.equal(service.list(id).length,2);
 await service.close();s.close();
});

test('explicit distance and floor preferences apply even when the reviewed listing has unknown facts',async()=>{
 const s=new Store(':memory:'),id=s.ingest(listing()).id,service=new RatingFeedbackService(s,null);
 service.submit(id,rating(3.1,"Apartments far out of downtown unless they have a great view max out at 3.3. Street level views should be avoided. I prefer to be at least 5 floors up from street level."));
 assert.equal(s.criteria.farFromDowntownCeiling,3.3);assert.equal(s.criteria.preferredMinFloor,5);assert.equal(s.criteria.streetLevelCeiling,2.9);
 const unknown=scoreListing(listing({sourceId:'other',floorLevel:null}),s.criteria);assert.ok(unknown.flags.includes('Floor Height Unsure'));
 const street=scoreListing(listing({sourceId:'street',floorLevel:0}),s.criteria);assert.ok(street.value<3);assert.equal(street.eligible,false);
 const far=listing({sourceId:'far',downtownDistance:'far',location:'outside',rent:1600,photos:[{...listing().photos[0],quality:3.5}]});assert.ok(scoreListing(far,s.criteria).value<=3.3);
 const great=listing({...far,photos:[{...listing().photos[0],quality:5}]});assert.ok(scoreListing(great,s.criteria).value>3.3);
 await service.close();s.close();
});

test('floor extraction never treats suite numbers or building height as the apartment floor',()=>{
 assert.equal(scoringFacts(listing({unit:'601',title:'Suite 601 in a 40-storey tower',description:'A 40-storey tower.'})).floorLevel,null);
 assert.equal(scoringFacts(listing({description:'Located on the 26th floor.'})).floorLevel,26);
 assert.equal(scoringFacts(listing({description:'The apartment is on the ground floor.'})).floorLevel,0);
 assert.equal(scoringFacts(listing({area:'Kerrisdale',location:'unknown'})).downtownDistance,'far');
 assert.equal(scoringFacts(listing({area:'Kitsilano',location:'unknown'})).downtownDistance,'nearby');
});

test('future expensive weak views cannot be rescued by furnishing or bonuses',()=>{
 const c=criteriaSchema.parse({expensiveWeakViewRent:3100,expensiveWeakViewCeiling:3.1,priceAnchor:3500});
 const weak=listing({rent:3380,furnished:true,workspace:true,shortLease:true,gas:true,photos:[{...listing().photos[0],quality:3}]});
 assert.ok(scoreListing(weak,c).value<=3.1);assert.ok(scoreListing({...weak,beds:2},c).value<=3.2);
});

test('feedback never overrides laundry, rent, photo provenance, or missing interior requirements',async()=>{
 const s=new Store(':memory:');s.set('criteria',criteriaSchema.parse({requireLaundry:true,maxRent:3600}));const id=s.ingest(listing()).id,service=new RatingFeedbackService(s,noChange);
 service.submit(id,rating(5,'I love the view.'));await service.idle();
 for(const l of [listing({laundry:'shared-only'}),listing({rent:4000}),listing({photos:[]})])assert.equal(scoreListing(l,s.criteria).eligible,false);
 const representative=listing({photos:[{...listing().photos[0],unitCertain:false}]});assert.equal(scoreListing(representative,s.criteria).view,'Unverified');assert.ok(scoreListing(representative,s.criteria).value<=3.5);
 await service.close();s.close();
});

test('user condition assessments stay separate from source facts and future photos can supply them',async()=>{
 const s=new Store(':memory:'),l=listing({modern:null}),id=s.ingest(l).id,service=new RatingFeedbackService(s,noChange);
 const before=s.home(id)!;service.submit(id,rating(2.8,'Dated kitchen and the apartment looks a bit tight.'));await service.idle();
 assert.equal(s.home(id)!.listing.modern,null);assert.equal(s.home(id)!.revision,before.revision);assert.equal(s.criteria.userAssessments['fixture:a'].cramped,true);
 const future=listing({sourceId:'future'});applyInteriorAssessment(future,{modern:false,cramped:true,photoIds:['p'],note:'Dated cabinets and narrow usable space.'});
 assert.equal(future.modern,false);assert.equal(future.cramped,true);assert.ok(scoreListing(future,s.criteria).value<3);
 assert.throws(()=>applyInteriorAssessment(future,{modern:true,cramped:false,photoIds:['missing'],note:'Unsupported'}),/supporting/);
 await service.close();s.close();
});

test('unresolved interpretation and failed reviews block new scans before any request',async()=>{
 const s=new Store(':memory:'),id=s.ingest(listing()).id,service=new RatingFeedbackService(s,async()=>({summary:'Need detail.',interpretation:'Ambiguous preference.',changes:[],unresolved:['Specify what you mean by a convenient commute.']}));
 service.submit(id,rating(3));await service.idle();assert.equal(service.list(id)[0].status,'needs-attention');
 const plan=createPlan(s,{sources:['craigslist'],purpose:'listings',maxPages:2,maxListings:1,maxPhotos:2,maxAiCalls:0,maxReservedUsd:0,reservePerCallUsd:.1,billingMode:'chatgpt'});assert.throws(()=>approvePlan(s,plan.id,'APPROVE ONE SCAN'),/feedback review/);
 await assert.rejects(()=>runRegularPlan(s,plan.id,'.'),/feedback review/);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM requests').get()!.n,0);
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM scan_lock').get()!.n,0);
 await service.close();s.close();
});

test('unit scoping avoids assigning building-wide penthouse laundry or dens to ordinary units',()=>{
 const l=scoringFacts(listing({source:'austeville',title:'1 Bedroom w/ garden view',area:'Unknown',address:'',location:'unknown',laundry:'in-unit',workspace:true,evidence:{workspace:'den'},description:'UBC 1 Bedroom w/ garden view Monthly rent: $2,200 2233 Allison Road Vancouver, BC About the building Offers two-bedroom-plus-den apartments. Penthouse suites have in-suite laundry.'}));
 assert.equal(l.area,'UBC');assert.equal(l.downtownDistance,'far');assert.equal(l.workspace,null);assert.equal(l.laundry,'unknown');
});

test('a downward rating never cancels a later penalty by boosting an already lower score',async()=>{
 const s=new Store(':memory:'),id=s.ingest(listing()).id,service=new RatingFeedbackService(s,noChange);
 service.submit(id,rating(3.1,'Dated kitchen and cramped rooms.'));await service.idle();
 const c=s.criteria,e=c.learnedExamples[0];assert.ok(e.target<e.originalScore);assert.ok(e.baseline<e.target);
 const result=scoreListing(listing(),c);assert.ok(result.value<=e.baseline);
 await service.close();s.close();
});
