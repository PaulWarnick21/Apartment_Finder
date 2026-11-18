import test from 'node:test';
import assert from 'node:assert/strict';
import {criteriaSchema,listingSchema,type Listing} from '../src/domain.ts';
import {scoreBase,scoreListing} from '../server/scoring.ts';
import {scoringFacts} from '../server/scoring-facts.ts';
const criteria=criteriaSchema.parse({requireNiceViewForDesk:true,initialMoveShortTermException:true,priceAnchor:3500,requireLaundry:true});
const apartment=(patch:Partial<Listing>={})=>listingSchema.parse({source:'fixture',sourceId:'short-lease',url:'https://example.test/short-lease',title:'Furnished apartment',address:'123 Example St, Vancouver',offeringKind:'unit',description:'Fully furnished apartment available for short-term or monthly rental.',rent:2650,beds:1,laundry:'in-unit',parking:'included',location:'downtown',floorLevel:10,furnished:true,shortLease:null,modern:true,cramped:false,evidence:{furnishingStatement:'Fully furnished',interiorAssessment:'Reviewed kitchen and bathroom have modern fittings.'},galleryComplete:true,expectedPhotos:1,allOutlooksCovered:true,photos:[{id:'1',url:'https://example.test/photo',status:'reviewed',kind:'interior',unitCertain:true,scenery:'buildings'}],...patch});
test('explicit initial-move exception admits a supported modest-view short furnished rental without granting 4.0+',()=>{
 const l=apartment(),s=scoreBase(l,criteria);assert.ok(s.value>3&&s.value<=3.5);assert.equal(s.eligible,true);assert.equal(s.view,'No qualifying nature');assert.ok(s.adjustments.some(a=>a.label==='Furnished short-term initial-move fit'));
 assert.ok(scoreBase(l,{...criteria,initialMoveShortTermException:false}).value<=2.9);
 assert.ok(scoreListing(l,{...criteria,bonuses:{...criteria.bonuses,furnished:5,shortLease:5}}).value<=3.5);
});
test('missing facts, expensive rent, long leases, poor interiors and incomplete/representative galleries cannot earn the exception',()=>{
 for(const patch of [{rent:null},{rent:3400},{rent:3300,parking:'extra',parkingCost:150},{modern:null},{modern:false},{cramped:true},{galleryComplete:false},{evidence:{}},{description:'Unfurnished monthly rental',furnished:false},{description:'Fully furnished apartment with a minimum one year lease.',shortLease:true},{conflicts:['Conflicting rent in description']}] satisfies Partial<Listing>[]){assert.ok(scoreBase(apartment(patch),criteria).value<=2.9,JSON.stringify(patch));}
 for(const patch of [{unitCertain:false},{attributionPending:true},{status:'downloaded'}] as const){const l=apartment();l.photos[0]={...l.photos[0],...patch};assert.ok(scoreBase(l,criteria).value<=2.9);}
});
test('hard exclusions, parking deductions and price ordering survive the exception; better views do not lower scores',()=>{
 assert.equal(scoreBase(apartment({laundry:'shared-only'}),criteria).eligible,false);
 assert.equal(scoreBase(apartment({address:'123 Example Road, Bowen Island'}),criteria).eligible,false);
 const base=scoreBase(apartment(),criteria);assert.ok(scoreBase(apartment({parking:'none'}),criteria).value<base.value);
 assert.ok(scoreBase(apartment({rent:3200}),criteria).value<=scoreBase(apartment({rent:2400}),criteria).value);
 const nice=apartment();nice.photos[0]={...nice.photos[0],scenery:'nature',quality:4.5};assert.ok(scoreBase(nice,criteria).value>=base.value);
});
test('monthly and short-term descriptions supply lease facts conservatively',()=>{
 for(const description of ['Rental agreement: Month-to-month lease','Available for monthly rental.','Flexible short-term rental options.'])assert.equal(scoringFacts(apartment({description})).shortLease,true);
 for(const description of ['Sublease opportunity','No short-term rentals; minimum one year lease.','Not available for short-term rental.','Monthly rental advertised, minimum 12 months required.','Short-term rental; 12-month minimum.'])assert.notEqual(scoringFacts(apartment({description})).shortLease,true);
 assert.equal(scoringFacts(apartment({shortLease:false})).shortLease,null);
});
