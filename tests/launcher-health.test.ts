import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {createApp} from '../server/api.ts';

test('launcher health checks all scan states without loading the desk or connection status',async()=>{
 const store=new Store(':memory:'),app=createApp(store,'.',{demo:true});
 await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));
 const url=`http://127.0.0.1:${(app.server.address() as {port:number}).port}/api/health`;
 store.homes=()=>{throw Error('The launcher must not load saved homes');};
 const health=async()=>{const response=await fetch(url);assert.equal(response.status,200);const text=await response.text();assert.ok(text.length<300);return JSON.parse(text);};
 try{
  assert.equal((await health()).canStop,true);
  const insert=store.db.prepare('INSERT INTO plans (id,state,created_at) VALUES (?,?,?)');
  insert.run('old-active','approved','2026-01-01');
  for(let i=0;i<35;i++)insert.run(`recent-${i}`,'completed','2026-11-20');
  assert.equal((await health()).canStop,false,'approved plans outside the latest 30 still block stopping');
  store.db.prepare("UPDATE plans SET state='running' WHERE id='old-active'").run();
  assert.equal((await health()).canStop,false);
  store.db.prepare("UPDATE plans SET state='completed' WHERE id='old-active'").run();
  assert.equal((await health()).canStop,true);
  store.db.prepare('INSERT INTO scan_lock VALUES (1,?,?)').run('interrupted','2026-11-20');
  assert.equal((await health()).canStop,false,'unresolved worker locks block stopping');
  store.db.prepare('DELETE FROM scan_lock').run();
  store.db.prepare('INSERT INTO parallel_scan_members VALUES (?,?,?,?)').run('old-active','group','craigslist','2026-11-20');
  assert.equal((await health()).canStop,false,'parallel worker membership also blocks stopping');
  store.db.prepare('DELETE FROM parallel_scan_members').run();
  assert.equal((await health()).canStop,true);
 }finally{await app.close();store.close();}
});
