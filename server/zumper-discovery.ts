import {load} from 'cheerio';
import type {Page,Response} from 'playwright';
import {zumperState} from './zumper-extraction.ts';

/** Only public result-card fields from the current page's observed inventory response. */
export function publicZumperRows(value:unknown){
 if(!Array.isArray(value))throw Error('Zumper continuation did not contain a result list');
 if(value.length>100)throw Error('Zumper continuation exceeds the bounded result window');
 return value.filter(row=>row&&typeof row==='object'&&typeof row.url==='string').map(row=>Object.fromEntries(
  ['url','title','min_price','max_price','min_bedrooms','max_bedrooms','city','neighborhood_name','listed_on'].filter(key=>['string','number'].includes(typeof row[key])).map(key=>[key,row[key]])
 ));
}
export function hydratedZumperRows(html:string,url:string):any[]{
 try{const $=load(html),state=JSON.parse($('#af-zumper-current-results').text());return state.url===url?publicZumperRows(state.rows):[];}catch{return [];}
}
/** A real browser scroll reveals the second half omitted by the SSR snapshot. */
export async function completeZumperSearch(page:Page,html:string,url:string,reserve:()=>Promise<void>,check:()=>void){
 let state:any;try{state=zumperState(html).currentSearch;}catch{return html;}
 if(!state||state.pathname!==new URL(url).pathname||state.searchString!==new URL(url).search||!Array.isArray(state.listables?.listables))return html;
 const current=state.listables,offset=Number(current.query?.offset??0),total=Number(current.matching);
 if(!state.hasMoreListables||Number.isFinite(total)&&offset+current.listables.length>=total)return html;
 const pending:Promise<void>[]=[];let rows:any[]|undefined,responseError:unknown;
 const onResponse=(response:Response)=>{
  try{const parsed=new URL(response.url());if(parsed.origin!=='https://www.zumper.com'||parsed.pathname!=='/api/svc/inventory/v1/listables/maplist/search'||response.frame()!==page.mainFrame()||response.status()!==200)return;
   pending.push((async()=>{const raw=await response.text();if(raw.length>5_000_000)throw Error('Zumper continuation response too large');const data=JSON.parse(raw);rows=publicZumperRows(data.listables);})().catch(error=>{responseError=error;}));
  }catch{/* Other browser responses are unrelated to the selected search. */}
 };
 page.on('response',onResponse);
 try{
  await reserve();check();
  await page.locator('[data-testid="listing-card"]').last().scrollIntoViewIfNeeded({timeout:10000});
  await page.mouse.wheel(0,1800);await page.waitForTimeout(5000);check();
  await Promise.all(pending);
  if(responseError)throw responseError;
  if(page.url()!==url)throw Error('Zumper continuation changed search scope; inventory remains incomplete');
  if(!rows)throw Error('Zumper dynamic result window did not load; inventory remains incomplete');
  const captured=await page.content();
  return captured+'<script id="af-zumper-current-results" type="application/json">'+JSON.stringify({url,rows}).replaceAll('<','\\u003c')+'</script>';
 }finally{page.off('response',onResponse);}
}
