/** Offline audit only: opens SQLite read-only, never imports Store or calls a provider. */
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {criteriaSchema,listingSchema,type Criteria,type Listing} from '../src/domain.ts';
import {scoreBase,scoreListing} from '../server/scoring.ts';
import {learningFromRows,type LearningRow} from '../server/feedback-learning.ts';

export type EvaluationRow=LearningRow&{criteria_json:string;at?:string};
const band=(n:number)=>n<3?'excluded':n<4?'worth-looking':'strong-match';
const latestRows=(rows:EvaluationRow[])=>[...new Map([...rows].sort((a,b)=>a.id-b.id).map(r=>[r.home_id,r])).values()];
function metrics(predictions:{target:number;prediction:number}[]){
 return {examples:predictions.length,meanAbsoluteError:predictions.length?Number((predictions.reduce((n,p)=>n+Math.abs(p.target-p.prediction),0)/predictions.length).toFixed(4)):null,matchingBands:predictions.filter(p=>band(p.target)===band(p.prediction)).length,strongMatchLabels:predictions.filter(p=>p.target>=4).length};
}
function predict(rows:EvaluationRow[],criteria:Criteria){return rows.map(r=>{
 const l={...listingSchema.parse(JSON.parse(r.listing_json)),homeId:r.home_id},score=scoreListing(l,criteria);
 return {homeId:r.home_id,feedbackId:r.id,target:r.user_score,prediction:score.value,base:scoreBase(l,criteria).value,targetBand:band(r.user_score),predictedBand:band(score.value),hardFailures:score.reasons.filter(r=>r!=='Score below 3.0')};
});}

/** Hold out whole apartments first seen after the cutoff, never a second rating of a training home. */
export function chronologicalHoldout(rows:EvaluationRow[]){
 const sorted=[...rows].sort((a,b)=>a.id-b.id),first=new Map<number,EvaluationRow>();for(const r of sorted)if(!first.has(r.home_id))first.set(r.home_id,r);
 const homes=[...first.keys()];if(homes.length<4)return null;
 const count=Math.max(1,Math.floor(homes.length/4)),testIds=homes.slice(-count),cutoff=first.get(testIds[0])!;
 const training=sorted.filter(r=>r.id<cutoff.id&&!testIds.includes(r.home_id));
 // This snapshot precedes the first held-out submission. Current criteria would leak its label.
 const frozen=criteriaSchema.parse(JSON.parse(cutoff.criteria_json));
 const criteria=learningFromRows(training,frozen).criteria;
 const test=latestRows(sorted.filter(r=>testIds.includes(r.home_id))),predictions=predict(test,criteria);
 return {label:'Retrospective chronological holdout: held-out labels and reasons excluded from calibration',limitations:'The implementation and rubric were reviewed after these apartments were seen. This is not a prospective blind accuracy claim; it isolates fitting leakage from saved feedback, not all prior human knowledge.',cutoffFeedbackId:cutoff.id,trainingHomeIds:[...new Set(training.map(r=>r.home_id))],heldOutHomeIds:testIds,...metrics(predictions),predictions};
}

export function counterfactualChecks(c:Criteria,examples:Listing[]=[]){
 const fixture=listingSchema.parse({source:'evaluation',sourceId:'synthetic',url:'https://example.test/apartment',title:'Fictional evaluation apartment',address:'100 Example Street',rent:2800,beds:1,location:'downtown',laundry:'in-unit',parking:'included',floorLevel:10,modern:true,furnished:false,workspace:false,gas:false,north:false,shortLease:false,openPlan:false,cramped:false,photos:[{id:'window',url:'https://example.test/window.jpg',status:'reviewed',kind:'interior',scenery:'nature',quality:3,unitCertain:true}],galleryComplete:true,expectedPhotos:1});
 const cases=[fixture,...examples];let comparisons=0;const violations:{case:string;kind:string;from:number;to:number;before:number;after:number}[]=[];
 const check=(l:Listing,kind:string,from:number,to:number,before:number,after:number,increasing:boolean)=>{comparisons++;if(increasing?after<before:after>before)violations.push({case:l.homeId?`Apartment #${l.homeId}`:l.sourceId,kind,from,to,before,after});};
 for(const l of cases)for(const calibrated of [false,true]){
  const score=(x:Listing)=>(calibrated?scoreListing(x,c):scoreBase(x,c)).value,label=calibrated?'calibrated':'base';
  let previous=score({...l,rent:1500});
  for(let rent=1600;rent<=4600;rent+=100){const next=score({...l,rent});check(l,`${label}:rent`,rent-100,rent,previous,next,false);previous=next;}
  const verified=l.photos.some(p=>p.status==='reviewed'&&p.kind==='interior'&&p.unitCertain&&p.scenery==='nature');
  if(verified){const withView=(quality:number)=>({...l,photos:l.photos.map(p=>p.status==='reviewed'&&p.kind==='interior'&&p.unitCertain&&p.scenery==='nature'?{...p,quality}:p)});previous=score(withView(1));for(let step=11;step<=50;step++){const q=step/10,next=score(withView(q));check(l,`${label}:view`,q-.1,q,previous,next,true);previous=next;}}
  // Benefits at fixed bedrooms; the explicitly configured den/second-bedroom substitution is separate.
  if(!calibrated)for(const field of ['furnished','workspace','gas','north','shortLease','openPlan'] as const)check(l,`base:${field}`,0,1,score({...l,[field]:false}),score({...l,[field]:true}),true);
 }
 return {comparisons,violations:violations.length,examples:violations.slice(0,50),scope:'Base and fixed-context calibrated rent/view ordering; convenience additions tested at fixed bedrooms before calibration.'};
}

export function evaluateRows(criteria:Criteria,rows:EvaluationRow[]){
 const recalibrated=learningFromRows(rows,criteria).criteria,latest=latestRows(rows),predictions=predict(latest,recalibrated);
 return {criteria:recalibrated,inSample:{label:'In-sample calibration: these labels contributed to rules/examples; not unseen-listing accuracy',...metrics(predictions),predictions},holdout:chronologicalHoldout(rows)};
}

export function evaluateDatabase(database:string,baselinePath?:string){
 const db=new DatabaseSync(database,{readOnly:true});
 try{
  const criteria=criteriaSchema.parse(JSON.parse((db.prepare("SELECT value FROM meta WHERE key='criteria'").get() as {value:string}).value));
  const rows=db.prepare("SELECT id,home_id,user_score,reason,listing_json,score_json,criteria_json,at FROM rating_feedback WHERE status!='reverted' ORDER BY id").all() as EvaluationRow[];
  const homes=(db.prepare('SELECT id,stage,listing FROM homes ORDER BY id').all() as {id:number;stage:string;listing:string}[]).map(r=>({id:r.id,stage:r.stage,listing:{...listingSchema.parse(JSON.parse(r.listing)),homeId:r.id}}));
  const evaluation=evaluateRows(criteria,rows);
  const baseline=baselinePath?JSON.parse(readFileSync(baselinePath,'utf8')) as {capturedAt:string;homes:{id:number;score:{value:number;eligible:boolean}}[]}:null;
  const changes=homes.map(h=>{const before=baseline?.homes.find(x=>x.id===h.id)?.score,after=scoreListing(h.listing,evaluation.criteria);return {homeId:h.id,stage:h.stage,before:before?.value??null,after:after.value,beforeEligible:before?.eligible??null,afterEligible:after.eligible,reasons:after.reasons};}).filter(h=>h.before===null||h.before!==h.after||h.beforeEligible!==h.afterEligible);
  return {generatedAt:new Date().toISOString(),mode:'Offline, read-only SQLite; no scans, downloads, AI requests, or database writes',baselineCapturedAt:baseline?.capturedAt??null,homes:homes.length,feedbackSubmissions:rows.length,inSample:evaluation.inSample,holdout:evaluation.holdout,counterfactuals:counterfactualChecks(evaluation.criteria,homes.map(h=>h.listing)),changes,interpretation:'Score changes are a preview using reconstructed feedback under the new code. Historical personal scores and user stages remain unchanged. Review lower-than-target outcomes against hard requirements and corrected evidence, rather than treating personal labels as permission to weaken them.'};
 }finally{db.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2),options:Record<string,string>={};
 for(let i=0;i<args.length;i+=2){if(!['--database','--baseline','--out'].includes(args[i])||!args[i+1])throw new Error('Usage: scoring-evaluation.ts [--database PATH] [--baseline JSON] [--out JSON]');options[args[i]]=args[i+1];}
 const database=options['--database']??'data/live/apartments.sqlite';
 if(options['--out']&&resolve(options['--out'])===resolve(database))throw new Error('Report output must not overwrite the database');
 const report=evaluateDatabase(database,options['--baseline']),json=JSON.stringify(report,null,2);
 if(options['--out']){mkdirSync(dirname(resolve(options['--out'])),{recursive:true});writeFileSync(options['--out'],json+'\n');console.log(JSON.stringify({report:resolve(options['--out']),homes:report.homes,inSample:report.inSample.meanAbsoluteError,holdout:report.holdout?.meanAbsoluteError,counterfactualViolations:report.counterfactuals.violations,changes:report.changes.length}));}else console.log(json);
}
