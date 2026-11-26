import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {createApp} from '../server/api.ts';
import {listingSchema,type Home} from '../src/domain.ts';
import {buildingAddress,buildBuildingIndex,buildingPlacements,buildingReady,emptyBuildingMemory,groupVisibleHomes} from '../src/buildings.ts';
import {buildingDesk,updateBuildingDesk} from '../server/building-desk.ts';
import {shortlistBackup} from '../server/shortlist-backup.ts';
import {compareHomes} from '../src/desk-sort.ts';

function completed(store:Store,ids:number[]){store.set('reviewWorkflow',{mode:'quick-first'});for(const id of ids){store.set(`fullReview:${id}`,{status:'complete',detail:'Completed fixture',updatedAt:'2026-11-20T12:00:00Z'});if(store.home(id)!.stage==='Unreviewed')store.db.prepare("UPDATE homes SET stage='Interested' WHERE id=?").run(id);}}
const listing=(id:string,address='1889 Alberni Street, Vancouver, BC',unit=id)=>listingSchema.parse({source:'fixture',sourceId:id,url:`https://example.test/${id}`,title:'Apartment',address,unit,rent:2800,beds:1});
const reviewedHome=(id:number,stage:Home['stage']='Serious Candidates',revisitLater=false):Home=>({id,listing:listing(String(id)),stage,revisitLater,notes:`Unit ${id}`,followUp:'',viewing:'',revision:2,rescued:false,firstSeen:'2026-11-20',updatedAt:'2026-11-20',possibleDuplicates:[],postings:[],reviewMode:'full',fullReview:{status:'complete',detail:'Complete',updatedAt:'2026-11-20'},score:{value:4,low:4,high:4,base:4,eligible:true,uncertain:false,view:'Reviewed',adjustments:[],flags:[],reasons:[]}});

test('explicit early grouping places only selected Interested units together without completing assessments',()=>{
 const homes=[1,2,3].map(id=>({...reviewedHome(id,'Interested'),reviewMode:'quick' as const,fullReview:{status:'paused' as const,detail:'Pending',updatedAt:'2026-11-21'}}));
 homes[0].deskExclusion='Studio excluded by ordinary intake';
 const memory=emptyBuildingMemory(),key=buildBuildingIndex(homes).groups[0].key;
 memory.earlyGrouping=Object.fromEntries([1,2].map(id=>[id,{key,confirmedAt:'2026-11-21'}]));
 const before=JSON.stringify(homes);let index=buildBuildingIndex(homes,memory),placements=buildingPlacements(homes,index);
 assert.equal(placements.get(1)?.section,'Interested');assert.equal(placements.get(2)?.section,'Interested');assert.equal(placements.get(3)?.section,'Scoring in Progress');
 assert.deepEqual(groupVisibleHomes(homes,index).map(g=>g.homes.map(h=>h.id)),[[1,2],[3]]);
 assert.equal(JSON.stringify(homes),before);assert.equal(buildingReady(homes[0]),false);
 assert.equal(buildingPlacements(homes,index,false).get(1)?.section,'Excluded');
 assert.equal(buildingPlacements(homes,index,false).get(2)?.section,'Scoring in Progress');
 homes[1].stage='Not Interested';assert.equal(buildingPlacements(homes,index).get(2)?.section,'Closed');
 assert.equal(buildingPlacements(homes,index).get(1)?.section,'Interested','Remaining selected unit stays at its requested stage');
 memory.separate['1']=true;index=buildBuildingIndex(homes,memory);assert.equal(buildingPlacements(homes,index).get(1)?.section,'Excluded');
});

test('verified researched addresses group Harbourview suites without replacing advertised facts',()=>{
 const a=reviewedHome(1038),b=reviewedHome(1039,'Ready to Apply');
 for(const home of [a,b]){home.listing.address='';home.listing.evidence={researchedAddress:'1920 Alberni Street, Vancouver, BC',researchedAddressSource:'https://example.test/building/harbourview',addressLookupStatus:'verified',addressLookupCheckedAt:'2026-11-20T18:29:36.700Z'};}
 a.listing.unit='1502';b.listing.unit='1105';const before=JSON.stringify([a,b]),index=buildBuildingIndex([a,b]);
 assert.equal(index.groups.length,1);assert.deepEqual(index.groups[0].homeIds,[1038,1039]);assert.equal(buildingPlacements([a,b],index).get(a.id)?.section,'Ready to Apply');assert.equal(JSON.stringify([a,b]),before);
 b.listing.evidence.addressLookupStatus='unverified';assert.equal(buildBuildingIndex([a,b]).groups.length,2);
});

test('completed building groups appear only at the furthest active section, with Revisit Later winning ties',()=>{
 const a=reviewedHome(928),b=reviewedHome(938,'Serious Candidates',true),c=reviewedHome(3,'Interested'),closed=reviewedHome(4,'Closed'),rejected=reviewedHome(5,'Not Interested');
 const homes=[a,b,c,closed,rejected],before=JSON.stringify(homes),index=buildBuildingIndex(homes);let placements=buildingPlacements(homes,index);
 for(const h of [a,b,c])assert.deepEqual(placements.get(h.id),{section:'Serious Candidates',revisitLater:true});
 assert.equal(placements.get(closed.id)?.section,'Closed');assert.equal(placements.get(rejected.id)?.section,'Closed');
 assert.deepEqual(buildingPlacements(homes,index,false).get(a.id),{section:'Serious Candidates',revisitLater:false});assert.equal(JSON.stringify(homes),before);
 b.stage='Ready to Apply';placements=buildingPlacements(homes,index);for(const h of [a,b,c])assert.deepEqual(placements.get(h.id),{section:'Ready to Apply',revisitLater:false});
 b.stage='In Progress';assert.equal(buildingPlacements(homes,index).get(a.id)?.section,'In Progress');
 b.deskExclusion='Excluded';assert.equal(buildingPlacements(homes,index).get(a.id)?.section,'Serious Candidates');assert.equal(buildingPlacements(homes,index).get(b.id)?.section,'Excluded');
});

test('unreviewed and unfinished units cannot join grouped cards or advance through a scored neighbour',()=>{
 const leader=reviewedHome(1,'Ready to Apply');
 for(const status of ['queued','running','paused','failed','cancelled'] as const){const pending=reviewedHome(2,'Interested');pending.reviewMode='quick';pending.fullReview!.status=status;
  const homes=[leader,pending],index=buildBuildingIndex(homes);assert.equal(buildingReady(pending),false);assert.equal(buildingPlacements(homes,index).get(pending.id)?.section,'Scoring in Progress');assert.equal(groupVisibleHomes(homes,index).length,2);
 }
 const unreviewed=reviewedHome(3,'Unreviewed'),homes=[leader,unreviewed],index=buildBuildingIndex(homes);assert.equal(buildingReady(unreviewed),false);assert.equal(buildingPlacements(homes,index).get(3)?.section,'Unreviewed');
});

test('explicit grouping preserves distinct records, requires completed scoring, and survives restart',()=>{
 const file=join(mkdtempSync(join(tmpdir(),'af-manual-building-')),'apartments.sqlite');let store=new Store(file);
 try{
  const a=store.ingest(listing('a','Cypress House-1600 L Beach Avenue')).id,b=store.ingest(listing('b','1600 Beach Avenue, Vancouver')).id;
  let index=buildingDesk(store);const patch={action:'assign',revision:index.revision,homeId:a,targetHomeId:b,confirmation:'SAME BUILDING GROUP'};
  assert.throws(()=>updateBuildingDesk(store,patch),/fully scored/);completed(store,[a,b]);
  store.db.prepare("UPDATE homes SET stage='Serious Candidates',revisit_later=?,notes=? WHERE id=?").run(1,'Keep this comment',b);
  const before=JSON.stringify(store.db.prepare('SELECT * FROM homes ORDER BY id').all());index=updateBuildingDesk(store,patch);
  assert.equal(index.groups.length,1);assert.equal(store.resolveHomeId(a),a);assert.equal(store.resolveHomeId(b),b);assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM homes ORDER BY id').all()),before);
  store.close();store=new Store(file);assert.deepEqual(buildingDesk(store).groups[0].homeIds,[a,b]);assert.equal(store.home(b)?.notes,'Keep this comment');
 }finally{store.close();}
});
test('building identity removes suite and street abbreviations, retaining directions and municipality',()=>{
 const addresses=['#1101-1889 Alberni Street, Vancouver BC','Unit 902, 1889 Alberni St., Vancouver','1889 Alberni St #1101, Vancouver, BC V6G 3G7'];
 assert.equal(new Set(addresses.map((address,i)=>buildBuildingIndex([{id:i,listing:listing(String(i),address,'1101')}]).groups[0].key)).size,1);
 assert.equal(buildingAddress(listing('1','1889 Alberni St, North Vancouver'))?.city,'north vancouver');
 assert.equal(buildingAddress(listing('1','1889 Alberni St North Vancouver'))?.city,'north vancouver');
 assert.notEqual(buildingAddress(listing('1','123 W Georgia St, Vancouver'))?.street,buildingAddress(listing('2','123 E Georgia St, Vancouver'))?.street);
 assert.equal(buildingAddress(listing('1','Near Stanley Park')),null);
 assert.equal(buildingAddress(listing('1','1889 Alberni St'))?.certain,false);
 assert.equal(buildingAddress(listing('1','1889-1899 Alberni St, Vancouver'))?.certain,false);
 assert.equal(buildingAddress(listing('1','1889 Alberni St, Tower B, Vancouver'))?.certain,false);
 const evidence=listing('1','');evidence.description='Corner condo at 531 Beatty St, Vancouver. Contact our office at 123 Other Street.';
 assert.equal(buildingAddress(evidence)?.street,'531 beatty st');assert.equal(buildingAddress(evidence)?.certain,false);
 const unknown=[{id:1,listing:listing('1','')},{id:2,listing:listing('2','')}];assert.equal(buildBuildingIndex(unknown).groups.length,2);assert.equal(buildBuildingIndex(unknown).suggestions.length,0);
});

test('building grouping follows sort within a filtered section, without adding hidden or deferred peers',()=>{
 const store=new Store(':memory:');try{
  const a=store.ingest(listing('1')).id,b=store.ingest(listing('2','99 Other Street, Vancouver')).id,c=store.ingest(listing('3')).id,d=store.ingest(listing('4')).id;
  completed(store,[a,b,c,d]);store.db.prepare("UPDATE homes SET stage='Not Interested' WHERE id=?").run(d);
  const homes=store.homes(),index=buildingDesk(store,homes),byId=new Map(homes.map(h=>[h.id,h]));
  const groups=groupVisibleHomes([byId.get(a)!,byId.get(b)!,byId.get(c)!],index);
  assert.deepEqual(groups.map(g=>g.homes.map(h=>h.id)),[[a,c],[b]]);
  assert.ok(groups[0].group!.homeIds.includes(d));assert.ok(!groups.flatMap(g=>g.homes).some(h=>h.id===d));
  const sorted=homes.filter(h=>h.id!==d).sort((a,b)=>compareHomes(a,b,'Interested','recent'));
  assert.deepEqual(groupVisibleHomes(sorted,index).map(g=>g.homes.map(h=>h.id)),[[c,a],[b]]);
  assert.deepEqual(groupVisibleHomes([byId.get(c)!],index).flatMap(g=>g.homes.map(h=>h.id)),[c]);
 }finally{store.close();}
});

test('shared notes, confirmed uncertain matches, dismissals and separation survive restart without changing units',()=>{
 const dir=mkdtempSync(join(tmpdir(),'af-buildings-')),file=join(dir,'apartments.sqlite');let store=new Store(file);
 try{
  const a=store.ingest(listing('1')).id,b=store.ingest(listing('2','1889 Alberni St')).id,c=store.ingest(listing('3','1889 Alberni St, North Vancouver')).id;
  store.db.prepare("UPDATE homes SET stage='Serious Candidates',notes='Unit-specific note',tag_unfurnished=1 WHERE id=?").run(a);
  store.db.prepare("UPDATE homes SET stage='Not Interested',notes='Rejected this layout' WHERE id=?").run(b);
  completed(store,[a,b]);
  store.db.prepare('INSERT INTO duplicate_decisions VALUES (?,?,?)').run(a,b,'different');
  store.db.prepare('INSERT INTO rating_feedback(request_id,home_id,at,user_score,reason,listing_json,score_json,criteria_json) VALUES (?,?,?,?,?,?,?,?)').run('rating',b,'2026-11-20',2,'Too small','{}','{}','{}');
  const before=JSON.stringify(store.db.prepare('SELECT * FROM homes').all()),decisions=JSON.stringify(store.db.prepare('SELECT * FROM duplicate_decisions').all());
  let index=buildingDesk(store),aKey=index.groups.find(g=>g.homeIds.includes(a))!.key,bKey=index.groups.find(g=>g.homeIds.includes(b))!.key;
  assert.equal(index.groups.length,3);assert.equal(index.suggestions.length,2);
  index=updateBuildingDesk(store,{action:'notes',revision:index.revision,key:aKey,notes:'Remember concierge hours'});
  assert.throws(()=>updateBuildingDesk(store,{action:'notes',revision:0,key:aKey,notes:'Stale overwrite'}),/changed/);
  index=updateBuildingDesk(store,{action:'notes',revision:index.revision,key:bKey,notes:'Ask about elevator'});
  index=updateBuildingDesk(store,{action:'confirm',revision:index.revision,a:aKey,b:bKey});
  assert.equal(index.groups.length,2);assert.equal(index.suggestions.length,0,'A missing-city record cannot bridge Vancouver and North Vancouver');
  const group=index.groups.find(g=>g.homeIds.includes(a))!;assert.deepEqual(group.homeIds,[a,b]);assert.match(group.notes,/concierge/);assert.match(group.notes,/elevator/);assert.equal(index.ratings[b].score,2);
  assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM homes').all()),before);assert.equal(JSON.stringify(store.db.prepare('SELECT * FROM duplicate_decisions').all()),decisions);
  store.close();store=new Store(file);index=buildingDesk(store);assert.deepEqual(index.groups.find(g=>g.key===aKey)?.homeIds,[a,b]);
  const backup=shortlistBackup(file);assert.equal(backup.apartments.find(h=>h.id===a)?.buildingKey,aKey);assert.match(backup.buildings.find(g=>g.key===aKey)!.notes,/elevator/);assert.deepEqual(backup.buildings.find(g=>g.key===aKey)!.homeIds,[a]);
  index=updateBuildingDesk(store,{action:'separate',revision:index.revision,homeId:b});assert.equal(index.groups.length,3);assert.equal(index.suggestions.length,0);assert.equal(store.home(b)?.stage,'Not Interested');
  index=updateBuildingDesk(store,{action:'restore',revision:index.revision,homeId:b});assert.equal(index.groups.length,2);assert.deepEqual(index.groups.find(g=>g.homeIds.includes(a))!.homeIds,[a,b]);
  index=updateBuildingDesk(store,{action:'separate',revision:index.revision,homeId:b});
  const d=store.ingest(listing('4','1889 Alberni St')).id;index=buildingDesk(store);const dKey=index.groups.find(g=>g.homeIds.includes(d))!.key;
  index=updateBuildingDesk(store,{action:'dismiss',revision:index.revision,a:aKey,b:dKey});assert.ok(!index.suggestions.some(p=>[p.a,p.b].includes(aKey)&&[p.a,p.b].includes(dKey)));
  store.close();store=new Store(file);assert.deepEqual(buildingDesk(store).suggestions,index.suggestions);assert.equal(store.home(c)?.listing.address,'1889 Alberni St, North Vancouver');
 }finally{store.close();}
});

test('notes on an uncertain address survive later listing enrichment and new siblings join known buildings',()=>{
 const store=new Store(':memory:');try{
  const a=store.ingest(listing('1','1889 Alberni St')).id;let index=buildingDesk(store);
  index=updateBuildingDesk(store,{action:'notes',revision:0,key:index.groups[0].key,notes:'Saved before city was known'});
  store.ingest(listing('1'));const b=store.ingest(listing('2')).id;completed(store,[a,b]);index=buildingDesk(store);
  assert.match(index.groups.find(g=>g.homeIds.includes(a))!.notes,/before city/);assert.equal(index.suggestions.length,1);
  index=updateBuildingDesk(store,{action:'confirm',revision:index.revision,...index.suggestions[0]});
  const c=store.ingest(listing('3')).id;index=buildingDesk(store);assert.deepEqual(index.groups[0].homeIds,[a,b,c]);assert.match(index.groups[0].notes,/before city/);
 }finally{store.close();}
});

test('building API enforces CSRF, validates patches, protects revisions, and invalidates compact state ETags',async()=>{
 const store=new Store(':memory:'),dir=mkdtempSync(join(tmpdir(),'af-building-api-'));const a=store.ingest(listing('1')).id,b=store.ingest(listing('2')).id,app=createApp(store,dir,{demo:true});
 await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}/api/`;
 try{
  const response=await fetch(base+'state?compact=1'),state=await response.json() as any,etag=response.headers.get('etag')!;
  assert.deepEqual(state.buildings.groups[0].homeIds,[a,b]);const patch={action:'notes',revision:0,key:state.buildings.groups[0].key,notes:'<script>plain text</script>'};
  const send=(value:unknown,token=state.csrf)=>fetch(base+'buildings',{method:'PATCH',headers:{'Content-Type':'application/json','X-AF-Token':token},body:JSON.stringify(value)});
  assert.equal((await send(patch,'wrong')).status,403);assert.equal((await send({...patch,unexpected:true})).status,400);assert.equal((await send(patch)).status,200);assert.equal((await send(patch)).status,409);
  const next=await fetch(base+'state?compact=1',{headers:{'If-None-Match':etag}});assert.equal(next.status,200);assert.equal((await next.json() as any).buildings.groups[0].notes,patch.notes);
  const exportData=await(await fetch(base+'export')).json() as any;assert.equal(exportData.buildingMemory.revision,1);
 }finally{await app.close();store.close();}
});
