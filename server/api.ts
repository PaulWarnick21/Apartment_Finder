import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {join,resolve,extname,sep} from 'node:path';
import {z} from 'zod';
import {Store} from './db.ts';
import {criteriaSchema,stageSchema} from '../src/domain.ts';
import {sources} from './sources.ts';
import {createPlan,approvePlan,getPlan,recoverInterrupted} from './plans.ts';
import {runPlan} from './worker.ts';
import {chatGpt,aiMode} from './chatgpt.ts';
import {providerReady} from './chatgpt-provider.ts';
import {BrowserBridge,extensionOrigin} from './browser-bridge.ts';
import {ChromeJobs} from './chrome-jobs.ts';
import {runApartmentsPlan} from './apartments-worker.ts';
const decisionSchema=z.object({revision:z.number().int(),stage:stageSchema,notes:z.string().max(10000),followUp:z.string().max(40),viewing:z.string().max(40),rescued:z.boolean()}).strict();
async function body(req:IncomingMessage,maxBytes=100000){const chunks:Buffer[]=[];let size=0;for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>maxBytes)throw new Error('Request too large');chunks.push(b);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
const calendarEscape=(s:string)=>s.replace(/\\/g,'\\\\').replace(/[\r\n]+/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
export function createApp(store:Store,dataDir:string,{demo=false,dev=false}:{demo?:boolean;dev?:boolean}={}){
 const csrf=randomBytes(32).toString('hex'),browserBridge=new BrowserBridge(store,dataDir,demo),chromeJobs=new ChromeJobs(store);let vite:any;
 const server=createServer(async(req,res)=>{const host=req.headers.host??'';
 const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 try{
 if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))return send(403,{error:'Local access only'});
 const url=new URL(req.url??'/',`http://${host}`),path=url.pathname;
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 if(path==='/api/health'&&req.method==='GET')return send(200,{app:'apartment-finder',demo,workspaceId:createHash('sha256').update(resolve(dataDir).toLowerCase()).digest('hex')});
 // Separate capability-authenticated extension endpoints. Never relax the app's CSRF gate.
 if(path.startsWith('/api/browser-bridge/')){
  const origin=req.headers.origin,id=String(req.headers['x-af-extension-id']??'');
  if(req.method==='OPTIONS'){
   const originId=origin?.match(/^chrome-extension:\/\/([a-p]{32})$/)?.[1];
   if(!originId)return send(403,{error:'Extension origin not allowed'});
   res.setHeader('Access-Control-Allow-Origin',origin!);res.setHeader('Vary','Origin');
   res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, X-AF-Extension-Id');
   res.writeHead(204);return res.end();
  }
  if(req.method!=='POST')return send(405,{error:'POST required'});
  extensionOrigin(origin,id);if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
  if(path==='/api/browser-bridge/pair')return send(200,browserBridge.pair(await body(req),origin));
  browserBridge.authenticate(id,req.headers.authorization??'',origin);
  if(path==='/api/browser-bridge/jobs/poll')return send(200,chromeJobs.poll());
  if(path==='/api/browser-bridge/jobs/check')return send(200,chromeJobs.check(await body(req)));
  if(path==='/api/browser-bridge/jobs/result')return send(200,chromeJobs.result(await body(req,4000000)));
  if(path==='/api/browser-bridge/claim')return send(200,browserBridge.claim(await body(req)));
  if(path==='/api/browser-bridge/capture')return send(200,browserBridge.save(await body(req,4000000)));
  return send(404,{error:'Unknown bridge route'});
 }
 if(req.method!=='GET'&&req.method!=='HEAD'){
   if(req.headers.origin&&req.headers.origin!==`http://${host}`)return send(403,{error:'Origin not allowed'});
   if(req.headers['x-af-token']!==csrf)return send(403,{error:'Refresh the app before making changes'});
 }
 if(path==='/api/state'&&req.method==='GET')return send(200,{csrf,demo,homes:store.homes(),criteria:store.criteria,sources:sources.map(s=>({id:s.id,name:s.name,status:store.get<Record<string,string>>('trialSourceReports')?.[s.id]??s.status,ready:s.adapter!=='pending',health:store.health().find(h=>h.source===s.id)})),events:store.events(),plans:(store.db.prepare('SELECT id FROM plans ORDER BY created_at DESC LIMIT 30').all() as any[]).map(p=>getPlan(store,p.id)),providerReady:await providerReady(dataDir),aiMode:aiMode(),chatgpt:await chatGpt(dataDir).state(),schedule:{enabled:false,reason:'First scan needs one-time approval; recurring scans are not enabled.'}});
 if(path==='/api/browser/state'&&req.method==='GET')return send(200,browserBridge.state());
 if(path==='/api/browser/prepare'&&req.method==='POST')return send(200,browserBridge.prepare());
 if(path==='/api/browser/disconnect'&&req.method==='POST'){chromeJobs.fail('Chrome disconnected');browserBridge.disconnect();return send(200,{ok:true});}
 if(path==='/api/criteria'&&req.method==='PUT'){store.set('criteria',criteriaSchema.parse(await body(req)));store.event('Criteria updated; scores recalculated without network or AI requests.');return send(200,{ok:true});}
 if(path==='/api/recover'&&req.method==='POST'){recoverInterrupted(store);return send(200,{ok:true});}
 if(path.startsWith('/api/chatgpt/')&&req.method==='POST'){
  if(demo)throw new Error('ChatGPT connections are disabled in the offline demo.');
  if(store.db.prepare('SELECT 1 FROM scan_lock WHERE id=1').get())throw new Error('Finish or cancel the running scan before changing ChatGPT settings.');
  const connection=chatGpt(dataDir),input=await body(req);
  if(path==='/api/chatgpt/connect'){const options=z.object({newProfile:z.boolean().default(false)}).parse(input);return send(200,{url:await connection.begin(`http://${host}/`,options.newProfile)});}
  if(path==='/api/chatgpt/cancel'){connection.cancel();return send(200,{ok:true});}
  if(path==='/api/chatgpt/models')return send(200,{models:await connection.models()});
  if(path==='/api/chatgpt/model'){await connection.chooseModel(z.object({model:z.string()}).parse(input).model);return send(200,{ok:true});}
  if(path==='/api/chatgpt/account'){await connection.select(z.object({id:z.string()}).parse(input).id);return send(200,{ok:true});}
  if(path==='/api/chatgpt/disconnect'){await connection.disconnect();return send(200,{ok:true});}
 }
 const match=path.match(/^\/api\/homes\/(\d+)(?:\/(undo|draft|calendar|history))?$/);
 if(match){const id=Number(match[1]),action=match[2],home=store.home(id);if(!home)return send(404,{error:'Apartment not found'});
 if(req.method==='PUT'&&!action){const input=decisionSchema.parse(await body(req));return send(200,store.update(id,input.revision,input));}
 if(action==='undo'&&req.method==='POST'){store.undo(id);return send(200,{ok:true});}
 if(action==='history'&&req.method==='GET')return send(200,store.db.prepare('SELECT at,event,before_json,after_json FROM history WHERE home_id=? ORDER BY id DESC LIMIT 50').all(id));
 if(action==='draft'&&req.method==='GET'){const l=home.listing;const questions=['Is this apartment still available, and what is the earliest move-in date?','Could you confirm the total monthly rent and any additional fees?'];if(l.laundry!=='in-unit')questions.push('Does this specific unit include its own washer and dryer?');if(l.parking!=='included')questions.push('Is a parking space available, and what does it cost?');questions.push('Which internet services are available in this unit, including upload speeds and any shared connection?');if(home.score.view==='Unverified')questions.push('Could you share photos of the outlook through the living-room and bedroom windows?');return send(200,{text:`Hello,\n\nI’m interested in ${l.address||l.title}${l.unit?', unit '+l.unit:''}.\n\n${questions.map(q=>'• '+q).join('\n')}\n\nThank you!`});}
 if(action==='calendar'&&req.method==='GET'){const date=new Date(home.viewing);if(!Number.isFinite(+date))throw new Error('Save a viewing date first');const stamp=(d:Date)=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');const content=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Apartment Finder//EN','BEGIN:VEVENT',`UID:apartment-${id}-${stamp(date)}@localhost`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(date)}`,`DTEND:${stamp(new Date(+date+3600000))}`,`SUMMARY:${calendarEscape(`Apartment #${id} viewing`)}`,`LOCATION:${calendarEscape(home.listing.address)}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');res.writeHead(200,{'Content-Type':'text/calendar','Content-Disposition':`attachment; filename="apartment-${id}-viewing.ics"`});return res.end(content);}}
 if(path==='/api/plans'&&req.method==='POST'){if(demo)throw new Error('Live scans are disabled in demo mode');return send(201,createPlan(store,await body(req)));}
 const planMatch=path.match(/^\/api\/plans\/([a-f0-9-]+)\/(approve|cancel)$/);
 if(planMatch&&req.method==='POST'){
  if(demo)throw new Error('Live scans are disabled in demo mode');const id=planMatch[1];
  if(planMatch[2]==='cancel'){store.db.prepare("UPDATE plans SET state='cancelled' WHERE id=? AND state IN ('draft','approved','running')").run(id);store.event('Scan cancelled; completed work retained.');return send(200,{ok:true});}
  const p=getPlan(store,id);if(p.caps.maxAiCalls>0&&(!await providerReady(dataDir)||p.caps.billingMode!==aiMode()))throw new Error('Connect your ChatGPT plan and select a model in Preferences, then prepare a new plan.');
  const {confirmation}=z.object({confirmation:z.string()}).parse(await body(req));approvePlan(store,id,confirmation);void (p.caps.sources.includes('apartments')?runApartmentsPlan(store,id,dataDir,chromeJobs):runPlan(store,id,dataDir)).catch(e=>store.event(`Worker could not start: ${String(e)}`));return send(202,{ok:true});
 }
 if(path==='/api/duplicates/different'&&req.method==='POST'){const {a,b}=z.object({a:z.number().int().positive(),b:z.number().int().positive()}).parse(await body(req));if(a===b||!store.home(a)||!store.home(b))throw new Error('Choose two different apartments');store.db.prepare('INSERT OR REPLACE INTO duplicate_decisions VALUES (?,?,?)').run(Math.min(a,b),Math.max(a,b),'different');return send(200,{ok:true});}
 if(path==='/api/export'&&req.method==='GET'){res.setHeader('Content-Disposition','attachment; filename="apartment-finder-export.json"');return send(200,{exportedAt:new Date().toISOString(),criteria:store.criteria,homes:store.homes()});}
 if(path==='/api/backup'&&req.method==='POST'){const name=`backup-${Date.now()}.sqlite`;await store.backupTo(join(dataDir,'backups',name));return send(200,{message:`Backup saved to ${join(dataDir,'backups',name)}`});}
 if(path.startsWith('/api/'))return send(404,{error:'Unknown API route'});
 if(path.startsWith('/media/')){const name=path.slice(7);if(!/^[a-f0-9]{64}\.jpg$/.test(name))return send(404,{error:'Image not found'});const file=join(dataDir,'media',name);if(!existsSync(file))return send(404,{error:'Image unavailable'});res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'private, max-age=86400'});return res.end(readFileSync(file));}
 if(dev){if(!vite){const {createServer}=await import('vite');vite=await createServer({server:{middlewareMode:true},appType:'spa'});}return vite.middlewares(req,res,()=>send(404,{error:'Not found'}));}
 const root=resolve('dist');const file=resolve(root,'.'+decodeURIComponent(path));if(file!==root&&!file.startsWith(root+sep))return send(403,{error:'Invalid path'});const actual=existsSync(file)&&extname(file)?file:join(root,'index.html');if(!existsSync(actual))return send(503,{error:'Run npm run build first'});const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':mime[extname(actual)]??'application/octet-stream'});res.end(readFileSync(actual));
 }catch(e){const message=e instanceof Error?e.message:'Unexpected error';send(/changed|already|running/.test(message)?409:400,{error:message});}});
 return {server,close:async()=>{chromeJobs.fail('Server stopped');chatGpt(dataDir).close();await vite?.close();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}};
}
