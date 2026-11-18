import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadEnvFile} from 'node:process';
import {Store} from '../server/db.ts';
import {createPlan,approvePlan,claimPlan,getPlan,Budget,type Usage} from '../server/plans.ts';
import {reviewGallery} from '../server/gallery-review.ts';
import {hardFailure,saveGalleryProgress} from '../server/regular-worker.ts';
import {aiMode,chatGpt} from '../server/chatgpt.ts';
import {sources} from '../server/sources.ts';
import {assertArchivedOperation} from '../server/archived-operations.ts';
assertArchivedOperation('November 15 credit-limited photo continuation',process.argv[2]);
if(existsSync('.env'))loadEnvFile('.env');
if(aiMode()!=='chatgpt')throw Error('Only ChatGPT-plan access is authorized');
const used=Number(process.argv[2]);if(!Number.isFinite(used)||used<0||used>=88)throw Error('Fresh weekly usage below 88% required');
const root='data/live/credit-limited-scan-2026-11-15',run=JSON.parse(readFileSync(root+'/run.json','utf8')),store=new Store('data/live/apartments.sqlite');
class CachedBudget extends Budget{override reserve(_kind:keyof Usage,_amount=1):never{throw Error('Cached photo review cannot request pages, listings or media');}}
let id:string|undefined,error:string|undefined;
const nativeFetch=globalThis.fetch;
try{
 if(store.db.prepare('SELECT 1 FROM scan_lock').get())throw Error('Another scan is active');
 if(run.photoFinishPlan){
  const prior=getPlan(store,run.photoFinishPlan.id);
  if(!process.argv.includes('--after-attribution-fix')||run.attributionFixRetry||prior.state!=='partial'||prior.usage.aiCalls!==1||!String(prior.detail).includes('HTTP 400'))throw Error('Photo continuation already recorded');
  run.attributionFixRetry={priorPlan:prior.id,at:new Date().toISOString(),reason:'Corrected text attribution input to the message-array format used by successful ChatGPT-plan requests; one verification continuation.'};
 }
 const pending=store.homes().filter(h=>!run.baselineIds.includes(h.id)&&!hardFailure(h.listing,store.criteria)&&h.listing.photos.some(p=>p.local&&(p.status!=='reviewed'||p.attributionPending)));
 if(!pending.length){console.log('No downloaded photos await review');process.exitCode=0;}else{
  const calls=run.plans.reduce((n:number,p:string)=>n+getPlan(store,p).usage.aiCalls,0),maxAiCalls=Math.min(200,run.aggregateCaps.aiCalls-calls);if(maxAiCalls<1)throw Error('Aggregate AI allowance exhausted');
  const plan=createPlan(store,{sources:sources.map(s=>s.id),billingMode:'chatgpt',maxPages:24,maxListings:12,maxPhotos:0,maxAiCalls,maxReservedUsd:0,newListingsOnly:true});
  id=plan.id;store.set(`usageGuard:${id}`,{checkedAt:Date.now(),usedPercent:used,stopAt:88,allowAiThrough:1});
  run.plans.push(id);run.photoFinishPlan={id,homeIds:pending.map(h=>h.id),effectiveCaps:{pages:0,listings:0,photos:0,aiCalls:maxAiCalls}};writeFileSync(root+'/run.json',JSON.stringify(run,null,2));
  approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);const budget=new CachedBudget(store,plan.id,plan.caps);
  globalThis.fetch=async(input,options)=>{const url=new URL(input instanceof Request?input.url:String(input));if(options?.method!=='POST'||!['https://api.openai.com/v1/responses','https://auth.openai.com/api/accounts/oauth/token'].includes(url.href))throw Error('Only ChatGPT review and token renewal allowed; no source requests');const response=await nativeFetch(input,{...options,redirect:'error'});if(!response.ok){const body=await response.clone().json().catch(()=>({})) as any;const code=String(body.error?.code??'unknown'),message=String(body.error?.message??'');store.set(`photoFinishError:${plan.id}`,{status:response.status,code:/^[a-zA-Z_]{1,100}$/.test(code)?code:'unrecognized',mentionsUsage:/usage|limit|quota/i.test(message),mentionsImage:/image|base64|jpeg|png/i.test(message)});}return response;};
  console.log(JSON.stringify({started:id,homeIds:pending.map(h=>h.id),maxAiCalls,sourceRequests:0}));
  const failures:string[]=[];
  for(const home of pending){budget.check();try{await reviewGallery(home.listing,budget,resolve('data/live'),{maxBatchPhotos:6});}catch(e){if(/HTTP|usage limit|usage is temporarily|reserve reached|checkpoint/i.test(String(e)))throw e;failures.push(`Apartment ${home.id}: ${String(e)}`);}finally{saveGalleryProgress(store,home,home.listing,budget);}}
  if(failures.length)throw Error(failures.join('; '));
 }
}catch(e){error=String(e);process.exitCode=1;}
finally{
 globalThis.fetch=nativeFetch;
 if(id){const current=getPlan(store,id),state=current.state==='cancelled'?'cancelled':error?'partial':'complete';store.db.prepare('UPDATE plans SET state=?,detail=? WHERE id=?').run(state,error??'Downloaded photos reviewed; missing source images remain explicitly pending.',id);store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(id);console.log(JSON.stringify({id,state,usage:getPlan(store,id).usage,error}));}
 chatGpt(resolve('data/live')).close();store.close();
 if(error&&!id)console.error(error);
}
