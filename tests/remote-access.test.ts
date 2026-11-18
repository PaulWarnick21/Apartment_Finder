import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {request,type IncomingHttpHeaders,type OutgoingHttpHeaders,type IncomingMessage} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/db.ts';
import {createApp} from '../server/api.ts';
import {listingSchema} from '../src/domain.ts';
import {remoteAccessFromEnv,requestAccess,type RemoteAccess} from '../server/request-access.ts';

const remote=remoteAccessFromEnv({AF_REMOTE_ORIGIN:'https://finder.tailfixture.ts.net',AF_REMOTE_USER:'owner@example.test'})!;
const identity={host:remote.host,'tailscale-user-login':remote.user};
const photo='a'.repeat(64)+'.jpg';
async function fixture(t:TestContext,remoteAccess:RemoteAccess|null=remote){
 const dir=mkdtempSync(join(tmpdir(),'af-remote-')),store=new Store(':memory:');
 mkdirSync(join(dir,'media'));writeFileSync(join(dir,'media',photo),'offline photo fixture');
 const id=store.ingest(listingSchema.parse({source:'fixture',sourceId:'phone',url:'https://example.test/phone',title:'Phone fixture',address:'100 Example Street',rent:2300,beds:1,laundry:'in-unit',galleryComplete:true,expectedPhotos:1,photos:[{id:'view',url:'https://example.test/photo.jpg',local:photo,status:'reviewed',kind:'interior',scenery:'nature',quality:4,unitCertain:true}]})).id;
 const app=createApp(store,dir,{demo:true,remoteAccess});
 await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));
 t.after(async()=>{await app.close();store.close();rmSync(dir,{recursive:true,force:true});});
 // The HTTP client below uses node:http. Any accidental provider or source fetch fails.
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('External fetch forbidden in phone-access tests');});
 const port=(app.server.address() as {port:number}).port,local=`http://127.0.0.1:${port}`;
 const call=(path:string,headers:OutgoingHttpHeaders={},method='GET',body?:unknown)=>new Promise<{status:number;headers:IncomingHttpHeaders;text:string;json:()=>any}>((resolve,reject)=>{
  const req=request({hostname:'127.0.0.1',port,path,method,headers:{...headers,...(body===undefined?{}:{'content-type':'application/json'})},agent:false},res=>{
   const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(Buffer.from(chunk)));res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');resolve({status:res.statusCode!,headers:res.headers,text,json:()=>JSON.parse(text)});});
  });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
 });
 return {store,id,call,local};
}

test('phone access is opt-in and rejects partial or ambiguous configuration',()=>{
 assert.equal(remoteAccessFromEnv({}),null);
 for(const env of [
  {AF_REMOTE_ORIGIN:remote.origin},{AF_REMOTE_USER:remote.user},
  ...['http://finder.tailfixture.ts.net','https://finder.example.com','https://*.tailfixture.ts.net','https://finder.tailfixture.ts.net/','https://finder.tailfixture.ts.net:8443','https://finder.tailfixture.ts.net/path','https://finder.tailfixture.ts.net?query','https://finder.tailfixture.ts.net#fragment','https://user:password@finder.tailfixture.ts.net','https://finder.tailfixture.ts.net.evil.test'].map(AF_REMOTE_ORIGIN=>({AF_REMOTE_ORIGIN,AF_REMOTE_USER:remote.user})),
  ...[' owner@example.test','owner@example.test,other@example.test','owner\n@example.test','öwner@example.test'].map(AF_REMOTE_USER=>({AF_REMOTE_ORIGIN:remote.origin,AF_REMOTE_USER})),
 ])assert.throws(()=>remoteAccessFromEnv(env),/AF_REMOTE_/);
 assert.deepEqual(remote,{origin:'https://finder.tailfixture.ts.net',host:'finder.tailfixture.ts.net',user:'owner@example.test'});
 const store=new Store(':memory:');try{assert.throws(()=>createApp(store,'.',{dev:true,remoteAccess:remote}),/production build/);}finally{store.close();}
});

test('all remote API, page, and photo requests require the exact host and Serve identity',async t=>{
 const {call,id}=await fixture(t);
 for(const path of ['/','/api/health','/api/state',`/api/homes/${id}`,`/media/${photo}`]){
  for(const headers of [{host:remote.host},{...identity,'tailscale-user-login':'other@example.test'},{...identity,host:'other.tailfixture.ts.net'},{...identity,host:'finder.tailfixture.ts.net.evil.test'},{...identity,'tailscale-funnel-request':'?1'},{...identity,'tailscale-user-login':[remote.user,remote.user]}]){
   const response=await call(path,headers);assert.equal(response.status,403,`${path}: ${JSON.stringify(headers)}`);assert.ok(!response.text.includes('Phone fixture'));
  }
 }
 assert.equal((await call('/api/state',identity)).status,200);
 assert.equal((await call(`/media/${photo}`,identity)).text,'offline photo fixture');
 const page=await call('/',identity);assert.notEqual(page.status,403); // Production bundle may be absent on a clean checkout.
});

test('phone can read saved apartments and persist notes and stage with exact origin and CSRF',async t=>{
 const {store,call,id,local}=await fixture(t);
 const state=(await call('/api/state',identity)).json();assert.equal(state.schedule.enabled,false);assert.equal(state.plans.length,0);
 const home=(await call(`/api/homes/${id}`,identity)).json();assert.equal(home.listing.title,'Phone fixture');
 const input={revision:home.revision,stage:'Interested',notes:'Saved from phone',followUp:'2026-12-01',viewing:'',rescued:false};
 const saved=await call(`/api/homes/${id}`,{...identity,origin:remote.origin,'x-af-token':state.csrf},'PUT',input);
 assert.equal(saved.status,200,saved.text);assert.equal(store.home(id)!.notes,input.notes);assert.equal(store.home(id)!.stage,'Interested');
 assert.equal((await call(`/api/homes/${id}`)).json().notes,input.notes);
 const localSaved=await call(`/api/homes/${id}`,{origin:local,'x-af-token':state.csrf},'PUT',{...input,revision:saved.json().revision,notes:'Saved on desktop'});
 assert.equal(localSaved.status,200,localSaved.text);assert.equal((await call(`/api/homes/${id}`,identity)).json().notes,'Saved on desktop');
});

test('remote mutations cannot omit or spoof origin, CSRF, or identity',async t=>{
 const {store,call,id}=await fixture(t),state=(await call('/api/state',identity)).json(),home=store.home(id)!;
 const input={revision:home.revision,stage:'Interested',notes:'Must not persist',followUp:'',viewing:'',rescued:false};
 for(const headers of [
  {...identity,'x-af-token':state.csrf},
  {...identity,origin:'null','x-af-token':state.csrf},
  {...identity,origin:'https://evil.test','x-af-token':state.csrf},
  {...identity,origin:`http://${remote.host}`,'x-af-token':state.csrf},
  {...identity,origin:remote.origin},
  {...identity,origin:remote.origin,'x-af-token':'wrong'},
  {...identity,origin:remote.origin,'x-af-token':state.csrf,'tailscale-user-login':'other@example.test'},
  {...identity,Origin:[remote.origin,remote.origin],'x-af-token':state.csrf},
 ])assert.equal((await call(`/api/homes/${id}`,headers,'PUT',input)).status,403);
 assert.equal(store.home(id)!.revision,home.revision);assert.equal(store.home(id)!.notes,'');
});

test('forwarded headers cannot bypass local-only defaults or downgrade remote identity checks',async t=>{
 const {call,local}=await fixture(t,null);
 assert.equal((await call('/api/state',identity)).status,403);
 const localHost=new URL(local).host;
 for(const headers of [
  {host:localHost,'tailscale-user-login':remote.user},
  {host:localHost,'tailscale-user-login':'other@example.test'},
  {host:localHost,'x-forwarded-host':remote.host,'x-forwarded-proto':'https'},
  {host:localHost,forwarded:'host='+remote.host},
  {host:'evil.test','x-forwarded-host':localHost},
 ])assert.equal((await call('/api/state',headers)).status,403);
 assert.equal((await call('/api/health')).status,200);
 assert.equal((await call('https://evil.test/api/state')).status,403);
 const forged={socket:{remoteAddress:'192.168.1.20'},headers:identity,headersDistinct:{}} as unknown as IncomingMessage;
 assert.equal(requestAccess(forged,remote),null);
});

test('desktop extension remains local and phone reconnect explains the desktop requirement',async t=>{
 const {call}=await fixture(t),state=(await call('/api/state',identity)).json(),extensionOrigin='chrome-extension://'+'a'.repeat(32);
 assert.equal((await call('/api/browser-bridge/pair',identity,'POST',{})).status,403);
 assert.equal((await call('/api/browser-bridge/pair',{...identity,origin:extensionOrigin},'OPTIONS')).status,403);
 const localPreflight=await call('/api/browser-bridge/pair',{origin:extensionOrigin},'OPTIONS');assert.equal(localPreflight.status,204);assert.equal(localPreflight.headers['access-control-allow-origin'],extensionOrigin);
 const reconnect=await call('/api/chatgpt/connect',{...identity,origin:remote.origin,'x-af-token':state.csrf},'POST',{});
 assert.equal(reconnect.status,403);assert.match(reconnect.json().error,/desktop/);
});
