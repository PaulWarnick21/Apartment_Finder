import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateCallback,hasPlanPermission,verifyIdentity,ChatGptConnection} from '../server/chatgpt.ts';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {CredentialVault} from '../server/credential-vault.ts';
import {completedText} from '../server/response-stream.ts';
import {createVisionProvider} from '../server/chatgpt-provider.ts';
import {capsSchema,photoSchema} from '../src/domain.ts';
import {photoRequest} from '../server/provider.ts';
import {Store} from '../server/db.ts';
import {Budget,createPlan,approvePlan,claimPlan,getPlan} from '../server/plans.ts';

const params=(state='state',client='issued')=>new URLSearchParams({state,client_id:client,code:'one-use-code'});
test('ID tokens require valid signature, issuer, audience, expiry, nonce and saved identity',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256'),keys=createLocalJWKSet({keys:[await exportJWK(publicKey)]});
 const sign=(audience='client',expires='2m',iss='https://auth.openai.com')=>new SignJWT({nonce:'nonce',email:'test@example.test'}).setProtectedHeader({alg:'RS256'}).setIssuer(iss).setSubject('subject').setAudience(audience).setExpirationTime(expires).sign(privateKey);
 const token=await sign();assert.equal((await verifyIdentity(token,'client','nonce','subject',keys)).subject,'subject');
 await assert.rejects(verifyIdentity(token,'other','nonce',undefined,keys));
 await assert.rejects(verifyIdentity(token,'client','wrong',undefined,keys));
 await assert.rejects(verifyIdentity(token,'client','nonce','other-subject',keys));
 await assert.rejects(verifyIdentity(await sign('client','-1m'),'client','nonce',undefined,keys));
 await assert.rejects(verifyIdentity(await sign('client','2m','https://attacker.test'),'client','nonce',undefined,keys));
 const parts=token.split('.');parts[1]=Buffer.from(JSON.stringify({sub:'changed'})).toString('base64url');await assert.rejects(verifyIdentity(parts.join('.'),'client','nonce',undefined,keys));
});
test('OAuth binds callback to attempt and issued client, rejecting missing and mismatched registrations',()=>{
 assert.deepEqual(validateCallback(params(),'state'),{client:'issued',code:'one-use-code'});
 assert.throws(()=>validateCallback(params('wrong'),'state'),/state/);
 assert.throws(()=>validateCallback(params(),'state','other-client'),/different/);
 assert.throws(()=>validateCallback(params('state','dynamic_agent_client'),'state'),/incomplete/);
 const missing=params();missing.delete('client_id');assert.throws(()=>validateCallback(missing,'state'),/incomplete/);
 assert.equal(validateCallback(missing,'state','saved-client').client,'saved-client');
 const denied=params();denied.set('error','access_denied');assert.throws(()=>validateCallback(denied,'state'),/declined/);
 const duplicate=params();duplicate.append('state','state');assert.throws(()=>validateCallback(duplicate,'state'),/state/);
});
test('identity alone does not enable plan usage',()=>{
 assert.equal(hasPlanPermission({access:'test',expires:9999999999999,scopes:['openid','profile']}),false);
 assert.equal(hasPlanPermission({access:'test',expires:9999999999999,scopes:['resource.invoke','chatgpt.tokens.use.direct']}),true);
});
function stream(events:unknown[],chunkSize=7){const bytes=new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join(''));let offset=0;return new Response(new ReadableStream({pull(controller){if(offset>=bytes.length){controller.close();return;}controller.enqueue(bytes.slice(offset,offset+chunkSize));offset+=chunkSize;}}));}
test('stream handles split UTF-8 and CRLF and requires a completed terminal event',async()=>{
 const delta={type:'response.output_text.delta',delta:'{"note":"ocean 🌊"}'};
 assert.equal(await completedText(stream([delta,{type:'response.completed',response:{status:'completed'}}],1)),delta.delta);
 await assert.rejects(completedText(stream([delta])),/before completion/);
 await assert.rejects(completedText(stream([delta,{type:'response.incomplete'}])),/did not complete/);
 await assert.rejects(completedText(stream([delta,{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}])),/usage limit reached/);
 await assert.rejects(completedText(new Response('{}',{status:429})),/HTTP 429/);
});
test('photo requests support images without fields forbidden by ChatGPT plan usage',()=>{
 const body=photoRequest(photoSchema.parse({id:'p1',url:'https://example.test/p.jpg'}),Buffer.from('test'),'chosen-model');
 assert.equal(body.store,false);assert.equal(body.model,'chosen-model');assert.ok(body.input[0].content.some(c=>c.type==='input_image'));
 for(const field of ['max_output_tokens','temperature','previous_response_id','background'])assert.equal(field in body,false);
});
test('ChatGPT budgets count AI calls without reserving paid API dollars',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'af-plan-'));const store=new Store(join(dir,'test.sqlite'));
 try{const p=createPlan(store,{billingMode:'chatgpt',sources:['craigslist'],maxPages:2,maxListings:1,maxPhotos:2,maxAiCalls:1,maxReservedUsd:0});approvePlan(store,p.id,'APPROVE ONE SCAN');claimPlan(store,p.id);const budget=new Budget(store,p.id,p.caps);budget.reserveAi();assert.equal(getPlan(store,p.id).usage.reservedUsd,0);assert.equal(getPlan(store,p.id).usage.aiCalls,1);assert.throws(()=>budget.reserveAi(),/cap/);}finally{store.db.close();await rm(dir,{recursive:true,force:true});}
});
test('configured paid API key is never a fallback for disconnected ChatGPT',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'af-no-fallback-'));const oldMode=process.env.AI_PROVIDER,oldKey=process.env.OPENAI_API_KEY;process.env.AI_PROVIDER='chatgpt';process.env.OPENAI_API_KEY='fake-paid-key';
 const previous=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('Unexpected network call');};
 try{const caps=capsSchema.parse({billingMode:'chatgpt',sources:['craigslist'],maxPages:2,maxListings:1,maxPhotos:1,maxAiCalls:1,maxReservedUsd:0});await assert.rejects(createVisionProvider(dir,caps),/Connect ChatGPT/);await assert.rejects(createVisionProvider(dir,{...caps,billingMode:'api'}),/billing mode changed/);assert.equal(calls,0);}finally{globalThis.fetch=previous;if(oldMode===undefined)delete process.env.AI_PROVIDER;else process.env.AI_PROVIDER=oldMode;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;await rm(dir,{recursive:true,force:true});}
});
test('Windows vault encrypts credentials and serializes updates',{skip:process.platform!=='win32'},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'af-vault-'));const vault=new CredentialVault(dir,()=>({secret:'test-secret-not-real',count:0}));
 try{await vault.write({secret:'test-secret-not-real',count:0});assert.equal((await readFile(join(dir,'credentials.dpapi'),'utf8')).includes('test-secret-not-real'),false);await Promise.all([1,2].map(()=>vault.locked(async()=>{const s=await vault.read();s.count++;await vault.write(s);})));assert.equal((await vault.read()).count,2);}finally{await rm(dir,{recursive:true,force:true});}
});
test('safe connection state contains no credentials and startup makes no requests',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'af-state-'));const connection=new ChatGptConnection(dir);
 try{const state=await connection.state();assert.equal(state.connected,false);assert.equal(state.sharing,false);assert.equal(state.pending,false);assert.equal(JSON.stringify(state).includes('access_token'),false);}finally{connection.close();await rm(dir,{recursive:true,force:true});}
});
