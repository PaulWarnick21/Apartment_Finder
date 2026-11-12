// Approved initial trial: capture at most three candidate pages per source using the
// persistent visible Chrome sessions already verified by the user. No AI in this step.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {Store} from '../server/db.ts';
import {sourceById} from '../server/sources.ts';
import {SourceSession} from '../server/transport.ts';
import {createPlan,approvePlan,claimPlan,Budget,getPlan} from '../server/plans.ts';
if(!process.argv.includes('--run')){console.log('No requests. Explicit --run required.');process.exit(0);}
const manifest=JSON.parse(await readFile(process.argv[2],'utf8')) as {source:string;urls:string[];offset?:number}[];
const dir=resolve('data/live'),out=join(dir,'remaining-trial');await mkdir(out,{recursive:true});
const store=new Store(join(dir,'apartments.sqlite'));
try{for(const item of manifest){if(!['zillow','rew','facebook'].includes(item.source)||item.urls.length>3)throw new Error('Outside remaining trial limits');
 let plan:any,session:SourceSession|undefined,error='';try{
  plan=createPlan(store,{purpose:'access-check',billingMode:'chatgpt',sources:[item.source],maxPages:item.urls.length,maxListings:3,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);
  session=new SourceSession(sourceById(item.source),new Budget(store,plan.id,plan.caps),dir,{visibleChrome:true});await session.start();
  for(const [i,url] of item.urls.entries()){
   const html=await session.html(url);if(!html)throw new Error('Listing missing');
   if(await session.page!.locator('input[type="password"]:visible').count())throw new Error('Sign-in needed; stop without retries');
   const data=await session.page!.evaluate(()=>({url:location.href,title:document.title,text:document.body.innerText,images:Array.from(document.images).map(im=>({src:im.currentSrc||im.src,alt:im.alt,width:im.naturalWidth,height:im.naturalHeight})),links:Array.from(document.querySelectorAll('a[href]')).map(a=>({url:(a as HTMLAnchorElement).href,text:(a.textContent??'').trim()}))}));
   await writeFile(join(out,`${item.source}-${i+1+(item.offset??0)}.html`),html);await writeFile(join(out,`${item.source}-${i+1+(item.offset??0)}.json`),JSON.stringify(data,null,2));
   console.log(JSON.stringify({source:item.source,title:data.title,images:data.images.length,text:data.text.slice(0,250)}));
  }
 }catch(e){error=String(e);console.log(JSON.stringify({source:item.source,error}));}
 finally{await session?.close();if(plan){store.db.prepare('UPDATE plans SET state=?,detail=? WHERE id=?').run(error?'partial':'complete',error||'Remaining trial page evidence saved; photo review pending.',plan.id);store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(plan.id);console.log(JSON.stringify({source:item.source,usage:getPlan(store,plan.id).usage}));}}
}}finally{store.close();}
