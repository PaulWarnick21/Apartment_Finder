import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {loadEnvFile} from 'node:process';
import {Store} from '../server/db.ts';
import {createPlan,approvePlan,claimPlan,getPlan,Budget,type Usage} from '../server/plans.ts';
import {reviewGallery} from '../server/gallery-review.ts';
import {hardFailure,saveGalleryProgress} from '../server/regular-worker.ts';
import {aiMode,chatGpt} from '../server/chatgpt.ts';
import {assertArchivedOperation} from '../server/archived-operations.ts';
assertArchivedOperation('November 15 twenty-per-source photo continuation',process.argv[2]);
if(existsSync('.env'))loadEnvFile('.env');
if(aiMode()!=='chatgpt')throw Error('Only connected ChatGPT plan access is authorized');
const used=Number(process.argv[2]);if(!Number.isFinite(used)||used<0||used>=88)throw Error('Fresh safe weekly usage required');
const root='data/live/twenty-per-source-2026-11-15',run=JSON.parse(readFileSync(root+'/run.json','utf8')),store=new Store('data/live/apartments.sqlite');
class CachedBudget extends Budget{override reserve(_kind:keyof Usage,_amount=1):never{throw Error('Saved-photo continuation cannot request pages, listings or images');}}
const nativeFetch=globalThis.fetch;let id:string|undefined,error:string|undefined;
try{
 if(store.db.prepare('SELECT 1 FROM scan_lock').get())throw Error('Another scan is active');
 const pending=store.homes().filter(h=>!run.baselineIds.includes(h.id)&&!hardFailure(h.listing,store.criteria)&&!['Closed','Not Interested','Leased'].includes(h.stage)&&h.listing.photos.some(p=>p.local&&(p.status!=='reviewed'||p.attributionPending)));
 if(!pending.length)throw Error('No downloaded photos await review');
 const usedCalls=run.plans.reduce((sum:number,planId:string)=>sum+getPlan(store,planId).usage.aiCalls,0),maxAiCalls=Math.min(100,run.aggregateCaps.maxAiCalls-usedCalls);if(maxAiCalls<1)throw Error('Authorized aggregate AI budget exhausted');
 const sources=[...new Set(pending.map(h=>h.listing.source))],plan=createPlan(store,{sources,billingMode:'chatgpt',trafficPolicy:'session',maxPages:sources.length*2,maxListings:sources.length,maxPhotos:0,maxAiCalls,maxReservedUsd:0});id=plan.id;
 run.plans.push(id);run.holdAi=false;run.photoContinuations??=[];run.photoContinuations.push({id,homeIds:pending.map(h=>h.id),startedAt:new Date().toISOString()});writeFileSync(root+'/run.json',JSON.stringify(run,null,2));
 store.set(`usageGuard:${plan.id}`,{checkedAt:Date.now(),usedPercent:used,stopAt:88,allowAiThrough:1});approvePlan(store,plan.id,'APPROVE ONE SCAN');claimPlan(store,plan.id);const budget=new CachedBudget(store,plan.id,plan.caps);
 globalThis.fetch=async(input,options)=>{const url=new URL(input instanceof Request?input.url:String(input));if(options?.method!=='POST'||!['https://api.openai.com/v1/responses','https://auth.openai.com/api/accounts/oauth/token'].includes(url.href))throw Error('Only photo review and account-token renewal allowed; no listing requests');return nativeFetch(input,{...options,redirect:'error'});};
 console.log(JSON.stringify({started:id,homeIds:pending.map(h=>h.id),maxAiCalls,sourceRequests:0}));
 const failures:string[]=[];
 for(const home of pending){budget.check();try{await reviewGallery(home.listing,budget,resolve('data/live'),{maxBatchPhotos:6});}catch(e){if(/HTTP|usage limit|usage is temporarily|reserve reached|checkpoint/i.test(String(e)))throw e;failures.push(`Apartment ${home.id}: ${String(e)}`);}finally{saveGalleryProgress(store,home,home.listing,budget);}}
 if(failures.length)throw Error(failures.join('; '));
}catch(e){error=String(e);process.exitCode=1;}
finally{
 globalThis.fetch=nativeFetch;
 if(id){const state=getPlan(store,id).state==='cancelled'?'cancelled':error?'partial':'complete';store.db.prepare('UPDATE plans SET state=?,detail=? WHERE id=?').run(state,error??'Saved photos reviewed; no source requests.',id);store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(id);console.log(JSON.stringify({id,state,usage:getPlan(store,id).usage,error}));}
 chatGpt(resolve('data/live')).close();store.close();if(error&&!id)console.error(error);
}
