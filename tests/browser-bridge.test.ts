import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {BrowserBridge,extensionOrigin,listingUrl,testListingUrl} from '../server/browser-bridge.ts';
import {createApp} from '../server/api.ts';
const extensionId='a'.repeat(32),origin=`chrome-extension://${extensionId}`;
function setup(){const db=new Store(':memory:'),dir=mkdtempSync(join(tmpdir(),'af-bridge-'));return {db,dir,bridge:new BrowserBridge(db,dir)};}
function sample(id:string){return {id,url:testListingUrl,title:'Test listing',text:'Test listing',html:'<main>Test listing</main>',images:[{url:'https://images.example/photo.jpg',alt:'Window',width:1000,height:800}],advertisedPhotos:20,galleryComplete:false,warning:null,truncated:false};}

test('pairing is one-time, origin-bound, revocable and never exposes stored token',()=>{
 const {db,bridge}=setup();try{
  assert.throws(()=>bridge.claim({url:testListingUrl}),/approved/);
  const {code}=bridge.prepare();assert.throws(()=>bridge.pair({code,extensionId},'https://evil.example'),/origin/);
  const {token}=bridge.pair({code,extensionId},origin);
  assert.throws(()=>bridge.pair({code,extensionId},origin),/expired/);
  bridge.authenticate(extensionId,`Bearer ${token}`,origin);
  assert.throws(()=>bridge.authenticate('b'.repeat(32),`Bearer ${token}`),/connected/);
  assert.throws(()=>bridge.authenticate(extensionId,'Bearer wrong',origin),/connected/);
  assert.ok(!JSON.stringify(bridge.state()).includes(token));
  assert.ok(!JSON.stringify(db.get('browserExtension')).includes(token));
  bridge.disconnect();assert.throws(()=>bridge.authenticate(extensionId,`Bearer ${token}`,origin),/connected/);
  assert.throws(()=>bridge.claim({url:testListingUrl}),/approved/);
 }finally{db.close();}
});

test('one approved page capture is single-use and cannot claim full photo review',()=>{
 const {db,dir,bridge}=setup();try{
  bridge.prepare();assert.throws(()=>bridge.claim({url:'https://www.apartments.com/another-unit/abcdefg/'}),/approved/);
  const claim=bridge.claim({url:testListingUrl});assert.throws(()=>bridge.claim({url:testListingUrl}),/approved/);
  assert.throws(()=>bridge.save({...sample(claim.id),galleryComplete:true}),/false/);
  bridge.save(sample(claim.id));assert.throws(()=>bridge.save(sample(claim.id)),/already used/);
  const files=readdirSync(join(dir,'browser-captures'));assert.equal(files.length,1);
  const capture=JSON.parse(readFileSync(join(dir,'browser-captures',files[0]),'utf8'));assert.equal(capture.galleryComplete,false);
  assert.equal(db.homes().length,0);assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM plans').get()!.n,0);
  assert.equal(bridge.state().lastCapture?.advertisedPhotos,20);
 }finally{db.close();}
});

test('approval expires, restarts do not resume, warnings pause the source',()=>{
 const {db,dir,bridge}=setup(),realNow=Date.now;try{
  const initial=realNow();bridge.prepare();Date.now=()=>initial+660000;
  assert.throws(()=>bridge.claim({url:testListingUrl}),/approved/);Date.now=realNow;
  bridge.prepare();assert.throws(()=>new BrowserBridge(db,dir).claim({url:testListingUrl}),/approved/);
  const p=bridge.claim({url:testListingUrl});bridge.save({...sample(p.id),warning:'Access denied'});
  assert.throws(()=>db.checkSource('apartments'),/Access denied/);
  assert.equal(bridge.state().lastCapture?.state,'failed');
  assert.throws(()=>new BrowserBridge(db,dir,true).prepare(),/demo/);
 }finally{Date.now=realNow;db.close();}
});

test('URL and extension boundaries reject lookalikes and off-site captures',()=>{
 assert.throws(()=>listingUrl('https://www.apartments.com.evil.example/unit/abcdefg/'));
 assert.throws(()=>listingUrl('https://user@www.apartments.com/unit/abcdefg/'));
 assert.throws(()=>listingUrl('http://127.0.0.1/admin'));
 assert.throws(()=>extensionOrigin('null',extensionId));
 assert.throws(()=>extensionOrigin(origin,'not-an-extension'));
 assert.equal(listingUrl(testListingUrl+'?tracking=123'),testListingUrl);
 const manifest=JSON.parse(readFileSync('extension/manifest.json','utf8'));
 assert.deepEqual(manifest.host_permissions,['https://www.apartments.com/*','http://127.0.0.1/*']);
 assert.equal(manifest.background.service_worker,'background.js');assert.equal(manifest.content_scripts,undefined);
});

test('HTTP bridge requires pairing token and does not weaken existing CSRF or CORS',async()=>{
 const {db,dir}=setup(),app=createApp(db,dir);await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${(app.server.address() as {port:number}).port}`;
 const post=(path:string,data:unknown,headers:Record<string,string>={})=>fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
 try{
  assert.equal((await post('browser/prepare',{})).status,403);
  const state=await(await fetch(base+'/api/state')).json() as any;
  const plan=await(await post('browser/prepare',{}, {'X-AF-Token':state.csrf})).json() as any;
  const headers={'Origin':origin,'X-AF-Extension-Id':extensionId};
  assert.equal((await post('browser-bridge/pair',{code:plan.code,extensionId},{...headers,Origin:'https://evil.example'})).status,400);
  const paired=await post('browser-bridge/pair',{code:plan.code,extensionId},headers);
  assert.equal(paired.headers.get('access-control-allow-origin'),origin);const {token}=await paired.json() as any;
  assert.equal((await post('browser-bridge/claim',{url:testListingUrl},headers)).status,400);
  const authorized={...headers,Authorization:`Bearer ${token}`};
  const claimed=await(await post('browser-bridge/claim',{url:testListingUrl},authorized)).json() as any;
  assert.equal((await post('browser-bridge/capture',sample(claimed.id),authorized)).status,200);
  assert.equal((await post('browser/prepare',{}, {...authorized,'X-AF-Token':state.csrf})).status,403);
  const preflight=await fetch(base+'/api/browser-bridge/pair',{method:'OPTIONS',headers:{Origin:'https://evil.example'}});assert.equal(preflight.status,403);
 }finally{await app.close();db.close();}
});
