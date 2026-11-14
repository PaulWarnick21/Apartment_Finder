import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../server/db.ts';
import {listingSchema} from '../src/domain.ts';
import {compareHomes} from '../src/desk-sort.ts';
const listing=(id:string,rent=2400)=>listingSchema.parse({source:'fixture',sourceId:id,url:`https://example.com/${id}`,title:'Example',address:`Example ${id}`,rent,beds:1,photos:[{id:'p',url:'https://example.com/photo',status:'reviewed',kind:'interior'}]});
test('Closed sorts by section entry, not listing ID, notes, or refresh time',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-14T12:00:00Z')});const db=new Store(':memory:');try{
  const older=db.ingest(listing('older')).id,newer=db.ingest(listing('newer')).id;db.homes();
  const save=(id:number,stage:string,notes='')=>db.update(id,db.home(id)!.revision,{stage,notes,followUp:'',viewing:'',rescued:false});
  save(newer,'Closed');t.mock.timers.tick(1000);save(older,'Closed');const entered=db.home(newer)!.categoryEnteredAt;
  t.mock.timers.tick(1000);save(newer,'Closed','New notes');db.ingest(listing('newer',2300));assert.equal(db.home(newer)!.categoryEnteredAt,entered);
  assert.deepEqual(db.homes().sort((a,b)=>compareHomes(a,b,'Closed','score')).map(h=>h.id),[older,newer]);
  db.reopen(newer,db.home(newer)!.revision);t.mock.timers.tick(1000);save(newer,'Closed');assert.equal(db.homes().sort((a,b)=>compareHomes(a,b,'Closed','rent'))[0].id,newer);
 }finally{db.close();}
});
test('automatic exclusions retain entry dates across restarts and reset only on re-entry',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-14T12:00:00Z')});const file=join(mkdtempSync(join(tmpdir(),'af-order-')),'desk.sqlite');let db=new Store(file);try{
  const old=db.ingest(listing('old')).id,newer=db.ingest(listing('new')).id;db.homes();db.ingest(listing('new',7000));db.homes();t.mock.timers.tick(1000);db.ingest(listing('old',7000));const initial=db.home(old)!.categoryEnteredAt;
  db.close();db=new Store(file);assert.equal(db.home(old)!.categoryEnteredAt,initial);assert.equal(db.homes().sort((a,b)=>compareHomes(a,b,'Excluded','score'))[0].id,old);
  db.ingest(listing('new'));db.homes();t.mock.timers.tick(1000);db.set('criteria',{...db.criteria,baseScore:1});assert.equal(db.homes().sort((a,b)=>compareHomes(a,b,'Excluded','score'))[0].id,newer);
 }finally{db.close();}
});
test('existing closed records use the closing decision, not a later note edit',()=>{const db=new Store(':memory:');try{const id=db.ingest(listing('old')).id;db.db.prepare("UPDATE homes SET stage='Closed',updated_at='2026-11-01T00:00:00Z' WHERE id=?").run(id);for(const [at,before,after] of [['2026-11-10T00:00:00Z','Unreviewed','Closed'],['2026-11-13T00:00:00Z','Closed','Closed']])db.db.prepare("INSERT INTO history(home_id,at,event,before_json,after_json) VALUES (?,?,'Decision saved',?,?)").run(id,at,JSON.stringify({stage:before}),JSON.stringify({stage:after}));assert.equal(db.home(id)!.categoryEnteredAt,'2026-11-10T00:00:00Z');}finally{db.close();}});
