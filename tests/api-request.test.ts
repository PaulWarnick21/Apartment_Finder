import test from 'node:test';
import assert from 'node:assert/strict';
import {apiRequest,ApiError} from '../src/api-request.ts';

test('empty, HTML and interrupted responses have actionable errors rather than Safari parse errors',async()=>{
 for(const response of [new Response('',{status:200}),new Response('<html>Proxy unavailable</html>',{status:502}),new Response('{"partial":',{status:200})]){
  await assert.rejects(apiRequest('homes/1','PUT',{},'fixture',async()=>response),error=>error instanceof ApiError&&error.recoverable&&/unreadable response/.test(error.message)&&!error.message.includes('<html>'));
 }
 await assert.rejects(apiRequest('homes/1','PUT',{},'fixture',async()=>{throw new TypeError('Failed to fetch');}),error=>error instanceof ApiError&&error.recoverable&&/connection was interrupted/.test(error.message));
});

test('only recoverable HTTP failures allow an automatic decision retry',async()=>{
 for(const [status,recoverable] of [[400,false],[403,false],[404,false],[409,true],[429,false],[503,true]] as const){
  await assert.rejects(apiRequest('homes/1','PUT',{},'fixture',async()=>Response.json({error:'Saved error'},{status})),error=>error instanceof ApiError&&error.status===status&&error.recoverable===recoverable&&error.message==='Saved error');
 }
});

test('requests use the current token and bypass cached apartment state during recovery',async()=>{
 const result=await apiRequest('homes/1','PUT',{revision:7},'current-token',async(url,init)=>{
  assert.equal(url,'/api/homes/1');assert.equal(init?.method,'PUT');assert.equal(init?.cache,'no-store');
  assert.equal(new Headers(init?.headers).get('X-AF-Token'),'current-token');assert.equal(init?.body,'{"revision":7}');
  return Response.json({revision:8});
 });assert.equal(result.revision,8);
});
