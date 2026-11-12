// One user-authorized access check per source. Does not run at application startup.
import {loadEnvFile} from 'node:process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {load} from 'cheerio';
import {Store} from '../server/db.ts';
import {sources,allowedUrl} from '../server/sources.ts';
import {createPlan,approvePlan,claimPlan,Budget} from '../server/plans.ts';
import {SourceSession} from '../server/transport.ts';
if(!process.argv.includes('--run')){console.log('No requests made. Explicit --run is required for the authorized source trial.');process.exit(0);}
loadEnvFile('.env');
const dir=resolve('data/live'),out=join(dir,'initial-trial'),store=new Store(join(dir,'apartments.sqlite'));
await mkdir(out,{recursive:true});await store.backupTo(resolve('data/backups/before-all-source-trial.sqlite'));
const report:any[]=[];
try{for(const source of sources){let session:SourceSession|undefined,plan:any;const result:any={source:source.id,url:source.search,checkedAt:new Date().toISOString()};
 try{plan=createPlan(store,{purpose:'access-check',billingMode:'chatgpt',sources:[source.id],maxPages:1,maxListings:3,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);session=new SourceSession(source,new Budget(store,plan.id,plan.caps),dir);await session.start();const html=await session.html(source.search);if(!html)throw new Error('Discovery page not found');await writeFile(join(out,`${source.id}-discovery.html`),html);
 const $=load(html);result.title=$('title').text();result.links=[];result.externalHosts=[];$('a[href]').each((_,a)=>{try{const url=new URL($(a).attr('href')!,source.search);if(allowedUrl(url.href,source.hosts))result.links.push({url:url.href,text:$(a).text().trim().slice(0,140)});}catch{}});result.links=[...new Map(result.links.map((l:any)=>[l.url,l])).values()];$('script[src],link[href],img[src]').each((_,e)=>{try{const u=new URL($(e).attr('src')||$(e).attr('href')!,source.search);if(!source.hosts.includes(u.hostname))result.externalHosts.push(u.hostname);}catch{}});result.externalHosts=[...new Set(result.externalHosts)];$('script,style,nav,footer').remove();result.text=$('body').text().replace(/\s+/g,' ').trim().slice(0,12000);
 if(source.id==='facebook'&&!result.links.some((l:any)=>l.url.includes('/marketplace/item/'))){store.pause(source.id,'Facebook requires an authenticated scanner session; no listing access established',true);result.status='login-required';}else result.status='accessible';
 }catch(e){result.status='unavailable';result.error=String(e).slice(0,500);}finally{await session?.close();if(plan){store.db.prepare('UPDATE plans SET state=?,detail=? WHERE id=?').run(result.status==='accessible'?'complete':'partial',`Access check: ${result.error??result.status}. No listings or AI calls processed.`,plan.id);store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(plan.id);}report.push(result);await writeFile(join(out,'access-report.json'),JSON.stringify(report,null,2));store.event(`${source.name} initial access check: ${result.status}${result.error?': '+result.error:''}`);console.log(JSON.stringify({source:result.source,status:result.status,title:result.title,links:result.links?.length,error:result.error}));}}
}finally{store.close();}
