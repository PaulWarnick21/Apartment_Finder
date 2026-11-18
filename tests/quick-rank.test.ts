import test from 'node:test';
import assert from 'node:assert/strict';
import {criteriaSchema,listingSchema,type Listing,type Home} from '../src/domain.ts';
import {quickRank} from '../server/quick-rank.ts';
import {deskCategory} from '../src/desk-category.ts';
import {canTransition,stageGroup} from '../src/stage-transitions.ts';

const criteria=criteriaSchema.parse({requireLaundry:true,requireNiceViewForDesk:true,quickIntake:{minRent:1000,maxRent:3500,minPhotos:2,allowedBeds:[1,2]}});
const listing=(change:Partial<Listing>={})=>listingSchema.parse({source:'fixture',sourceId:'quick-1',url:'https://example.com/1',title:'Apartment',address:'Example address',area:'Downtown Vancouver',rent:2400,beds:1,laundry:'in-unit',galleryComplete:true,photos:[{id:'p1',url:'https://example.com/p1.jpg'},{id:'p2',url:'https://example.com/p2.jpg'}],...change});

test('quick intake uses inclusive configured prices and exact bedroom options',()=>{
 for(const rent of [1000,3500])assert.equal(quickRank(listing({rent}),criteria).eligible,true);
 for(const rent of [999,3501])assert.equal(quickRank(listing({rent}),criteria).eligible,false);
 for(const beds of [0,3,4])assert.equal(quickRank(listing({beds}),criteria).eligible,false);
 for(const beds of [1,2])assert.equal(quickRank(listing({beds}),criteria).eligible,true);
});

test('unknown or conflicting facts remain visible and flagged rather than invented failures',()=>{
 const unknown=quickRank(listing({rent:null,beds:null,laundry:'unknown',area:'Unknown',address:''}),criteria);
 assert.equal(unknown.eligible,true);assert.match(unknown.flags.join(' '),/rent not confirmed/);assert.match(unknown.flags.join(' '),/Bedroom count not confirmed/);
 const conflicting=quickRank(listing({rent:4000,beds:3,laundry:'shared-only',conflicts:['rent: two conflicting amounts','beds: source statements conflict','laundry: statements conflict']}),criteria);
 assert.equal(conflicting.eligible,true);assert.match(conflicting.flags.join(' '),/Conflicting rent/);
});

test('minimum photo gate counts distinct attached URLs and preserves unfinished enumeration',()=>{
 const one=[{...listing().photos[0]},{...listing().photos[0],id:'duplicate'}];
 assert.equal(quickRank(listing({photos:one}),criteria).eligible,false);
 const unknown=quickRank(listing({photos:one,galleryComplete:false,expectedPhotos:null}),criteria);
 assert.equal(unknown.eligible,true);assert.match(unknown.flags.join(' '),/Photo count is not yet confirmed/);
 assert.equal(quickRank(listing({photos:one,galleryComplete:false,expectedPhotos:1}),criteria).eligible,false);
});

test('confirmed rental, availability, laundry and geographic failures remain hard exclusions',()=>{
 for(const value of [listing({offeringKind:'floorplan'}),listing({offeringKind:'building'}),listing({title:'Private room for rent'}),listing({evidence:{nonRental:'true'}}),listing({available:'Rented'}),listing({laundry:'shared-only'}),listing({laundry:'none'}),listing({area:'Kelowna'})])assert.equal(quickRank(value,criteria).eligible,false);
 assert.equal(quickRank(listing({address:'123 Victoria Drive, Vancouver, BC',area:'Vancouver'}),criteria).eligible,true);
 assert.equal(quickRank(listing({area:'Port Moody'}),criteria).eligible,true);
});

test('a poor grade or unverified view never removes a hard-eligible apartment',()=>{
 const value=listing({rent:3500,area:'Burnaby',modern:false,cramped:true,parking:'none',floorLevel:1,photos:listing().photos.map(p=>({...p,status:'reviewed',kind:'interior',scenery:'buildings',unitCertain:true}))});
 const rank=quickRank(value,criteria);assert.equal(rank.grade,'F');assert.equal(rank.eligible,true);
 const home={reviewMode:'quick',quickRank:rank,score:{value:.1,eligible:false},stage:'Unreviewed',rescued:false} as Home;
 assert.equal(deskCategory(home),'Unreviewed');
 assert.equal(deskCategory({...home,reviewMode:undefined}),'Excluded');
});

test('downtown distance lowers the grade ordering without changing eligibility',()=>{
 const ranked=['downtown','nearby','far'].map(downtownDistance=>quickRank(listing({downtownDistance:downtownDistance as Listing['downtownDistance']}),criteria));
 assert.ok(ranked[0].rankValue>ranked[1].rankValue&&ranked[1].rankValue>ranked[2].rankValue);
 assert.ok(ranked.every(r=>r.eligible));
});

test('marketing claims stay unverified, and representative photos cannot prove the unit view',()=>{
 const ad=listing({description:'Beautiful mountain views.'}),before=JSON.stringify(ad),rank=quickRank(ad,criteria);
 assert.match(rank.reasons.join(' '),/claims a nature view; this has not been verified/);
 assert.match(rank.flags.join(' '),/nature view is unverified/);assert.equal(JSON.stringify(ad),before);
 const representative=quickRank(listing({photos:listing().photos.map(p=>({...p,status:'reviewed',kind:'interior',scenery:'nature',quality:5,unitCertain:false}))}),criteria);
 assert.match(representative.flags.join(' '),/nature view is unverified/);
 for(const description of ['No mountain views.','Rooftop lounge with ocean views.'])assert.ok(!quickRank(listing({description}),criteria).reasons.some(r=>r.includes('claims a nature view')));
});

test('quick workflow preserves user decisions even when full score is low',()=>{
 const home={reviewMode:'full',quickRank:{eligible:false},score:{value:.1,eligible:false},stage:'Interested',rescued:false} as Home;
 assert.equal(deskCategory(home),'Interested');
 assert.equal(deskCategory({...home,stage:'Not Interested'}),'Closed');
 assert.equal(deskCategory({...home,stage:'Ready to Apply'}),'Ready to Apply');
 assert.equal(canTransition('Interested','Ready to Apply'),false);assert.equal(canTransition('Unreviewed','Ready to Apply'),false);
 assert.equal(canTransition('Ready to Apply','Not Interested'),true);assert.equal(stageGroup('Ready to Apply'),'Ready to Apply');
});
