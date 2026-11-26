import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {createApp} from '../server/api.ts';
import {discoveryAlerts,raiseDiscoveryAlert,resolveDiscoveryAlert} from '../server/discovery-alerts.ts';

test('source alerts persist across reopening, deduplicate episodes and notify again after recovery',()=>{
 const path=join(mkdtempSync(join(tmpdir(),'discovery-alert-')),'apartments.sqlite');let s=new Store(path);
 try{
  raiseDiscoveryAlert(s,'craigslist','Results slowed',new Date());const id=discoveryAlerts(s)[0].id;
  s.close();s=new Store(path);raiseDiscoveryAlert(s,'craigslist','Still slow',new Date());assert.equal(discoveryAlerts(s).length,1);
  resolveDiscoveryAlert(s,'craigslist',new Date());assert.ok(discoveryAlerts(s)[0].resolvedAt);
  raiseDiscoveryAlert(s,'craigslist','New slowdown',new Date());assert.equal(discoveryAlerts(s).length,2);assert.notEqual(discoveryAlerts(s)[1].id,id);
 }finally{s.close();}
});

test('app state exposes alerts and dismissal requires CSRF, changes ETag and survives later state reads',async()=>{
 const s=new Store(':memory:'),app=createApp(s,mkdtempSync(join(tmpdir(),'discovery-alert-api-')),{demo:true});
 await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
 try{
  raiseDiscoveryAlert(s,'craigslist','Results slowed',new Date());
  const first=await fetch(base+'/api/state?compact=1'),etag=first.headers.get('etag')!,state=await first.json() as any;
  const body=JSON.stringify({id:state.discoveryAlerts[0].id});
  assert.equal((await fetch(base+'/api/discovery-alerts/dismiss',{method:'POST',headers:{'content-type':'application/json'},body})).status,403);
  assert.equal(discoveryAlerts(s)[0].dismissedAt,undefined);
  assert.equal((await fetch(base+'/api/discovery-alerts/dismiss',{method:'POST',headers:{'content-type':'application/json','x-af-token':state.csrf},body})).status,200);
  const next=await fetch(base+'/api/state?compact=1',{headers:{'if-none-match':etag}});assert.equal(next.status,200);assert.notEqual(next.headers.get('etag'),etag);assert.ok(((await next.json()) as any).discoveryAlerts[0].dismissedAt);
 }finally{await app.close();s.close();}
});
