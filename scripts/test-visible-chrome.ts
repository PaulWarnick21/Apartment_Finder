// Explicit, supervised access recovery. Never imported by the app or scheduler.
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createInterface} from 'node:readline';
import {setTimeout as sleep} from 'node:timers/promises';
import {Store} from '../server/db.ts';
import {createPlan,approvePlan,claimPlan,Budget,getPlan} from '../server/plans.ts';
import {sourceById} from '../server/sources.ts';
import {SourceSession,diagnosticUrl} from '../server/transport.ts';
if(!process.argv.includes('--run')||!process.argv.includes('--recover-approved')){console.log('No browser started. Requires explicit user authorization of a supervised recovery test, --run and --recover-approved.');process.exit(0);}
const manifest=JSON.parse(await readFile(process.argv[2],'utf8')) as {source:string;url:string}[];
if(manifest.length>6||new Set(manifest.map(p=>p.source)).size!==manifest.length)throw new Error('At most one recovery page per source, six sources total.');
const dir=resolve('data/live'),out=join(dir,'chrome-access-test'),store=new Store(join(dir,'apartments.sqlite')),results:any[]=[];
await mkdir(out,{recursive:true});const input=createInterface({input:process.stdin});
try{for(const entry of manifest){const source=sourceById(entry.source);let session:SourceSession|undefined,plan:any;
 const result:any={source:source.id,url:diagnosticUrl(entry.url),at:new Date().toISOString(),status:'pending'};
 try{plan=createPlan(store,{purpose:'access-check',billingMode:'chatgpt',sources:[source.id],maxPages:1,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0},{accessRecovery:true});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);store.event(`${source.name}: user-authorized, one-page visible Chrome recovery check; previous pause retained until outcome.`);
 session=new SourceSession(source,new Budget(store,plan.id,plan.caps),dir,{visibleChrome:true,accessRecovery:true});await session.start();const html=await session.html(entry.url);
 result.title=await session.page!.title();result.finalUrl=diagnosticUrl(session.page!.url());
 if(!html)result.status='listing-not-found';
 else if(source.id==='facebook'&&await session.page!.locator('input[type="password"]').count()){
 // The unique per-plan marker also supports runners whose stdin closes between turns.
 const readyFile=join(out,`${plan.id}.ready`);
 result.status='login-required';result.readyFile=readyFile;await writeFile(join(out,'progress.json'),JSON.stringify([...results,result],null,2));console.log(JSON.stringify({source:source.id,status:'login-required',readyFile,message:'Dedicated Chrome is open. Sign in manually, then reply Ready. Credentials are never read or saved by this script.'}));
 const completion=await new Promise<string>(resolveWait=>{let finished=false;const timer=setTimeout(()=>finish('timeout'),15*60*1000);const poll=setInterval(()=>{void access(readyFile).then(()=>finish('ready'),()=>{});},1000);const closed=()=>finish('closed'),line=()=>finish('ready');function finish(value:string){if(finished)return;finished=true;clearTimeout(timer);clearInterval(poll);input.off('line',line);session!.context!.off('close',closed);resolveWait(value);}input.once('line',line);session!.context!.once('close',closed);});
 if(completion==='ready'){if(await session.page!.locator('input[type="password"]').count())result.status='login-still-required';else if(session.stopped)result.status='access-warning';else {const links=await session.page!.locator('a[href*="/marketplace/item/"]').count();result.status=links?'marketplace-links-visible':'login-form-gone-listing-unverified';result.marketplaceLinks=links;result.finalUrl=diagnosticUrl(session.page!.url());}}
 else result.status=completion==='closed'?'login-window-closed':'login-handoff-timed-out';
 }else {result.status='page-opened';const text=await session.page!.locator('body').innerText();result.publicExcerpt=text.replace(/\s+/g,' ').slice(0,800);}
 }catch(e){result.status='failed';result.error=String(e).slice(0,600);}finally{result.diagnostics=session?.diagnostics??[];await session?.close().catch(()=>{});if(plan){result.usage=getPlan(store,plan.id).usage;store.db.prepare('UPDATE plans SET state=?,detail=? WHERE id=?').run(['page-opened','marketplace-links-visible'].includes(result.status)?'complete':'partial',`Visible Chrome access test: ${result.status}. No extraction or AI requests.`,plan.id);store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(plan.id);}store.event(`${source.name}: visible Chrome test ${result.status}; no automatic rescan enabled.`);results.push(result);await writeFile(join(out,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(result));}
 if(entry!==manifest.at(-1))await sleep(10000);
}}finally{input.close();store.close();}
