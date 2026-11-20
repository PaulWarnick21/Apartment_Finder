import test from 'node:test';import assert from 'node:assert/strict';
import {completeZumperSearch,publicZumperRows} from '../server/zumper-discovery.ts';
import {discoveryCards} from '../server/source-discovery.ts';import {sourceById} from '../server/sources.ts';
const url='https://www.zumper.com/apartments-for-rent/vancouver-bc/downtown-vancouver';
const first={url:'/listings/111/one-bedroom-vancouver-bc',min_price:2400,max_price:2400};
const second={url:'/listings/222/one-bedroom-vancouver-bc',min_price:2500,max_price:2500,accountEmail:'private@example.test',csrf:'secret'};
const html='<script>window.__PRELOADED_STATE__ = '+JSON.stringify({currentSearch:{pathname:new URL(url).pathname,searchString:'',hasMoreListables:true,listables:{listables:[first],matching:50,query:{offset:0,limit:25}}}})+';</script>';
function browser(respond=true,changeUrl=false){let handler:any;const frame={};const page:any={on:(_event:string,fn:any)=>{handler=fn;},off:()=>{handler=null;},mainFrame:()=>frame,url:()=>changeUrl?url+'/elsewhere':url,locator:()=>({last:()=>({scrollIntoViewIfNeeded:async()=>{}})}),mouse:{wheel:async()=>{if(respond)handler({url:()=> 'https://www.zumper.com/api/svc/inventory/v1/listables/maplist/search',status:()=>200,frame:()=>frame,text:async()=>JSON.stringify({listables:[second],account:{csrf:'secret'}})});}},waitForTimeout:async()=>{},content:async()=>html};return page;}
test('Zumper accounts its dynamic window and discovers public response rows omitted from SSR',async()=>{
 let pages=0;const captured=await completeZumperSearch(browser(),html,url,async()=>{pages++;},()=>{});
 assert.equal(pages,1);assert.deepEqual(discoveryCards(captured,sourceById('zumper'),url).map(c=>c.url),['https://www.zumper.com'+first.url,'https://www.zumper.com'+second.url]);
 assert.ok(!captured.includes('private@example.test'));assert.ok(!captured.includes('secret'));
 assert.equal(discoveryCards(captured,sourceById('zumper'),url+'?page=2').length,1);
});
test('missing continuation, scope changes and exhausted budgets cannot silently skip the dynamic result window',async()=>{
 await assert.rejects(()=>completeZumperSearch(browser(false),html,url,async()=>{},()=>{}),/did not load/);
 await assert.rejects(()=>completeZumperSearch(browser(true,true),html,url,async()=>{},()=>{}),/changed search scope/);
 await assert.rejects(()=>completeZumperSearch(browser(),html,url,async()=>{throw Error('page cap reached');},()=>{}),/page cap/);
 assert.throws(()=>publicZumperRows(Array.from({length:101},()=>second)),/bounded/);
});
