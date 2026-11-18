import {searchAreaSummary} from './search-area.ts';
import {areaMixSettings,updateAreaMixSettings} from './area-mix-settings.ts';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {PhotoDelivery} from './photo-delivery.ts';
import {join,resolve,extname,sep} from 'node:path';
import {z} from 'zod';
import {Store} from './db.ts';
import {criteriaSchema,stageSchema} from '../src/domain.ts';
import {sources} from './sources.ts';
import {sourceStatuses} from './source-status.ts';
import {createPlan,approvePlan,getPlan,recoverInterrupted} from './plans.ts';
import {runRegularPlan} from './regular-worker.ts';
import {chatGpt,aiMode} from './chatgpt.ts';
import {providerReady} from './chatgpt-provider.ts';
import {BrowserBridge,extensionOrigin} from './browser-bridge.ts';
import {ChromeJobs} from './chrome-jobs.ts';
import {LocationMaps} from './location-map.ts';
import {recoverChromeSource} from './chrome-recovery.ts';
import {runApartmentsPlan} from './apartments-worker.ts';
import {RatingFeedbackService,planFeedbackReviewer,type FeedbackReviewer} from './rating-feedback.ts';
import {assertFeedbackReady,rebuildLearning} from './feedback-learning.ts';
import {preferencesRevision,patchPreferences} from './preferences.ts';
import {PublicConnectionStatus} from './public-connection.ts';
import {cardSummary} from './desk-state.ts';
import {ScanProcesses} from './scan-process.ts';
import {BuildingResearchService} from './building-research.ts';
import {createFullBackup} from './full-backup.ts';
import {retryCandidate} from './discovery-queue.ts';
import {requestAccess,type RemoteAccess} from './request-access.ts';
import {FullReviewService} from './full-review.ts';
import {closeAccountUsage} from './account-usage.ts';
const decisionSchema=z.object({revision:z.number().int(),stage:stageSchema,notes:z.string().max(10000),followUp:z.string().max(40),viewing:z.string().max(40),rescued:z.boolean()}).strict();
async function body(req:IncomingMessage,maxBytes=100000){const chunks:Buffer[]=[];let size=0;for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>maxBytes)throw new Error('Request too large');chunks.push(b);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
const calendarEscape=(s:string)=>s.replace(/\\/g,'\\\\').replace(/[\r\n]+/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
export function createApp(store:Store,dataDir:string,{demo=false,dev=false,feedbackReviewer,remoteAccess=null}:{demo?:boolean;dev?:boolean;feedbackReviewer?:FeedbackReviewer;remoteAccess?:RemoteAccess|null}={}){
 if(dev&&remoteAccess)throw new Error('Private phone access requires the production build; development mode remains local.');
 const csrf=randomBytes(32).toString('hex'),browserBridge=new BrowserBridge(store,dataDir,demo),chromeJobs=new ChromeJobs(store),photoDelivery=new PhotoDelivery(dataDir);let vite:any,connectionMutations=0;
 const feedback=new RatingFeedbackService(store,demo?null:feedbackReviewer??planFeedbackReviewer(dataDir));
 const locationMaps=new LocationMaps(store,demo);
 const connectionStatus=new PublicConnectionStatus(()=>chatGpt(dataDir).state());
 const scanProcesses=new ScanProcesses(store,dataDir,chromeJobs);
 const buildingResearch=new BuildingResearchService(store,locationMaps,demo);
 const fullReviews=new FullReviewService(store,dataDir,scanProcesses,demo,{research:id=>buildingResearch.run(id,'APPROVE TWO PUBLIC RESEARCH REQUESTS')});
 const server=createServer(async(req,res)=>{const host=req.headers.host??'';
 const send=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 try{
 const access=requestAccess(req,remoteAccess);if(!access)return send(403,{error:'Access not allowed'});
 const url=new URL(req.url??'/',access.origin),path=url.pathname;
 if(url.origin!==access.origin)return send(403,{error:'Origin not allowed'});
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
 if(path==='/api/health'&&req.method==='GET')return send(200,{app:'apartment-finder',demo,workspaceId:createHash('sha256').update(resolve(dataDir).toLowerCase()).digest('hex')});
 // Separate capability-authenticated extension endpoints. Never relax the app's CSRF gate.
 if(path.startsWith('/api/browser-bridge/')){
  if(access.remote)return send(403,{error:'The Chrome extension connects only on the desktop.'});
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
  if(path==='/api/browser-bridge/jobs/poll'){
   const {waitMs}=z.object({waitMs:z.number().int().min(0).max(20000).optional()}).strict().parse(await body(req));
   const controller=new AbortController(),closed=()=>controller.abort();res.once('close',closed);
   try{const result=await chromeJobs.waitForJob(waitMs??0,controller.signal);if(!res.destroyed)return send(200,{...result,watch:chromeJobs.watching});}
   finally{res.removeListener('close',closed);}return;
  }
  if(path==='/api/browser-bridge/jobs/check')return send(200,chromeJobs.check(await body(req)));
  if(path==='/api/browser-bridge/jobs/result')return send(200,chromeJobs.result(await body(req,4000000)));
  if(path==='/api/browser-bridge/claim')return send(200,browserBridge.claim(await body(req)));
  if(path==='/api/browser-bridge/capture')return send(200,browserBridge.save(await body(req,4000000)));
  return send(404,{error:'Unknown bridge route'});
 }
 if(req.method!=='GET'&&req.method!=='HEAD'){
   if((access.remote||req.headers.origin!==undefined)&&req.headers.origin!==access.origin)return send(403,{error:'Origin not allowed'});
   if(req.headers['x-af-token']!==csrf)return send(403,{error:'Refresh the app before making changes'});
 }
 if(path==='/api/state'&&req.method==='GET'){
  const homes=store.homes(),criteria=store.criteria,chatgpt=await connectionStatus.get(),mode=aiMode();
  const value={csrf,demo,searchAreaSummary:searchAreaSummary(store),areaMix:areaMixSettings(store),homes:url.searchParams.get('compact')==='1'?homes.map(cardSummary):homes,criteria,criteriaRevision:preferencesRevision(criteria),sources:sourceStatuses(store,Date.now(),homes),events:store.events(),plans:(store.db.prepare('SELECT id FROM plans ORDER BY created_at DESC LIMIT 30').all() as any[]).map(p=>getPlan(store,p.id)),providerReady:mode==='api'?!!process.env.OPENAI_API_KEY&&!!process.env.OPENAI_MODEL:!chatgpt.pending&&chatgpt.sharing&&!!chatgpt.model,aiMode:mode,chatgpt,schedule:store.get('scanSchedule')??{enabled:false,reason:'Recurring scans are not enabled. Each run needs bounded approval.'}};
  const content=JSON.stringify(value),etag='"'+createHash('sha256').update(content).digest('hex')+'"';res.setHeader('ETag',etag);
  if(req.headers['if-none-match']===etag){res.writeHead(304,{'Cache-Control':'private, no-cache'});return res.end();}
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'private, no-cache'});return res.end(content);
 }
 if(path==='/api/browser/state'&&req.method==='GET')return send(200,browserBridge.state());
 if(path==='/api/area-mix'&&req.method==='PATCH')return send(200,updateAreaMixSettings(store,await body(req)));
 if((path==='/api/browser/recover-zillow'||path==='/api/browser/recover-apartments')&&req.method==='POST'){
  if(demo)throw new Error('Live access checks are disabled in demo mode');
  const source=path.endsWith('recover-apartments')?'apartments':'zillow';
  z.object({confirmation:z.literal(source==='apartments'?'APPROVE ONE APARTMENTS RECOVERY':'APPROVE ONE ZILLOW RECOVERY')}).strict().parse(await body(req));
  if(scanProcesses.hasActive||store.db.prepare('SELECT 1 FROM scan_lock WHERE id=1').get())throw new Error('Another scan is running');
  const plan=createPlan(store,{purpose:'access-check',sources:[source],billingMode:'chatgpt',maxPages:1,maxListings:1,maxPhotos:0,maxAiCalls:0,maxReservedUsd:0,maxAddressLookups:0,stopAt:new Date(Date.now()+300000).toISOString()},{accessRecovery:true});
  approvePlan(store,plan.id,'APPROVE ONE SCAN');void recoverChromeSource(store,plan.id,dataDir,chromeJobs).catch(e=>store.event(String(e)));return send(202,{id:plan.id});
 }
 if(path==='/api/browser/prepare'&&req.method==='POST')return send(200,browserBridge.prepare());
 if(path==='/api/browser/disconnect'&&req.method==='POST'){chromeJobs.fail('Chrome disconnected');browserBridge.disconnect();return send(200,{ok:true});}
 if(path==='/api/criteria'&&req.method==='PATCH')return send(200,patchPreferences(store,await body(req)));
 if(path==='/api/criteria'&&req.method==='PUT')throw new Error('Refresh the app to save only edited preferences with revision protection.');
 if(path==='/api/recover'&&req.method==='POST'){if(scanProcesses.hasActive)throw new Error('A local scan process is still active; cancel it before interrupted-run recovery.');recoverInterrupted(store);return send(200,{ok:true});}
 const retrySource=path.match(/^\/api\/sources\/([a-z]+)\/retry$/);
 if(retrySource&&req.method==='POST'){const {url}=z.object({url:z.string().url().max(3000)}).strict().parse(await body(req));retryCandidate(store,retrySource[1],url);return send(200,{ok:true});}
 if(path.startsWith('/api/chatgpt/')&&req.method==='POST'){
  if(access.remote&&path==='/api/chatgpt/connect')return send(403,{error:'Connect your ChatGPT account from Apartment Finder on the desktop, then return to your phone.'});
  connectionStatus.invalidate();
  if(demo)throw new Error('ChatGPT connections are disabled in the offline demo.');
  if(scanProcesses.hasActive||store.db.prepare('SELECT 1 FROM scan_lock WHERE id=1').get())throw new Error('Finish or cancel the running scan before changing ChatGPT settings.');
  if(connectionMutations)throw new Error('A ChatGPT settings change is already in progress.');
  connectionMutations++;
  try{
  const connection=chatGpt(dataDir),input=await body(req);
  if(path==='/api/chatgpt/connect'){const options=z.object({newProfile:z.boolean().default(false)}).parse(input);return send(200,{url:await connection.begin(`http://${host}/`,options.newProfile)});}
  if(path==='/api/chatgpt/cancel'){connection.cancel();return send(200,{ok:true});}
  if(path==='/api/chatgpt/models')return send(200,{models:await connection.models()});
  if(path==='/api/chatgpt/model'){await connection.chooseModel(z.object({model:z.string()}).parse(input).model);return send(200,{ok:true});}
  if(path==='/api/chatgpt/account'){await connection.select(z.object({id:z.string()}).parse(input).id);return send(200,{ok:true});}
  if(path==='/api/chatgpt/disconnect'){await connection.disconnect();return send(200,{ok:true});}
  }finally{connectionMutations--;}
 }
 const ratingHome=path.match(/^\/api\/homes\/(\d+)\/ratings$/);
 const mapHome=path.match(/^\/api\/homes\/(\d+)\/map$/);
 const contextHome=path.match(/^\/api\/homes\/(\d+)\/(context|research)$/);
 const duplicatesHome=path.match(/^\/api\/homes\/(\d+)\/duplicates$/);
 if(duplicatesHome&&req.method==='GET'){const home=store.home(Number(duplicatesHome[1]));if(!home)return send(404,{error:'Apartment not found'});return send(200,{candidates:home.possibleDuplicates.map(id=>store.home(id)).filter(Boolean),history:store.mergeHistory(home.id)});}
 if(contextHome){const home=store.home(Number(contextHome[1]));if(!home)return send(404,{error:'Apartment not found'});if(contextHome[2]==='context'&&req.method==='GET')return send(200,buildingResearch.saved(home.listing));if(contextHome[2]==='research'&&req.method==='POST'){const input=z.object({confirmation:z.string()}).strict().parse(await body(req));return send(200,await buildingResearch.run(home.id,input.confirmation));}}
 if(mapHome&&req.method==='POST'){const home=store.home(Number(mapHome[1]));if(!home)return send(404,{error:'Apartment not found'});return send(200,await locationMaps.get(home.listing));}
 if(ratingHome){const id=Number(ratingHome[1]);if(!store.home(id))return send(404,{error:'Apartment not found'});if(req.method==='GET')return send(200,{ratings:feedback.list(id)});if(req.method==='POST')return send(201,{rating:feedback.submit(id,await body(req))});}
 const ratingAction=path.match(/^\/api\/ratings\/(\d+)\/(retry|undo)$/);
 if(ratingAction&&req.method==='POST'){const id=Number(ratingAction[1]);if(ratingAction[2]==='undo')feedback.undo(id);else feedback.enqueue(id);return send(200,{ok:true});}
 const fullRetry=path.match(/^\/api\/homes\/(\d+)\/full-review\/retry$/);
 if(fullRetry&&req.method==='POST'){const {revision}=z.object({revision:z.number().int()}).strict().parse(await body(req));return send(202,fullReviews.retry(Number(fullRetry[1]),revision));}
 const match=path.match(/^\/api\/homes\/(\d+)(?:\/(undo|reopen|draft|calendar|history))?$/);
 if(match){const id=Number(match[1]),action=match[2],home=store.home(id);if(!home)return send(404,{error:'Apartment not found'});
 if(req.method==='GET'&&!action)return send(200,home);
 if(req.method==='PUT'&&!action){const input=decisionSchema.parse(await body(req)),updated=store.update(id,input.revision,input);if(updated?.fullReview?.status==='queued')fullReviews.kick();return send(200,updated);}
 if(action==='reopen'&&req.method==='POST'){const {revision}=z.object({revision:z.number().int()}).strict().parse(await body(req));return send(200,store.reopen(id,revision));}
 if(action==='undo'&&req.method==='POST'){store.undo(id);return send(200,{ok:true});}
 if(action==='history'&&req.method==='GET')return send(200,store.db.prepare('SELECT at,event,before_json,after_json FROM history WHERE home_id=? ORDER BY id DESC LIMIT 50').all(id));
 if(action==='draft'&&req.method==='GET'){const l=home.listing;const questions=['Is this apartment still available, and what is the earliest move-in date?','Could you confirm the total monthly rent and any additional fees?'];if(l.laundry!=='in-unit')questions.push('Does this specific unit include its own washer and dryer?');if(l.parking!=='included')questions.push('Is a parking space available, and what does it cost?');questions.push('Which internet services are available in this unit, including upload speeds and any shared connection?');if(home.score.view==='Unverified')questions.push('Could you share photos of the outlook through the living-room and bedroom windows?');return send(200,{text:`Hello,\n\nI’m interested in ${l.address||l.title}${l.unit?', unit '+l.unit:''}.\n\n${questions.map(q=>'• '+q).join('\n')}\n\nThank you!`});}
 if(action==='calendar'&&req.method==='GET'){const date=new Date(home.viewing);if(!Number.isFinite(+date))throw new Error('Save a viewing date first');const stamp=(d:Date)=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');const content=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Apartment Finder//EN','BEGIN:VEVENT',`UID:apartment-${id}-${stamp(date)}@localhost`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(date)}`,`DTEND:${stamp(new Date(+date+3600000))}`,`SUMMARY:${calendarEscape(`Apartment #${id} viewing`)}`,`LOCATION:${calendarEscape(home.listing.address)}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');res.writeHead(200,{'Content-Type':'text/calendar','Content-Disposition':`attachment; filename="apartment-${id}-viewing.ics"`});return res.end(content);}}
 if(path==='/api/plans'&&req.method==='POST'){if(demo)throw new Error('Live scans are disabled in demo mode');return send(201,createPlan(store,await body(req)));}
 const planMatch=path.match(/^\/api\/plans\/([a-f0-9-]+)\/(approve|cancel)$/);
 if(planMatch&&req.method==='POST'){
  if(demo)throw new Error('Live scans are disabled in demo mode');const id=planMatch[1];
  if(planMatch[2]==='cancel'){store.db.prepare("UPDATE plans SET state='cancelled' WHERE id=? AND state IN ('draft','approved','running')").run(id);store.event('Scan cancelled; completed work retained.');return send(200,{ok:true});}
  const p=getPlan(store,id);if(p.caps.phase!=='inventory'&&p.caps.assessmentMode!=='quick')assertFeedbackReady(store);if(p.caps.maxAiCalls>0&&(!await providerReady(dataDir)||p.caps.billingMode!==aiMode()))throw new Error('Connect your ChatGPT plan and select a model in Preferences, then prepare a new plan.');
  const {confirmation}=z.object({confirmation:z.string()}).parse(await body(req));
  if(connectionMutations)throw new Error('Wait for the ChatGPT settings change to finish before approving a scan.');
  scanProcesses.assertCanStart(id);
  approvePlan(store,id,confirmation);scanProcesses.start(id);return send(202,{ok:true});
 }
 if(path==='/api/duplicates/different'&&req.method==='POST'){const {a,b}=z.object({a:z.number().int().positive(),b:z.number().int().positive()}).parse(await body(req));if(a===b||!store.home(a)||!store.home(b))throw new Error('Choose two different apartments');store.db.prepare('INSERT OR REPLACE INTO duplicate_decisions VALUES (?,?,?)').run(Math.min(a,b),Math.max(a,b),'different');return send(200,{ok:true});}
 if(path==='/api/duplicates/merge'&&req.method==='POST'){const input=z.object({keepId:z.number().int().positive(),duplicateId:z.number().int().positive(),revisions:z.object({keep:z.number().int(),duplicate:z.number().int()}).strict(),confirmation:z.literal('SAME APARTMENT')}).strict().parse(await body(req));const result=store.transaction(()=>{const merged=store.mergeHomes(input.keepId,input.duplicateId,input.revisions);store.set('criteria',rebuildLearning(store).criteria);return merged;});return send(200,result);}
 if(path==='/api/duplicates/split'&&req.method==='POST'){const {mergeId}=z.object({mergeId:z.number().int().positive()}).strict().parse(await body(req));const result=store.transaction(()=>{const split=store.splitMerge(mergeId);store.set('criteria',rebuildLearning(store).criteria);return split;});return send(200,result);}
 if(path==='/api/export'&&req.method==='GET'){res.setHeader('Content-Disposition','attachment; filename="apartment-finder-export.json"');return send(200,{exportedAt:new Date().toISOString(),criteria:store.criteria,homes:store.homes(),ratings:feedback.list(),calibrationHistory:store.db.prepare('SELECT * FROM calibration_changes ORDER BY id DESC').all()});}
 if(path==='/api/backup'&&req.method==='POST'){const destination=join(dataDir,'backups',`backup-${Date.now()}`);await createFullBackup(store,dataDir,destination,demo?join(dataDir,'no-private-criteria'):resolve('private'));return send(200,{message:`Complete backup saved to ${destination}`});}
 if(path.startsWith('/api/'))return send(404,{error:'Unknown API route'});
 if(path.startsWith('/media/')){if(req.method!=='GET'&&req.method!=='HEAD')return send(405,{error:'Method not allowed'});if(!await photoDelivery.serve(req,res,path.slice(7),url.searchParams))return send(404,{error:'Image unavailable'});return;}
 if(dev){if(!vite){const {createServer}=await import('vite');vite=await createServer({server:{middlewareMode:true},appType:'spa'});}return vite.middlewares(req,res,()=>send(404,{error:'Not found'}));}
 const root=resolve('dist');const file=resolve(root,'.'+decodeURIComponent(path));if(file!==root&&!file.startsWith(root+sep))return send(403,{error:'Invalid path'});const actual=existsSync(file)&&extname(file)?file:join(root,'index.html');if(!existsSync(actual))return send(503,{error:'Run npm run build first'});const mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':mime[extname(actual)]??'application/octet-stream'});res.end(readFileSync(actual));
 }catch(e){const message=e instanceof Error?e.message:'Unexpected error';send(/changed|already|running/.test(message)?409:400,{error:message});}finally{if(req.method==='POST'&&req.url?.startsWith('/api/chatgpt/'))connectionStatus.invalidate();}});
 return {server,close:async()=>{await fullReviews.close();await feedback.close();chromeJobs.fail('Server stopped');await scanProcesses.close();closeAccountUsage();chatGpt(dataDir).close();await vite?.close();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}};
}
