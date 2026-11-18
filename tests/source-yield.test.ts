import test from 'node:test';
import assert from 'node:assert/strict';
import {listingSchema,type Home} from '../src/domain.ts';
import {sourceYieldStats,chooseSource,rankSources} from '../server/source-yield.ts';

const home=(id:number,source:string,value:number,change:Partial<Home>={}):Home=>({id,listing:listingSchema.parse({source,sourceId:String(id),url:`https://example.com/${id}`,title:'Example',address:'Example',rent:2400,beds:1,galleryComplete:true,photos:[{id:'photo',url:`https://example.com/${id}.jpg`,status:'reviewed'}]}),score:{value,low:value,high:value,base:value,adjustments:[],flags:[],reasons:[],eligible:value>=3,uncertain:false,view:'Unverified'},stage:'Unreviewed',notes:'',followUp:'',viewing:'',revision:0,rescued:false,updatedAt:'2026-11-18T00:00:00Z',firstSeen:'2026-11-18T00:00:00Z',possibleDuplicates:[],postings:[{source,url:`https://example.com/${id}`}],...change});

test('source statistics count homes once and do not treat floorplans or pending evidence as assessed negatives',()=>{
 const a=home(1,'facebook',3.9),pending=home(2,'facebook',2.9);pending.listing.photos[0].status='downloaded';
 const floorplan=home(3,'zumper',4.5);floorplan.listing.offeringKind='floorplan';a.postings.push({source:'craigslist',url:'https://example.com/crosspost'});
 const stats=sourceYieldStats([a,a,pending,floorplan]);assert.equal(stats.length,1);assert.equal(stats[0].uniqueUnits,2);assert.equal(stats[0].fullyReviewed,1);assert.equal(stats[0].incomplete,1);assert.equal(stats[0].provisionalMatches,1);assert.equal(stats[0].basis,'provisional');
});

test('confirmed strong matches take precedence over provisional outcomes',()=>{
 const values=[home(1,'confirmed',4.1),...Array.from({length:10},(_,i)=>home(i+2,'provisional',3.9))];
 const stats=sourceYieldStats(values);assert.equal(rankSources(stats)[0].source,'confirmed');assert.equal(stats[0].basis,'confirmed');
 assert.equal(chooseSource(['provisional','confirmed'],stats,{selectionCount:0,lastSelected:{}})?.source,'confirmed');
});

test('negative user feedback cannot be overridden by high model scores or counted as a positive',()=>{
 const stats=sourceYieldStats([home(1,'facebook',4.9),home(2,'other',3.9,{stage:'Not Interested'}),home(3,'other',2.9)]);
 const result=chooseSource(['facebook','other'],stats,{selectionCount:0,lastSelected:{}})!;
 assert.equal(result.mode,'exploration');assert.equal(stats[0].basis,'user-interest');assert.equal(stats.find(s=>s.source==='other')!.positiveSignals,0);
});

test('explicit interest is the primary signal even before the full review finishes',()=>{
 const value=home(1,'interested',1,{stage:'Interested'});value.listing.photos[0].status='downloaded';
 const stats=sourceYieldStats([value,home(2,'other',4.9)]);assert.equal(stats[0].fullyReviewed,0);assert.equal(stats[0].userInterested,1);assert.equal(stats[0].userReviewed,1);assert.equal(stats[0].basis,'user-interest');
 assert.equal(chooseSource(['other','interested'],stats,{selectionCount:0,lastSelected:{}})?.source,'interested');
});

test('recent choices move the majority from Craigslist to Facebook despite a larger historical Craigslist lead',()=>{
 const start=Date.parse('2026-10-01T00:00:00Z'),later=start+42*86400000,homes:Home[]=[];
 const add=(source:string,positive:number,negative:number,at:number)=>{for(let i=0;i<positive+negative;i++)homes.push(home(homes.length+1,source,1,{stage:i<positive?'Interested':'Not Interested',firstSeen:new Date(at).toISOString()}));};
 add('craigslist',40,5,start);add('facebook',3,7,start);
 const early=sourceYieldStats(homes,{now:start});assert.equal(chooseSource(['craigslist','facebook'],early,{selectionCount:0,lastSelected:{}})?.source,'craigslist');
 add('craigslist',0,5,later);add('facebook',10,2,later);
 const current=sourceYieldStats(homes,{now:later}),craigslist=current.find(s=>s.source==='craigslist')!,facebook=current.find(s=>s.source==='facebook')!;
 assert.ok(craigslist.userInterested/craigslist.userReviewed>facebook.userInterested/facebook.userReviewed);
 assert.ok(facebook.weight>craigslist.weight);
 const lastSelected:Record<string,number>={},counts:Record<string,number>={};
 for(let i=0;i<20;i++){const selected=chooseSource(['craigslist','facebook'],current,{selectionCount:i,lastSelected})!;counts[selected.source]=(counts[selected.source]??0)+1;lastSelected[selected.source]=i;}
 assert.deepEqual(counts,{facebook:15,craigslist:5});
 // Once the leader's work drains, the remaining source gets all the work.
 assert.equal(chooseSource(['craigslist'],current,{selectionCount:20,lastSelected})?.source,'craigslist');
});

test('unreviewed inventory and duplicate decisions do not dilute or inflate user yield; stale feedback rotates',()=>{
 const now=Date.parse('2026-11-18T00:00:00Z'),chosen=home(1,'craigslist',1,{stage:'Interested'}),untouched=Array.from({length:100},(_,i)=>home(i+2,'craigslist',1));
 const decision={homeId:1,interested:true,at:new Date(now-14*86400000).toISOString()};
 const stats=sourceYieldStats([chosen,chosen,...untouched],{now,decisions:[decision,decision]});
 assert.equal(stats[0].userReviewed,1);assert.equal(stats[0].recentReviewed,.5);assert.equal(stats[0].recentInterested,.5);
 const old=sourceYieldStats([chosen],{now:now+91*86400000,decisions:[decision]});
 assert.equal(chooseSource(['craigslist','facebook'],old,{selectionCount:0,lastSelected:{craigslist:1}})?.mode,'exploration');
});

test('priority receives three of four turns while exploration rotates among every other available source',()=>{
 const stats=sourceYieldStats([home(1,'best',4.2),home(2,'other-a',2),home(3,'other-b',2)]),lastSelected:Record<string,number>={},counts:Record<string,number>={};
 for(let i=0;i<40;i++){const chosen=chooseSource(['best','other-a','other-b'],stats,{selectionCount:i,lastSelected})!;counts[chosen.source]=(counts[chosen.source]??0)+1;lastSelected[chosen.source]=i;}
 assert.deepEqual(counts,{best:30,'other-a':5,'other-b':5});
 assert.equal(chooseSource(['other-a'],stats,{selectionCount:0,lastSelected:{}})?.source,'other-a');
 assert.equal(chooseSource([],stats,{selectionCount:0,lastSelected:{}}),null);
});

test('no supported successes rotates without inventing a winner; shrinkage tempers small samples',()=>{
 const stats=sourceYieldStats([home(1,'a',2),home(2,'b',2)]);
 assert.equal(chooseSource(['a','b'],stats,{selectionCount:0,lastSelected:{a:10}})?.source,'b');
 assert.equal(chooseSource(['a','b'],stats,{selectionCount:1,lastSelected:{a:10,b:11}})?.source,'a');
 assert.equal(stats[0].basis,'insufficient');
 const mixed=sourceYieldStats([home(1,'tiny',4.1),...Array.from({length:30},(_,i)=>home(i+2,'large',i<10?4.1:2))]);
 assert.ok(mixed.find(s=>s.source==='tiny')!.weight<1);
});
