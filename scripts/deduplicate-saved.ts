/** Offline duplicate audit/cleanup. No source access, model calls or scan authorization. */
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Store} from '../server/db.ts';
import {deduplicateHome,refreshDuplicateIndex} from '../server/automatic-duplicates.ts';

const apply=process.argv.includes('--apply'),input=process.argv.find(arg=>arg.startsWith('--db='))?.slice(5)??'data/live/apartments.sqlite';
const source=new DatabaseSync(resolve(input),{readOnly:true}),directory=resolve('data/live/duplicate-audits',new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(directory,{recursive:true});
const snapshot=join(directory,'before.sqlite');await backup(source,snapshot);source.close();
const store=new Store(apply?resolve(input):snapshot),started=performance.now();
try{
 if(apply&&store.db.prepare("SELECT 1 FROM plans WHERE state IN ('approved','running') UNION SELECT 1 FROM scan_lock UNION SELECT 1 FROM parallel_scan_members").get())throw Error('An approved or active scan exists; defer offline cleanup until it finishes.');
 refreshDuplicateIndex(store);
 const indexedMs=performance.now()-started,ids=(store.db.prepare('SELECT id FROM homes WHERE id NOT IN (SELECT alias FROM home_aliases) ORDER BY first_seen,id').all() as {id:number}[]).map(r=>r.id),matches=[];
 for(const id of ids){
  while(store.resolveHomeId(id)===id){
   const match=deduplicateHome(store,id);if(!match)break;
   const keep=store.db.prepare('SELECT stage,listing FROM homes WHERE id=?').get(match.olderId) as {stage:string;listing:string},drop=store.db.prepare('SELECT stage,listing FROM homes WHERE id=?').get(match.newerId) as {stage:string;listing:string};
   matches.push({...match,keptStage:keep.stage,removedStage:drop.stage,olderAddress:JSON.parse(keep.listing).address,newerAddress:JSON.parse(drop.listing).address});
  }
 }
 const report={mode:apply?'applied':'preview (snapshot only)',source:resolve(input),snapshot,homesBefore:ids.length,merged:matches.length,indexedMs:Math.round(indexedMs),totalMs:Math.round(performance.now()-started),matches};
 writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({...report,matches:matches.slice(0,30),report:join(directory,'report.json')},null,2));
}finally{store.close();}
