import type {Store} from './db.ts';
import type {Caps} from '../src/domain.ts';

type Lock={owner:string;heartbeat:string};
type Member={plan_id:string;group_id:string;source:string;heartbeat:string};
const chromeSources=new Set(['apartments','zillow']);
const groupOwner=(group:string)=>`parallel:${group}`;
export const isCachedReview=(caps:Caps)=>caps.cachedReviewOnly===true;
const resource=(caps:Caps)=>isCachedReview(caps)?`review:${caps.fullReviewHomeIds![0]}`:caps.sources[0];
function plan(store:Store,id:string){const row=store.db.prepare('SELECT id,caps,state FROM plans WHERE id=?').get(id) as {id:string;caps:string;state:string}|undefined;if(!row)throw Error('Plan not found');return {...row,caps:JSON.parse(row.caps) as Caps};}

export function assertParallelCaps(caps:Caps){
 if(isCachedReview(caps)){
  if(caps.purpose!=='listings'||caps.assessmentMode!=='full'||caps.phase!=='assessment'||caps.sources.length!==1||caps.fullReviewHomeIds?.length!==1||caps.maxPhotos!==0||(caps.maxAddressLookups??0)!==0||caps.maxReservedUsd!==0||caps.billingMode!=='chatgpt'||caps.newListingsOnly||caps.refreshActiveListings)throw Error('Cached parallel assessments require one selected home, saved photos only and no source access or paid allowance');
  return;
 }
 if(!caps.parallelGroup)return;
 if(caps.purpose!=='listings'||caps.assessmentMode!=='quick'||caps.sources.length!==1||caps.maxAiCalls!==0||caps.maxReservedUsd!==0||(caps.maxAddressLookups??0)!==0||caps.fullReviewHomeIds?.length||caps.refreshActiveListings)throw Error('Parallel scans require one source, quick intake, zero AI/address allowance and no saved-home refresh');
}

/** Admission checks include approved workers not yet claimed and children still closing. */
export function assertCanStartScan(store:Store,id:string,activeProcessIds:readonly string[]=[]){
 const current=plan(store,id);assertParallelCaps(current.caps);
 const lock=store.db.prepare('SELECT owner,heartbeat FROM scan_lock WHERE id=1').get() as Lock|undefined;
 const members=store.db.prepare('SELECT * FROM parallel_scan_members').all() as Member[];
 const active=new Set<string>([...activeProcessIds,...members.map(m=>m.plan_id),...(store.db.prepare("SELECT id FROM plans WHERE state IN ('approved','running')").all() as {id:string}[]).map(p=>p.id)]);active.delete(id);
 if(!current.caps.parallelGroup){if(lock||active.size||members.length)throw Error('Another scan is running or needs interrupted-run recovery');return;}
 const group=current.caps.parallelGroup;
 if(lock&&lock.owner!==groupOwner(group))throw Error('Another scan group is running or needs interrupted-run recovery');
 if(members.some(m=>m.group_id!==group))throw Error('Another scan group needs interrupted-run recovery');
 if(active.size>=3)throw Error('Parallel scan group already has three active sources');
 if(isCachedReview(current.caps)&&[...active].filter(id=>isCachedReview(plan(store,id).caps)).length>=2)throw Error('Parallel group already has two active cached assessments');
 for(const otherId of active){const other=plan(store,otherId);assertParallelCaps(other.caps);
  if(other.caps.parallelGroup!==group)throw Error('Another scan group is running');
  if(resource(other.caps)===resource(current.caps))throw Error(isCachedReview(current.caps)?'An assessment for this apartment is already active':'A scan for this source is already active');
  if(!isCachedReview(other.caps)&&!isCachedReview(current.caps)&&chromeSources.has(other.caps.sources[0])&&chromeSources.has(current.caps.sources[0]))throw Error('The shared Chrome source lane is already active');
 }
}

/** Called inside claimPlan's write transaction. Singleton sentinel blocks legacy work. */
export function claimScan(store:Store,id:string,caps:Caps){
 assertCanStartScan(store,id);
 const now=new Date().toISOString();
 if(!caps.parallelGroup){store.db.prepare('INSERT INTO scan_lock VALUES (1,?,?)').run(id,now);return;}
 const owner=groupOwner(caps.parallelGroup);
 store.db.prepare('INSERT OR IGNORE INTO scan_lock VALUES (1,?,?)').run(owner,now);
 store.db.prepare('INSERT INTO parallel_scan_members(plan_id,group_id,source,heartbeat) VALUES (?,?,?,?)').run(id,caps.parallelGroup,resource(caps),now);
 store.db.prepare('UPDATE scan_lock SET heartbeat=? WHERE owner=?').run(now,owner);
}
export function heartbeatScan(store:Store,id:string){
 const now=new Date().toISOString(),member=store.db.prepare('SELECT group_id FROM parallel_scan_members WHERE plan_id=?').get(id) as {group_id:string}|undefined;
 if(member)store.db.prepare('UPDATE parallel_scan_members SET heartbeat=? WHERE plan_id=?').run(now,id);
 store.db.prepare('UPDATE scan_lock SET heartbeat=? WHERE owner=?').run(now,member?groupOwner(member.group_id):id);
}
/** A finishing source releases only itself; siblings retain the global sentinel. */
export function releaseScan(store:Store,id:string){store.transaction(()=>{
 const member=store.db.prepare('SELECT group_id FROM parallel_scan_members WHERE plan_id=?').get(id) as {group_id:string}|undefined;
 if(!member){store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(id);return;}
 store.db.prepare('DELETE FROM parallel_scan_members WHERE plan_id=?').run(id);
 if(!store.db.prepare('SELECT 1 FROM parallel_scan_members WHERE group_id=?').get(member.group_id))store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(groupOwner(member.group_id));
});}
export function recoverScan(store:Store){return store.transaction(()=>{
 const lock=store.db.prepare('SELECT owner,heartbeat FROM scan_lock WHERE id=1').get() as Lock|undefined;if(!lock)throw Error('No interrupted scan to recover');
 const members=store.db.prepare('SELECT * FROM parallel_scan_members').all() as Member[];
 if([lock.heartbeat,...members.map(m=>m.heartbeat)].some(at=>Date.now()-Date.parse(at)<600000))throw Error('The worker may still be active. Cancel it or wait ten minutes without progress before recovery.');
 const detail='Interrupted scan recovered. Completed work retained; a new approved plan is required.';
 if(lock.owner.startsWith('parallel:')){
  const group=lock.owner.slice('parallel:'.length);
  if(members.some(m=>m.group_id!==group))throw Error('Scan lock membership mismatch; manual inspection required');
  store.db.prepare("UPDATE plans SET state='interrupted',detail=? WHERE json_extract(caps,'$.parallelGroup')=? AND state IN ('approved','running')").run(detail,group);
  store.db.prepare('DELETE FROM parallel_scan_members WHERE group_id=?').run(group);
 }else store.db.prepare("UPDATE plans SET state='interrupted',detail=? WHERE id=?").run(detail,lock.owner);
 store.db.prepare('DELETE FROM scan_lock WHERE owner=?').run(lock.owner);store.event('Interrupted worker recovered. No scan restarted.');
});}
