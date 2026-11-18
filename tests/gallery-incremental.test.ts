import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {listingSchema,type Photo} from '../src/domain.ts';
import {createPlan,approvePlan,claimPlan,Budget} from '../server/plans.ts';
import {reviewGallery,applyVisualFeatures,requestBatch,reconcileInteriorEvidence,galleryRubric} from '../server/gallery-review.ts';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chatGpt} from '../server/chatgpt.ts';
import {releaseScan} from '../server/scan-concurrency.ts';
const createBudget=(store:Store,calls:number)=>{
 // Each invocation represents a separately approved continuation after the prior
 // simulated worker finished. Release its state and lock just as a real worker does.
 for(const row of store.db.prepare("SELECT id FROM plans WHERE state IN ('approved','running')").all() as {id:string}[]){store.db.prepare("UPDATE plans SET state='complete' WHERE id=?").run(row.id);releaseScan(store,row.id);}
 const p=createPlan(store,{sources:['craigslist'],billingMode:'chatgpt',maxPages:2,maxListings:1,maxPhotos:10,maxAiCalls:calls,maxReservedUsd:0,reservePerCallUsd:.1});approvePlan(store,p.id,'APPROVE ONE SCAN');claimPlan(store,p.id);return new Budget(store,p.id,p.caps);
};
const sample=()=>listingSchema.parse({source:'fixture',sourceId:'a',url:'https://example.com/a',title:'Fixture',address:'Example',rent:2400,beds:1,galleryComplete:false,expectedPhotos:6,photos:Array.from({length:6},(_,i)=>({id:`p${i}`,url:`https://example.com/${i}`,hash:`hash${i}`,local:i===5?undefined:`${i}.jpg`,status:i===5?'unavailable':'downloaded'}))});
const findings=(photos:Photo[])=>({photos:photos.map(p=>({id:p.id,kind:'interior',scenery:'nature',quality:4,unitCertain:true,note:'Unit window',visualFeatures:{gas:true,workspace:null,openPlan:true,laundry:'unknown',note:'Gas burners and open kitchen visible'}})),allOutlooksCovered:true,summary:'Supplied photos reviewed',interior:{modern:null,cramped:null,photoIds:photos.map(p=>p.id),note:'Condition uncertain'}});

test('visual and cached-attribution batches renew credentials for the same selected account',async t=>{
 const store=new Store(':memory:'),dir=await mkdtemp(join(tmpdir(),'finder-gallery-credentials-')),connection=chatGpt(dir);await mkdir(join(dir,'media'));
 const l=sample();l.photos=l.photos.slice(0,4);l.expectedPhotos=4;l.galleryComplete=true;for(const p of l.photos)await writeFile(join(dir,'media',p.local!),'fixture');
 let calls=0;const profiles:(string|undefined)[]=[],headers:string[]=[];
 t.mock.method(connection,'access',async(profile?:string)=>{profiles.push(profile);return {profile:'fixture-account',model:'fixture',token:'credential-'+(++calls)};});
 t.mock.method(globalThis,'fetch',async(_url:unknown,options:any)=>{
  headers.push(options.headers.Authorization);const body=JSON.parse(options.body),texts=body.input[0].content.filter((c:any)=>c.type==='input_text').map((c:any)=>JSON.parse(c.text));
  const result=body.text.format.name==='photo_attribution'?{photos:texts[0].photos.map((p:any)=>({id:p.id,unitCertain:true,note:'Source attributes this saved image to the advertised apartment.'}))}:findings(texts.filter((v:any)=>v.photo).map((v:any)=>l.photos.find(p=>p.id===v.photo)!));
  return new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]}})+'\n\n');
 });
 try{
  await reviewGallery(l,createBudget(store,2),dir,{maxBatchPhotos:2});assert.deepEqual(headers,['Bearer credential-2','Bearer credential-3']);assert.ok(l.photos.every(p=>p.status==='reviewed'&&p.unitCertain));
  const other=sample();other.sourceId='another';other.photos=other.photos.slice(0,4);other.expectedPhotos=4;other.galleryComplete=true;
  await reviewGallery(other,createBudget(store,2),dir,{maxBatchPhotos:2});assert.deepEqual(headers,['Bearer credential-2','Bearer credential-3','Bearer credential-5','Bearer credential-6']);assert.ok(other.photos.every(p=>p.status==='reviewed'&&p.unitCertain&&!p.attributionPending));
  assert.deepEqual(profiles,[undefined,'fixture-account','fixture-account',undefined,'fixture-account','fixture-account']);
 }finally{store.close();connection.close();}
});

test('a timed-out gallery waits for a continuation and reduces its batch size without skipping images',async()=>{const store=new Store(':memory:');try{
 const l=sample(),sizes:number[]=[];
 await assert.rejects(()=>reviewGallery(l,createBudget(store,1),'.',{review:async photos=>{sizes.push(photos.length);throw new Error('The operation was aborted due to timeout');}}),/timeout/);
 assert.deepEqual(sizes,[5]);assert.equal(l.photos.filter(p=>p.status==='reviewed').length,0);
 await reviewGallery(l,createBudget(store,2),'.',{review:async photos=>{sizes.push(photos.length);return findings(photos);}});
 assert.deepEqual(sizes,[5,3,2]);assert.equal(l.photos.filter(p=>p.status==='reviewed').length,5);assert.equal(l.photos[5].status,'unavailable');
}finally{store.close();}});
test('budget-limited batch reviews resume every accessible image; unavailable images stay incomplete',async()=>{const store=new Store(':memory:');try{const l=sample(),seen:string[]=[];const deps={maxBatchPhotos:2,review:async(photos:Photo[])=>{seen.push(...photos.map(p=>p.id));return findings(photos);}};await assert.rejects(()=>reviewGallery(l,createBudget(store,1),'.',deps),/cap/);assert.equal(l.photos.filter(p=>p.status==='reviewed').length,2);assert.equal(l.allOutlooksCovered,false);await reviewGallery(l,createBudget(store,2),'.',deps);assert.deepEqual(seen,['p0','p1','p2','p3','p4']);assert.equal(l.photos[5].status,'unavailable');assert.equal(l.galleryComplete,false);assert.equal(l.allOutlooksCovered,false);assert.equal(l.gas,true);assert.match(l.evidence['visual:gas'],/p0/);assert.equal(l.furnished,null);
 const reused=sample();reused.sourceId='other';await reviewGallery(reused,createBudget(store,0),'.',{...deps,review:async()=>{throw new Error('No call allowed');}});assert.equal(reused.photos.filter(p=>p.status==='reviewed').length,5);assert.ok(reused.photos.every(p=>!p.unitCertain));assert.equal(reused.gas,null);
}finally{store.close();}});
test('a timeout retries smaller batches within the approved call allowance and reviews every accessible photo',async()=>{const store=new Store(':memory:');try{
 const l=sample(),sizes:number[]=[],budget=createBudget(store,3);
 await reviewGallery(l,budget,'.',{review:async photos=>{sizes.push(photos.length);if(sizes.length===1)throw new Error('The operation was aborted due to timeout');return findings(photos);}});
 assert.deepEqual(sizes,[5,3,2]);assert.equal(budget.remaining('aiCalls'),0);assert.equal(l.photos.filter(p=>p.status==='reviewed').length,5);assert.equal(l.photos[5].status,'unavailable');assert.equal(l.allOutlooksCovered,false);
}finally{store.close();}});
test('repeated timeouts stop after two smaller-batch retries',async()=>{const store=new Store(':memory:');try{
 const l=sample(),sizes:number[]=[],budget=createBudget(store,10);
 await assert.rejects(()=>reviewGallery(l,budget,'.',{review:async photos=>{sizes.push(photos.length);throw new DOMException('Request timed out','TimeoutError');}}),/Request timed out/);
 assert.deepEqual(sizes,[5,3,1]);assert.equal(budget.remaining('aiCalls'),7);assert.equal(l.photos.filter(p=>p.status==='reviewed').length,0);
}finally{store.close();}});
test('HTTP failures and quota errors never trigger a gallery retry',async()=>{
 for(const message of ['HTTP 503: service unavailable','HTTP 429: usage limit reached']){const store=new Store(':memory:');try{
  const l=sample(),budget=createBudget(store,10);let calls=0;
  await assert.rejects(()=>reviewGallery(l,budget,'.',{review:async()=>{calls++;throw new Error(message);}}),error=>error instanceof Error&&error.message===message);
  assert.equal(calls,1);assert.equal(budget.remaining('aiCalls'),9);
 }finally{store.close();}}
});
test('a timeout teaches smaller batches to the next gallery on the same model without changing another model',async()=>{
 const store=new Store(':memory:');try{
  await assert.rejects(()=>reviewGallery(sample(),createBudget(store,1),'.',{review:async()=>{throw new DOMException('Timed out','TimeoutError');}}),/Timed out/);
  const next=sample();next.sourceId='new';next.photos.forEach(p=>p.hash='new-'+p.hash);const sizes:number[]=[];
  await reviewGallery(next,createBudget(store,2),'.',{review:async photos=>{sizes.push(photos.length);return findings(photos);}});assert.deepEqual(sizes,[3,2]);
  const another=sample();another.sourceId='other-model';another.photos.forEach(p=>p.hash='other-'+p.hash);const other:number[]=[];
  await reviewGallery(another,createBudget(store,1),'.',{model:'different',review:async photos=>{other.push(photos.length);return findings(photos);}});assert.deepEqual(other,[5]);
 }finally{store.close();}
});
test('visual conflicts and representative facts remain uncertain on repeated processing',()=>{const l=sample();l.gas=false;l.laundry='shared-only';l.photos=[{...l.photos[0],status:'reviewed',kind:'interior',unitCertain:true,visualFeatures:{gas:true,workspace:true,openPlan:true,laundry:'in-unit',note:'Visible features'}}];applyVisualFeatures(l);applyVisualFeatures(l);assert.equal(l.gas,null);assert.equal(l.laundry,'unknown');const other=sample();other.photos=l.photos.map(p=>({...p,unitCertain:false}));applyVisualFeatures(other);assert.equal(other.workspace,null);assert.equal(other.furnished,null);});
test('ordinary text edits retain attribution; contradictions invalidate; new contexts reconcile cached evidence',async()=>{const store=new Store(':memory:');try{
 const l=sample();l.photos=l.photos.slice(0,1);l.galleryComplete=true;l.expectedPhotos=1;await reviewGallery(l,createBudget(store,1),'.',{review:async p=>findings(p)});assert.equal(l.photos[0].unitCertain,true);
 l.description='An updated availability date and new rent description.';await reviewGallery(l,createBudget(store,0),'.',{review:async()=>{throw new Error('Unchanged image');}});assert.equal(l.photos[0].unitCertain,true);
 l.description='Photos are of a similar unit.';await reviewGallery(l,createBudget(store,0),'.',{review:async()=>{throw new Error('Unchanged image');}});assert.equal(l.photos[0].unitCertain,false);
 const other=sample();other.sourceId='b';other.photos=other.photos.slice(0,1);other.galleryComplete=true;other.expectedPhotos=1;let attributed=0;await reviewGallery(other,createBudget(store,1),'.',{review:async()=>{throw new Error('Visual findings must be reused');},attribute:async photos=>{attributed++;return {photos:photos.map(p=>({id:p.id,unitCertain:true,note:'The same reviewed photo is explicitly attributed to this exact advertised unit.'}))};}});assert.equal(attributed,1);assert.equal(other.photos[0].unitCertain,true);assert.equal(other.photos[0].attributionPending,false);
}finally{store.close();}});
test('constructed gallery request respects ChatGPT plan fields and never sends tools',async t=>{const dir=await mkdtemp(join(tmpdir(),'finder-gallery-request-'));await mkdir(join(dir,'media'));await writeFile(join(dir,'media','fixture.jpg'),'fixture');const l=sample(),p={...l.photos[0],local:'fixture.jpg'};let body:any;t.mock.method(globalThis,'fetch',async(_url:unknown,options:any)=>{body=JSON.parse(options.body);return new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(findings([p]))}]}]}})+'\n\n');});await requestBatch([p],l,'fixture-model','fixture-token',dir);assert.equal(body.store,false);assert.equal(body.stream,true);for(const key of ['max_output_tokens','temperature','previous_response_id','background','tools'])assert.equal(key in body,false);assert.equal(body.input[0].content.filter((c:any)=>c.type==='input_image').length,1);});
test('shared photo context saves repeated text while retaining each cross-post attribution',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'finder-context-request-'));await mkdir(join(dir,'media'));await writeFile(join(dir,'media','fixture.jpg'),'fixture');
 const l=sample();l.description='Exact-unit context. '.repeat(100);l.unit='10';const photos=l.photos.slice(0,3).map(p=>({...p,local:'fixture.jpg'})),other={...l,source:'other',sourceId:'b',unit:'11',description:'Photos are of a similar unit.'};let body:any;
 t.mock.method(globalThis,'fetch',async(_url:unknown,options:any)=>{body=JSON.parse(options.body);return new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(findings(photos))}]}]}})+'\n\n');});
 await requestBatch(photos,l,'fixture-model','fixture-token',dir,new Map([[photos[2].id,other]]));const content=body.input[0].content,texts=content.filter((c:any)=>c.type==='input_text').map((c:any)=>JSON.parse(c.text)),contexts=texts.filter((t:any)=>t.sourceDescription!==undefined),refs=texts.filter((t:any)=>t.photo);
 assert.equal(content.filter((c:any)=>c.type==='input_image').length,3);assert.equal(contexts.length,2);assert.equal(refs.length,3);assert.equal(refs[0].sourceContextId,refs[1].sourceContextId);assert.notEqual(refs[0].sourceContextId,refs[2].sourceContextId);
 assert.equal(contexts.find((c:any)=>c.sourceContextId===refs[0].sourceContextId).sourceDescription,l.description);assert.equal(contexts.find((c:any)=>c.sourceContextId===refs[2].sourceContextId).representative,true);assert.equal(contexts.find((c:any)=>c.sourceContextId===refs[2].sourceContextId).unit,'11');
});
test('a representative cross-post does not invalidate another source exact-unit photo attribution',async()=>{const store=new Store(':memory:');try{const a=sample();a.address='100 Example St';a.unit='10';a.photos=a.photos.slice(0,1);a.galleryComplete=true;a.expectedPhotos=1;const id=store.ingest(a).id;const first=store.home(id)!.listing;await reviewGallery(first,createBudget(store,1),'.',{review:async p=>findings(p)});store.db.prepare('UPDATE homes SET listing=? WHERE id=?').run(JSON.stringify(first),id);
 const b=sample();b.source='other';b.sourceId='b';b.address=a.address;b.unit=a.unit;b.description='Photos are of a similar unit.';b.photos=[{...b.photos[1],id:'p0'}];b.galleryComplete=true;b.expectedPhotos=1;store.ingest(b);const merged=store.home(id)!.listing;await reviewGallery(merged,createBudget(store,1),'.',{review:async p=>findings(p)});assert.equal(merged.photos.find(p=>p.url===a.photos[0].url)!.unitCertain,true);assert.equal(merged.photos.find(p=>p.url===b.photos[0].url)!.unitCertain,false);
}finally{store.close();}});

test('thirty cached interiors retain condition when another offering only adds an unseen promotional image',async()=>{const store=new Store(':memory:');try{
 const first=sample();first.description='Photos are representative.';first.galleryComplete=true;first.expectedPhotos=31;first.photos=Array.from({length:31},(_,i)=>({...first.photos[0],id:`first-${i}`,url:`https://example.com/shared-${i}`,hash:i===30?'promo-first':`shared-${i}`,local:`${i}.jpg`,status:'downloaded'}));
 const assess=(photos:Photo[])=>{const interior=photos.filter(p=>!p.hash?.startsWith('promo-'));return {...findings(photos),photos:findings(photos).photos.map(p=>({...p,kind:interior.some(q=>q.id===p.id)?'interior':'unknown'})),interior:{modern:interior.length?true:null,cramped:null,photoIds:interior.map(p=>p.id),note:interior.length?'Updated kitchen, appliances and bathroom visible.':'No interior photograph supplied.'}};};
 await reviewGallery(first,createBudget(store,6),'.',{review:async photos=>assess(photos)});assert.equal(first.modern,true);const original=structuredClone(first);
 const second=sample();second.sourceId='second';second.description=first.description;second.galleryComplete=true;second.expectedPhotos=31;second.photos=first.photos.map((p,i)=>({...second.photos[0],id:`second-${i}`,url:p.url,hash:i===30?'promo-second':p.hash,local:p.local,status:'downloaded'}));let submitted:string[]=[];
 await reviewGallery(second,createBudget(store,1),'.',{review:async photos=>{submitted.push(...photos.map(p=>p.id));return assess(photos);}});
 assert.deepEqual(submitted,['second-30']);assert.equal(second.modern,true);assert.equal(second.cramped,null);assert.match(second.evidence.interiorAssessment,/second-0/);assert.doesNotMatch(second.evidence.interiorAssessment,/first-|No interior photograph/);assert.deepEqual(first,original);
 assert.ok(second.photos.every(p=>!p.unitCertain));assert.equal(second.allOutlooksCovered,false);assert.equal(second.gas,null);assert.equal(second.workspace,null);assert.equal(second.openPlan,null);assert.equal(second.furnished,null);assert.equal(second.laundry,'unknown');
}finally{store.close();}});

test('offline interior reuse requires every cited unchanged hash, reviewed interior and matching version',()=>{
 const version=`chatgpt:fixture:${galleryRubric}`,target=sample();target.photos=target.photos.slice(0,2).map((p,i)=>({...p,id:`target-${i}`,status:'reviewed',kind:'interior',version,unitCertain:false}));
 const record={version,results:[{modern:true,cramped:false,photoIds:['source-a','source-b'],hashes:{'source-a':'hash0','source-b':'hash1'},note:'Updated interior visible.'}]};
 for(const change of [
  (l:typeof target)=>{l.photos.pop();},
  (l:typeof target)=>{l.photos[1].hash='changed-content';},
  (l:typeof target)=>{l.photos[1].kind='exterior';},
  (l:typeof target)=>{l.photos[1].status='unavailable';},
  (l:typeof target)=>{l.photos[1].version='older-version';},
  (l:typeof target)=>{delete l.photos[1].hash;},
 ]){const l=structuredClone(target);change(l);const before=structuredClone(l);assert.equal(reconcileInteriorEvidence(l,[record],version),false);assert.deepEqual(l,before);}
 assert.equal(reconcileInteriorEvidence(target,[{...record,version:'older-version'}],version),false);
 const before=structuredClone(target);assert.equal(reconcileInteriorEvidence(target,[record],version),true);assert.equal(target.modern,true);assert.equal(target.cramped,false);assert.match(target.evidence.interiorAssessment,/Photos target-0, target-1:/);assert.deepEqual(target.photos,before.photos);
 assert.deepEqual({...target,modern:before.modern,cramped:before.cramped,evidence:before.evidence},before);
});

test('reused interior findings retain conservative condition conflicts and ignore uncited promotional assessments',()=>{
 const version=`chatgpt:fixture:${galleryRubric}`,l=sample();l.photos=[{...l.photos[0],id:'target',kind:'interior',status:'reviewed',version,unitCertain:false}];
 const evidence={photoIds:['source'],hashes:{source:'hash0'},note:'Visible interior condition.'};
 assert.equal(reconcileInteriorEvidence(l,[{version,results:[{...evidence,modern:true,cramped:false},{...evidence,modern:false,cramped:true},{modern:null,cramped:null,photoIds:[],hashes:{},note:'No interior photograph supplied.'}]}],version),true);
 assert.equal(l.modern,false);assert.equal(l.cramped,true);assert.doesNotMatch(l.evidence.interiorAssessment,/No interior photograph/);assert.deepEqual(l.photos.map(p=>p.unitCertain),[false]);
});

test('a three-photo timeout reduces the next gallery to two-photo batches without skipping photos',async()=>{
 const store=new Store(':memory:');try{
  await assert.rejects(()=>reviewGallery(sample(),createBudget(store,1),'.',{maxBatchPhotos:3,review:async()=>{throw new DOMException('Timed out','TimeoutError');}}),/Timed out/);
  const next=sample();next.sourceId='two-photo-retry';next.photos.forEach(p=>p.hash='two-'+p.hash);const sizes:number[]=[];
  await reviewGallery(next,createBudget(store,3),'.',{review:async photos=>{sizes.push(photos.length);return findings(photos);}});
  assert.deepEqual(sizes,[2,2,1]);assert.equal(next.photos.filter(p=>p.status==='reviewed').length,5);assert.equal(next.photos[5].status,'unavailable');
 }finally{store.close();}
});

test('unsupported interior evidence gets one corrected review without caching invalid findings',async()=>{
 const store=new Store(':memory:');try{
  const l=sample(),budget=createBudget(store,4),submitted:string[][]=[],feedback:(string|undefined)[]=[];
  await reviewGallery(l,budget,'.',{maxBatchPhotos:2,review:async(photos,_listing,error)=>{
   submitted.push(photos.map(p=>p.id));feedback.push(error);
   if(submitted.length===1)return {...findings(photos),interior:{modern:true,cramped:false,photoIds:['not-submitted'],note:'Unsupported'}};
   if(submitted.length===2){assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM photo_cache').get()!.n,0);assert.ok(l.photos.every(p=>p.status!=='reviewed'));}
   return findings(photos);
  }});
  assert.deepEqual(submitted,[['p0','p1'],['p0','p1'],['p2','p3'],['p4']]);assert.equal(feedback[0],undefined);assert.match(feedback[1]!,/supporting apartment photos/);assert.equal(feedback[2],undefined);
  assert.equal(budget.remaining('aiCalls'),0);assert.equal(l.photos.filter(p=>p.status==='reviewed').length,5);assert.equal(l.photos[5].status,'unavailable');assert.equal(l.modern,null);
 }finally{store.close();}
});

test('repeated invalid gallery responses stop after one correction and remain unfinished',async()=>{
 const store=new Store(':memory:');try{
  const l=sample(),budget=createBudget(store,10);let calls=0;
  await assert.rejects(()=>reviewGallery(l,budget,'.',{review:async photos=>{calls++;return {...findings(photos),photos:findings(photos).photos.slice(1)};}}),/every submitted photo/);
  assert.equal(calls,2);assert.equal(budget.remaining('aiCalls'),8);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM photo_cache').get()!.n,0);assert.equal(l.photos.filter(p=>p.status==='reviewed').length,0);
 }finally{store.close();}
});

test('invalid gallery responses do not receive a correction beyond the approved call allowance',async()=>{
 const store=new Store(':memory:');try{
  const l=sample(),budget=createBudget(store,1);let calls=0;
  await assert.rejects(()=>reviewGallery(l,budget,'.',{review:async()=>{calls++;return {photos:[]};}}));
  assert.equal(calls,1);assert.equal(budget.remaining('aiCalls'),0);assert.ok(l.photos.every(p=>p.status!=='reviewed'));
 }finally{store.close();}
});
