// Bounded trial navigation; manifest URLs must pass each source's host allowlist.
import {loadEnvFile} from 'node:process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {load} from 'cheerio';
import {Store} from '../server/db.ts';
import {sourceById,allowedUrl} from '../server/sources.ts';
import {createPlan,approvePlan,claimPlan,Budget} from '../server/plans.ts';
import {SourceSession} from '../server/transport.ts';
if(!process.argv.includes('--run')||!process.argv[2]){console.log('No requests made. Provide a trial manifest and --run.');process.exit(0);}
loadEnvFile('.env');const dir=resolve('data/live'),out=join(dir,'initial-trial'),store=new Store(join(dir,'apartments.sqlite'));
const manifest=JSON.parse(await readFile(process.argv[2],'utf8')) as {source:string;pages:{url:string;file:string;kind:'discovery'|'detail'|'resource'}[]}[];
try{for(const group of manifest){const source=sourceById(group.source);let session:SourceSession|undefined,plan:any,error='';
 try{if(group.pages.length>4)throw new Error('Trial navigation cap exceeded');plan=createPlan(store,{purpose:'access-check',billingMode:'chatgpt',sources:[source.id],maxPages:group.pages.length,maxListings:3,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);const budget=new Budget(store,plan.id,plan.caps);session=new SourceSession(source,budget,dir);await session.start();
 for(const p of group.pages){if(!/^[a-z0-9-]+$/.test(p.file))throw new Error('Invalid snapshot name');if(p.kind==='detail')budget.reserve('listings');const html=p.kind==='resource'?await session.resource(p.url):await session.html(p.url);if(!html){console.log(JSON.stringify({source:source.id,url:p.url,status:'not-found'}));continue;}await mkdir(out,{recursive:true});await writeFile(join(out,p.file+'.html'),html);const $=load(html),links:{url:string;text:string}[]=[];$('a[href]').each((_,e)=>{try{const u=new URL($(e).attr('href')!,p.url);if(allowedUrl(u.href,source.hosts))links.push({url:u.href,text:$(e).text().replace(/\s+/g,' ').trim().slice(0,220)});}catch{}});const title=$('title').text(),h1=$('h1').text();$('script,style,nav,footer').remove();const text=$('body').text().replace(/\s+/g,' ').trim();await writeFile(join(out,p.file+'.json'),JSON.stringify({source:source.id,url:p.url,title,h1,text,links:[...new Map(links.map(l=>[l.url,l])).values()]},null,2));console.log(JSON.stringify({source:source.id,file:p.file,title,h1,links:links.length,text:text.slice(0,250)}));}
 }catch(e){error=String(e);console.log(JSON.stringify({source:source.id,error}));}finally{await session?.close();if(plan){store.db.prepare('UPDATE plans SET state=?,detail=? WHERE id=?').run(error?'partial':'complete',error||'Trial pages saved for extraction; photo assessment pending.',plan.id);store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(plan.id);}store.event(`${source.name}: ${error||'Trial pages collected for extraction.'}`);}}
}finally{store.close();}
