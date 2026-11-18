import test from 'node:test';
import assert from 'node:assert/strict';
import {requestAttribution} from '../server/gallery-review.ts';
import {listingSchema} from '../src/domain.ts';
test('attribution uses ChatGPT message input and sends only saved text evidence',async()=>{
 const original=globalThis.fetch;let sent:any;
 globalThis.fetch=async(_url,options)=>{sent=JSON.parse(String(options?.body));return new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({photos:[]})}]}]}})+'\n\n');};
 try{
  const listing=listingSchema.parse({source:'vada',sourceId:'test',url:'https://vadapm.com/test',title:'Fixture',address:'Fixture',area:'Unknown',rent:null,beds:null,photos:[]});
  assert.deepEqual(await requestAttribution([],listing,'fixture','fixture'),{photos:[]});
  assert.equal(sent.input[0].role,'user');assert.equal(sent.input[0].content[0].type,'input_text');
  assert.deepEqual(JSON.parse(sent.input[0].content[0].text),{photos:[]});assert.equal(sent.tools,undefined);assert.equal(sent.stream,true);assert.equal(sent.store,false);
 }finally{globalThis.fetch=original;}
});
