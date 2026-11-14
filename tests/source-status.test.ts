import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {sourceStatuses} from '../server/source-status.ts';
import {listingSchema} from '../src/domain.ts';

test('successful source notes are not pauses; real cooldowns and attention flags remain pauses',()=>{
 const s=new Store(':memory:');try{
  s.db.prepare('INSERT INTO source_health(source,reason,needs_attention) VALUES (?,?,?)').run('apartments','Normal Chrome trial complete.',0);
  let status=sourceStatuses(s).find(r=>r.id==='apartments')!;assert.equal(status.paused,false);assert.equal(status.scanMethod,'App scan through Chrome');
  s.pause('apartments','Warning',false,Date.now()+60000);assert.equal(sourceStatuses(s).find(r=>r.id==='apartments')!.paused,true);
  s.db.prepare('UPDATE source_health SET paused_until=?,needs_attention=0').run(new Date(0).toISOString());assert.equal(sourceStatuses(s).find(r=>r.id==='apartments')!.paused,false);
  s.db.prepare('UPDATE source_health SET needs_attention=1').run();assert.equal(sourceStatuses(s).find(r=>r.id==='apartments')!.paused,true);
 }finally{s.close();}
});
test('saved results and current active counts remain separate from connected app scanning',()=>{
 const s=new Store(':memory:');try{
  s.set('trialSourceReports',{zillow:'3 test candidates; obsolete active count 3'});
  for(let n=1;n<=3;n++)s.ingest(listingSchema.parse({source:'zillow',sourceId:String(n),url:`https://www.zillow.com/${n}`,title:'Example',address:`Example ${n}`,rent:2600,beds:1,photos:[{id:'p',url:'https://example.com/p.jpg',status:'reviewed',kind:'interior'}]}));
  const status=sourceStatuses(s).find(r=>r.id==='zillow')!;assert.equal(status.trialRecorded,true);assert.equal(status.candidates,3);assert.equal(status.reviewedPhotos,3);assert.equal(status.scanMethod,'App scan through Chrome');assert.equal(status.ready,true);assert.equal(status.paused,false);assert.ok(!status.status.includes('obsolete'));
  const h=s.homes()[0];s.update(h.id,h.revision,{stage:'Closed',notes:'Keep this',followUp:'',viewing:'',rescued:false});const updated=sourceStatuses(s).find(r=>r.id==='zillow')!;assert.equal(updated.candidates,3);assert.equal(updated.active,status.active-1);
 }finally{s.close();}
});
