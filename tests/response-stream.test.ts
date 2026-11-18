import test from 'node:test';
import assert from 'node:assert/strict';
import {completedText} from '../server/response-stream.ts';
const frame=(value:unknown)=>'data: '+JSON.stringify(value)+'\n\n';
const terminal=(text:string)=>({type:'response.completed',response:{status:'completed',output:[{content:[{type:'output_text',text}]}]}});

test('bounded streaming metadata may exceed two megabytes without discarding a small completed assessment',async()=>{
 const metadata=Array.from({length:30},()=>frame({type:'response.reasoning.delta',delta:'x'.repeat(100000)}));
 const chunks=[...metadata,frame(terminal('{"photos":[]}'))],encoder=new TextEncoder();
 const response=new Response(new ReadableStream({pull(controller){const chunk=chunks.shift();if(chunk)controller.enqueue(encoder.encode(chunk));else controller.close();}}));
 assert.equal(await completedText(response),'{"photos":[]}');
});

test('oversized final or incremental assessment text remains rejected',async()=>{
 await assert.rejects(completedText(new Response(frame(terminal('x'.repeat(2_000_001))))),/assessment exceeded/);
 await assert.rejects(completedText(new Response(frame({type:'response.output_text.delta',delta:'x'.repeat(2_000_001)})+frame(terminal('small')))),/assessment exceeded/);
});

test('an oversized unfinished event is rejected before unbounded buffering',async()=>{
 await assert.rejects(completedText(new Response('data: '+ 'x'.repeat(8_000_001))),/event exceeded/);
});
