import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/db.ts';
import {listingSchema,type Photo} from '../src/domain.ts';
import {createPlan,approvePlan,claimPlan,Budget} from '../server/plans.ts';
import {reviewGallery,applyVisualFeatures,requestBatch,reconcileInteriorEvidence,galleryRubric} from '../server/gallery-review.ts';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const createBudget=(store:Store,calls:number)=>{store.db.prepare('DELETE FROM scan_lock').run();const p=createPlan(store,{sources:['craigslist'],billingMode:'chatgpt',maxPages:2,maxListings:1,maxPhotos:10,maxAiCalls:calls,maxReservedUsd:0,reservePerCallUsd:.1});approvePlan(store,p.id,'APPROVE ONE SCAN');claimPlan(store,p.id);return new Budget(store,p.id,p.caps);};
const sample=()=>listingSchema.parse({source:'fixture',sourceId:'a',url:'https://example.com/a',title:'Fixture',address:'Example',rent:2400,beds:1,galleryComplete:false,expectedPhotos:6,photos:Array.from({length:6},(_,i)=>({id:`p${i}`,url:`https://example.com/${i}`,hash:`hash${i}`,local:i===5?undefined:`${i}.jpg`,status:i===5?'unavailable':'downloaded'}))});
const findings=(photos:Photo[])=>({photos:photos.map(p=>({id:p.id,kind:'interior',scenery:'nature',quality:4,unitCertain:true,note:'Unit window',visualFeatures:{gas:true,workspace:null,openPlan:true,laundry:'unknown',note:'Gas burners and open kitchen visible'}})),allOutlooksCovered:true,summary:'Supplied photos reviewed',interior:{modern:null,cramped:null,photoIds:photos.map(p=>p.id),note:'Condition uncertain'}});
test('budget-limited batch reviews resume every accessible image; unavailable images stay incomplete',async()=>{const store=new Store(':memory:');try{const l=sample(),seen:string[]=[];const deps={maxBatchPhotos:2,review:async(photos:Photo[])=>{seen.push(...photos.map(p=>p.id));return findings(photos);}};await assert.rejects(()=>reviewGallery(l,createBudget(store,1),'.',deps),/cap/);assert.equal(l.photos.filter(p=>p.status==='reviewed').length,2);assert.equal(l.allOutlooksCovered,false);await reviewGallery(l,createBudget(store,2),'.',deps);assert.deepEqual(seen,['p0','p1','p2','p3','p4']);assert.equal(l.photos[5].status,'unavailable');assert.equal(l.galleryComplete,false);assert.equal(l.allOutlooksCovered,false);assert.equal(l.gas,true);assert.match(l.evidence['visual:gas'],/p0/);assert.equal(l.furnished,null);
 const reused=sample();reused.sourceId='other';await reviewGallery(reused,createBudget(store,0),'.',{...deps,review:async()=>{throw new Error('No call allowed');}});assert.equal(reused.photos.filter(p=>p.status==='reviewed').length,5);assert.ok(reused.photos.every(p=>!p.unitCertain));assert.equal(reused.gas,null);
}finally{store.close();}});
test('visual conflicts and representative facts remain uncertain on repeated processing',()=>{const l=sample();l.gas=false;l.laundry='shared-only';l.photos=[{...l.photos[0],status:'reviewed',kind:'interior',unitCertain:true,visualFeatures:{gas:true,workspace:true,openPlan:true,laundry:'in-unit',note:'Visible features'}}];applyVisualFeatures(l);applyVisualFeatures(l);assert.equal(l.gas,null);assert.equal(l.laundry,'unknown');const other=sample();other.photos=l.photos.map(p=>({...p,unitCertain:false}));applyVisualFeatures(other);assert.equal(other.workspace,null);assert.equal(other.furnished,null);});
test('ordinary text edits retain attribution; contradictions invalidate; new contexts reconcile cached evidence',async()=>{const store=new Store(':memory:');try{
 const l=sample();l.photos=l.photos.slice(0,1);l.galleryComplete=true;l.expectedPhotos=1;await reviewGallery(l,createBudget(store,1),'.',{review:async p=>findings(p)});assert.equal(l.photos[0].unitCertain,true);
 l.description='An updated availability date and new rent description.';await reviewGallery(l,createBudget(store,0),'.',{review:async()=>{throw new Error('Unchanged image');}});assert.equal(l.photos[0].unitCertain,true);
 l.description='Photos are of a similar unit.';await reviewGallery(l,createBudget(store,0),'.',{review:async()=>{throw new Error('Unchanged image');}});assert.equal(l.photos[0].unitCertain,false);
 const other=sample();other.sourceId='b';other.photos=other.photos.slice(0,1);other.galleryComplete=true;other.expectedPhotos=1;let attributed=0;await reviewGallery(other,createBudget(store,1),'.',{review:async()=>{throw new Error('Visual findings must be reused');},attribute:async photos=>{attributed++;return {photos:photos.map(p=>({id:p.id,unitCertain:true,note:'The same reviewed photo is explicitly attributed to this exact advertised unit.'}))};}});assert.equal(attributed,1);assert.equal(other.photos[0].unitCertain,true);assert.equal(other.photos[0].attributionPending,false);
}finally{store.close();}});
test('constructed gallery request respects ChatGPT plan fields and never sends tools',async t=>{const dir=await mkdtemp(join(tmpdir(),'finder-gallery-request-'));await mkdir(join(dir,'media'));await writeFile(join(dir,'media','fixture.jpg'),'fixture');const l=sample(),p={...l.photos[0],local:'fixture.jpg'};let body:any;t.mock.method(globalThis,'fetch',async(_url:unknown,options:any)=>{body=JSON.parse(options.body);return new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(findings([p]))}]}]}})+'\n\n');});await requestBatch([p],l,'fixture-model','fixture-token',dir);assert.equal(body.store,false);assert.equal(body.stream,true);for(const key of ['max_output_tokens','temperature','previous_response_id','background','tools'])assert.equal(key in body,false);assert.equal(body.input[0].content.filter((c:any)=>c.type==='input_image').length,1);});
test('a representative cross-post does not invalidate another source exact-unit photo attribution',async()=>{const store=new Store(':memory:');try{const a=sample();a.address='100 Example St';a.unit='10';a.photos=a.photos.slice(0,1);a.galleryComplete=true;a.expectedPhotos=1;const id=store.ingest(a).id;const first=store.home(id)!.listing;await reviewGallery(first,createBudget(store,1),'.',{review:async p=>findings(p)});store.db.prepare('UPDATE homes SET listing=? WHERE id=?').run(JSON.stringify(first),id);
 const b=sample();b.source='other';b.sourceId='b';b.address=a.address;b.unit=a.unit;b.description='Photos are of a similar unit.';b.photos=[{...b.photos[1],id:'p0'}];b.galleryComplete=true;b.expectedPhotos=1;store.ingest(b);const merged=store.home(id)!.listing;await reviewGallery(merged,createBudget(store,1),'.',{review:async p=>findings(p)});assert.equal(merged.photos.find(p=>p.url===a.photos[0].url)!.unitCertain,true);assert.equal(merged.photos.find(p=>p.url===b.photos[0].url)!.unitCertain,false);
}finally{store.close();}});

test('thirty cached interiors retain condition when another offering only adds an unseen promotional image',async()=>{const store=new Store(':memory:');try{
 const first=sample();first.description='Photos are representative.';first.galleryComplete=true;first.expectedPhotos=31;first.photos=Array.from({length:31},(_,i)=>({...first.photos[0],id:`first-${i}`,url:`https://example.com/shared-${i}`,hash:i===30?'promo-first':`shared-${i}`,local:`${i}.jpg`,status:'downloaded'}));
 const assess=(photos:Photo[])=>{const interior=photos.filter(p=>!p.hash?.startsWith('promo-'));return {...findings(photos),photos:findings(photos).photos.map(p=>({...p,kind:interior.some(q=>q.id===p.id)?'interior':'unknown'})),interior:{modern:interior.length?true:null,cramped:null,photoIds:interior.map(p=>p.id),note:interior.length?'Updated kitchen, appliances and bathroom visible.':'No interior photograph supplied.'}};};
 await reviewGallery(first,createBudget(store,3),'.',{review:async photos=>assess(photos)});assert.equal(first.modern,true);const original=structuredClone(first);
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
