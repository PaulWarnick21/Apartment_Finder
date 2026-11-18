import {categoryEntry} from './desk-membership.ts';
import {migrateSeriousCandidates} from './stage-migration.ts';
import {initializeDuplicateIndex} from './automatic-duplicates.ts';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {criteriaSchema,listingSchema,type Criteria,type Listing,type Home} from '../src/domain.ts';
import {canTransition,stageGroup} from '../src/stage-transitions.ts';
import {scoreListing} from './scoring.ts';
import {quickRank} from './quick-rank.ts';
import {quickRank as legacyQuickRank} from './quick-rank-v1.ts';
import {searchAreaExclusion} from './search-area.ts';
import {correctStudioBedrooms} from '../src/bedrooms.ts';
import {bedroomIntakeExclusion} from './bedroom-intake.ts';
import {photoCollectionExclusion} from '../src/photo-availability.ts';
import {addressKey,unitIdentity,compatibleUnit,reconcileListing,unionPhotos} from './listing-integrity.ts';
import {enrichListingContext,verifiedLocationKey,applyVerifiedLocation,type VerifiedLocation} from './listing-context.ts';
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export class Store {
 db:DatabaseSync;
 private parsed=new Map<number,{raw:string;listing:Listing;criteria:string;score:Home['score'];quickRank?:Home['quickRank']}>();
 private transactionDepth=0;
 constructor(public path:string){if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS homes(id INTEGER PRIMARY KEY AUTOINCREMENT, identity TEXT UNIQUE, listing TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'Unreviewed',notes TEXT NOT NULL DEFAULT '',follow_up TEXT NOT NULL DEFAULT '',viewing TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,rescued INTEGER NOT NULL DEFAULT 0,first_seen TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS desk_membership(home_id INTEGER PRIMARY KEY REFERENCES homes(id),category TEXT NOT NULL,entered_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS postings(source TEXT,source_id TEXT,home_id INTEGER REFERENCES homes(id),url TEXT,fingerprint TEXT,PRIMARY KEY(source,source_id));
 CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY,home_id INTEGER,at TEXT,event TEXT,before_json TEXT,after_json TEXT);
 CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,at TEXT,message TEXT);
 CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,caps TEXT,state TEXT,created_at TEXT,expires_at TEXT,usage TEXT,detail TEXT);
 CREATE TABLE IF NOT EXISTS source_health(source TEXT PRIMARY KEY,paused_until TEXT,reason TEXT,needs_attention INTEGER DEFAULT 0,last_success TEXT);
 CREATE TABLE IF NOT EXISTS seen(source TEXT,url TEXT,checked_at TEXT,PRIMARY KEY(source,url));
 CREATE TABLE IF NOT EXISTS photo_cache(hash TEXT,version TEXT,result TEXT,PRIMARY KEY(hash,version));
 CREATE TABLE IF NOT EXISTS scan_lock(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT,heartbeat TEXT);
 CREATE TABLE IF NOT EXISTS parallel_scan_members(plan_id TEXT PRIMARY KEY REFERENCES plans(id),group_id TEXT NOT NULL,source TEXT NOT NULL,heartbeat TEXT NOT NULL,UNIQUE(group_id,source));
 CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY,source TEXT,at TEXT,kind TEXT);
 CREATE TABLE IF NOT EXISTS duplicate_decisions(a INTEGER,b INTEGER,decision TEXT,PRIMARY KEY(a,b));
 CREATE TABLE IF NOT EXISTS rating_feedback(id INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT NOT NULL UNIQUE,home_id INTEGER NOT NULL REFERENCES homes(id),at TEXT NOT NULL,user_score REAL NOT NULL,reason TEXT NOT NULL,listing_json TEXT NOT NULL,score_json TEXT NOT NULL,criteria_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',review_json TEXT,error TEXT NOT NULL DEFAULT '',origin TEXT NOT NULL DEFAULT 'app');
 CREATE TABLE IF NOT EXISTS calibration_changes(id INTEGER PRIMARY KEY AUTOINCREMENT,feedback_id INTEGER NOT NULL UNIQUE REFERENCES rating_feedback(id),at TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,reverted INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS posting_details(source TEXT,source_id TEXT,home_id INTEGER NOT NULL REFERENCES homes(id),listing TEXT NOT NULL,captured_at TEXT NOT NULL,PRIMARY KEY(source,source_id));
 CREATE TABLE IF NOT EXISTS home_aliases(alias INTEGER PRIMARY KEY REFERENCES homes(id),canonical INTEGER NOT NULL REFERENCES homes(id));
 CREATE TABLE IF NOT EXISTS home_merges(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,keep_id INTEGER NOT NULL,duplicate_id INTEGER NOT NULL,snapshot TEXT NOT NULL,merged_revision INTEGER NOT NULL,split INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS postings_home ON postings(home_id);
 CREATE INDEX IF NOT EXISTS posting_details_home ON posting_details(home_id);
 CREATE INDEX IF NOT EXISTS history_home ON history(home_id,id);
 CREATE INDEX IF NOT EXISTS feedback_home ON rating_feedback(home_id,id);
 CREATE INDEX IF NOT EXISTS home_address ON homes(lower(trim(json_extract(listing,'$.address'))));
 PRAGMA user_version=1;`);
 if(!this.get('criteria'))this.set('criteria',criteriaSchema.parse({}));
 // Snapshot pre-update ranks locally; never rewrite listings, numeric scores or decisions.
 if(!this.get('quickRankPolicyV2'))this.transaction(()=>{
  if(this.get('quickRankPolicyV2'))return;
  const criteria=this.criteria,rows=this.db.prepare('SELECT id,listing FROM homes').all() as {id:number;listing:string}[];
  for(const row of rows)this.set(`preservedQuickRank:${row.id}`,legacyQuickRank(listingSchema.parse(JSON.parse(row.listing)),criteria,row.id));
  this.set('quickRankPolicyV2',{activatedAt:new Date().toISOString(),preserved:rows.length});
 });
 migrateSeriousCandidates(this);
 initializeDuplicateIndex(this);
 }
 close(){this.db.close();}
 get<T=unknown>(key:string):T|undefined {const row=this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as {value:string}|undefined;return row?JSON.parse(row.value):undefined;}
 set(key:string,value:unknown){if(key==='criteria'&&this.get('criteria'))this.homes();this.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));if(key==='criteria')this.homes();}
 get criteria():Criteria{return criteriaSchema.parse(this.get('criteria'));}
 event(message:string){this.db.prepare('INSERT INTO events(at,message) VALUES (?,?)').run(new Date().toISOString(),message);}
 events(){return this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 100').all();}
 transaction<T>(f:()=>T):T{const nested=this.transactionDepth>0,name=`af_savepoint_${this.transactionDepth}`;this.db.exec(nested?`SAVEPOINT ${name}`:'BEGIN IMMEDIATE');this.transactionDepth++;try{const r=f();this.db.exec(nested?`RELEASE SAVEPOINT ${name}`:'COMMIT');return r;}catch(e){this.db.exec(nested?`ROLLBACK TO SAVEPOINT ${name}`:'ROLLBACK');if(nested)this.db.exec(`RELEASE SAVEPOINT ${name}`);throw e;}finally{this.transactionDepth--;}}
 resolveHomeId(id:number){const seen=new Set<number>();let current=id;while(!seen.has(current)){seen.add(current);const alias=this.db.prepare('SELECT canonical FROM home_aliases WHERE alias=?').get(current) as {canonical:number}|undefined;if(!alias)return current;current=alias.canonical;}throw new Error('Apartment alias cycle');}
 aliases(id:number){return (this.db.prepare('SELECT alias FROM home_aliases WHERE canonical=? ORDER BY alias').all(this.resolveHomeId(id)) as {alias:number}[]).map(r=>r.alias);}
 postingDetails(id:number){return (this.db.prepare('SELECT source,source_id,listing,captured_at FROM posting_details WHERE home_id=? ORDER BY captured_at DESC').all(this.resolveHomeId(id)) as any[]).map(r=>({source:r.source,sourceId:r.source_id,listing:listingSchema.parse(JSON.parse(r.listing)),capturedAt:r.captured_at}));}
 ingest(input:Listing,options:{preservePhotos?:boolean}={}){let l=enrichListingContext(listingSchema.parse(input));const locationKey=verifiedLocationKey(l);l=applyVerifiedLocation(l,locationKey?this.get<VerifiedLocation>(locationKey):undefined);const raw=JSON.stringify(l),fingerprint=hash(raw);return this.transaction(()=>{
   const post=this.db.prepare('SELECT * FROM postings WHERE source=? AND source_id=?').get(l.source,l.sourceId) as any;
   if(post&&this.get(`duplicatePosting:${l.source}:${l.sourceId}`))return {id:this.resolveHomeId(post.home_id),changed:false};
   const now=new Date().toISOString();
   if(post?.fingerprint===fingerprint){this.db.prepare('INSERT INTO posting_details VALUES (?,?,?,?,?) ON CONFLICT(source,source_id) DO UPDATE SET captured_at=excluded.captured_at').run(l.source,l.sourceId,post.home_id,raw,now);return {id:this.resolveHomeId(post.home_id),changed:false};}
   let identity=unitIdentity(l);
   let row=post?this.db.prepare('SELECT * FROM homes WHERE id=?').get(post.home_id) as any:identity?this.db.prepare('SELECT * FROM homes WHERE identity=?').get(identity) as any:undefined;
   if(row&&this.resolveHomeId(row.id)!==row.id)row=this.db.prepare('SELECT * FROM homes WHERE id=?').get(this.resolveHomeId(row.id));
   if(row&&!post&&!compatibleUnit(listingSchema.parse(JSON.parse(row.listing)),l)){row=undefined;identity=null;l.conflicts.push('Same address/unit has conflicting identity facts; kept separate for review.');}
   const posting={source:l.source,sourceId:l.sourceId,url:l.url};let manifest=l;
   if(row){const prev=listingSchema.parse(JSON.parse(row.listing));
     // Keep the original posting manifest before adding another source.
     this.db.prepare('INSERT OR IGNORE INTO posting_details VALUES (?,?,?,?,?)').run(prev.source,prev.sourceId,row.id,row.listing,row.updated_at);
     const priorManifest=this.db.prepare('SELECT listing FROM posting_details WHERE source=? AND source_id=?').get(posting.source,posting.sourceId) as {listing:string}|undefined;
     if(options.preservePhotos&&priorManifest)manifest=reconcileListing(listingSchema.parse(JSON.parse(priorManifest.listing)),l,{preservePhotos:true});
     this.db.prepare('INSERT INTO posting_details VALUES (?,?,?,?,?) ON CONFLICT(source,source_id) DO UPDATE SET home_id=excluded.home_id,listing=excluded.listing,captured_at=excluded.captured_at').run(posting.source,posting.sourceId,row.id,JSON.stringify(manifest),now);
     const manifests=this.postingDetails(row.id).filter(p=>!this.get(`duplicatePosting:${p.source}:${p.sourceId}`)).map(p=>p.listing).sort((a,b)=>Number(b.source===prev.source&&b.sourceId===prev.sourceId)-Number(a.source===prev.source&&a.sourceId===prev.sourceId));
     const combined=manifests.slice(1).reduce((result,item)=>reconcileListing(result,item,{crossPosting:true}),manifests[0]);
     l=reconcileListing(prev,combined,{preservePhotos:options.preservePhotos});
     this.db.prepare('INSERT INTO history(home_id,at,event,before_json,after_json) VALUES (?,?,?,?,?)').run(row.id,now,'Listing updated',row.listing,JSON.stringify(l));
     this.db.prepare('UPDATE homes SET listing=?,updated_at=?,revision=revision+1 WHERE id=?').run(JSON.stringify(l),now,row.id);
   }else{l.photos=unionPhotos([],l.photos);const result=this.db.prepare('INSERT INTO homes(identity,listing,first_seen,updated_at) VALUES (?,?,?,?)').run(identity,JSON.stringify(l),now,now);row={id:Number(result.lastInsertRowid)};}
   this.db.prepare('INSERT INTO postings VALUES (?,?,?,?,?) ON CONFLICT(source,source_id) DO UPDATE SET home_id=excluded.home_id,url=excluded.url,fingerprint=excluded.fingerprint').run(posting.source,posting.sourceId,row.id,posting.url,fingerprint);
   this.db.prepare('INSERT INTO posting_details VALUES (?,?,?,?,?) ON CONFLICT(source,source_id) DO UPDATE SET home_id=excluded.home_id,listing=excluded.listing,captured_at=excluded.captured_at').run(posting.source,posting.sourceId,row.id,JSON.stringify(manifest),now);
   return {id:row.id as number,changed:true};
 });}
 private cached(row:any,criteria:Criteria,key:string){let cached=this.parsed.get(row.id);if(!cached||cached.raw!==row.listing){const listing=listingSchema.parse(JSON.parse(row.listing));cached={raw:row.listing,listing,criteria:key,score:scoreListing(listing,criteria,row.id)};this.parsed.set(row.id,cached);}else if(cached.criteria!==key){cached.score=scoreListing(cached.listing,criteria,row.id);cached.criteria=key;cached.quickRank=undefined;}return cached;}
 private materialize(row:any,criteria:Criteria,key:string,duplicates:number[],postings:Home['postings']){const cached=this.cached(row,criteria,key);const home:Home={id:row.id,listing:{...structuredClone(cached.listing),homeId:row.id},score:structuredClone(cached.score),stage:row.stage,notes:row.notes,followUp:row.follow_up,viewing:row.viewing,revision:row.revision,rescued:!!row.rescued,updatedAt:row.updated_at,firstSeen:row.first_seen,possibleDuplicates:duplicates,postings,aliases:this.aliases(row.id)};
  if(this.get<{mode:string}>('reviewWorkflow')?.mode==='quick-first'){
   // Local rank arithmetic need not repeat on every desk poll. Listing JSON and
   // criteria invalidate this cache, including changes saved by another worker.
   // Frozen ranks remain authoritative; returned ranks cannot mutate the cache.
   home.quickRank=this.get<Home['quickRank']>(`preservedQuickRank:${home.id}`)??structuredClone(cached.quickRank??=quickRank(home.listing,criteria,home.id));
   home.fullReview=this.get<Home['fullReview']>(`fullReview:${home.id}`);
   home.reviewMode=home.stage!=='Unreviewed'&&home.fullReview?.status==='complete'?'full':'quick';
  }
  home.listing=correctStudioBedrooms(home.listing);
  home.deskExclusion=searchAreaExclusion(this,home.listing,true)??bedroomIntakeExclusion(home.listing,criteria,home.id)??photoCollectionExclusion(home.listing);
  home.categoryEnteredAt=categoryEntry(this.db,home);return home;}
 homes():Home[]{
  const criteria=this.criteria,key=JSON.stringify(criteria),rows=this.db.prepare('SELECT * FROM homes WHERE id NOT IN (SELECT alias FROM home_aliases) ORDER BY id DESC').all() as any[];
  const groups=new Map<string,any[]>(),postings=new Map<number,Home['postings']>();
  for(const row of rows){const l=this.cached(row,criteria,key).listing,k=addressKey(l.address);if(k){const group=groups.get(k)??[];group.push(row);groups.set(k,group);}}
  for(const p of this.db.prepare('SELECT home_id,source,url FROM postings').all() as any[]){const group=postings.get(p.home_id)??[];group.push({source:p.source,url:p.url});postings.set(p.home_id,group);}
  const decisions=new Set((this.db.prepare('SELECT a,b FROM duplicate_decisions').all() as any[]).map(d=>`${d.a}:${d.b}`));
  return rows.map(row=>{const l=this.cached(row,criteria,key).listing;const duplicates=(groups.get(addressKey(l.address))??[]).filter(other=>{const o=this.cached(other,criteria,key).listing;return other.id!==row.id&&(!l.unit||!o.unit||l.unit===o.unit)&&!decisions.has(`${Math.min(row.id,other.id)}:${Math.max(row.id,other.id)}`);}).map(r=>r.id);return this.materialize(row,criteria,key,duplicates,postings.get(row.id)??[]);});
 }
 home(id:number){id=this.resolveHomeId(id);const row=this.db.prepare('SELECT * FROM homes WHERE id=?').get(id) as any;if(!row)return undefined;const criteria=this.criteria,key=JSON.stringify(criteria),l=this.cached(row,criteria,key).listing;const peers=l.address?this.db.prepare("SELECT id,listing FROM homes WHERE lower(trim(json_extract(listing,'$.address')))=? AND id!=? AND id NOT IN (SELECT alias FROM home_aliases)").all(addressKey(l.address),id) as any[]:[];const duplicates=peers.filter(o=>{const unit=JSON.parse(o.listing).unit;return (!l.unit||!unit||l.unit===unit)&&!this.db.prepare('SELECT 1 FROM duplicate_decisions WHERE a=? AND b=?').get(Math.min(id,o.id),Math.max(id,o.id));}).map(o=>o.id);return this.materialize(row,criteria,key,duplicates,this.db.prepare('SELECT source,url FROM postings WHERE home_id=?').all(id) as Home['postings']);}
 update(id:number,revision:number,changes:{stage:string;notes:string;followUp:string;viewing:string;rescued:boolean},reopen=false){id=this.resolveHomeId(id);return this.transaction(()=>{
  const prev=this.db.prepare('SELECT * FROM homes WHERE id=?').get(id) as any;if(!prev)throw new Error('Apartment not found');if(prev.revision!==revision)throw new Error('This apartment changed. Refresh before saving.');
  if(!(reopen&&stageGroup(prev.stage)==='Closed'&&changes.stage==='Unreviewed')&&!canTransition(prev.stage,changes.stage as Home['stage']))throw new Error('Move apartments through Unreviewed → Interested → Serious Candidates → Ready to Apply → In Progress without skipping or going backwards.');
  const workflow=this.get<{mode:string}>('reviewWorkflow')?.mode==='quick-first',review=this.get<Home['fullReview']>(`fullReview:${id}`),now=new Date().toISOString();
  if(['Serious Candidates','Ready to Apply'].includes(changes.stage)&&prev.stage!==changes.stage&&(workflow||review)&&review?.status!=='complete')throw new Error(`Wait for the full assessment before marking ${changes.stage}.`);
  if(['Interested','Serious Candidates','Ready to Apply'].includes(changes.stage)&&prev.stage!==changes.stage){
   const listing={...listingSchema.parse(JSON.parse(prev.listing)),homeId:id},failure=searchAreaExclusion(this,listing,true)??bedroomIntakeExclusion(listing,this.criteria,id)??photoCollectionExclusion(listing);if(failure)throw new Error(failure);
  }
  if(workflow&&changes.stage==='Interested'&&prev.stage!==changes.stage){
   const intake=quickRank(listingSchema.parse(JSON.parse(prev.listing)),this.criteria,id);if(!intake.eligible)throw new Error('This listing fails a hard intake requirement: '+intake.reasons.join('; '));
   if(review?.status!=='complete')this.set(`fullReview:${id}`,{status:'queued',detail:'Full assessment queued by your Interested decision.',updatedAt:now});
  }
  if(workflow&&stageGroup(changes.stage as Home['stage'])==='Closed'&&review&&['queued','running','paused'].includes(review.status)){
   if(review.planId)this.db.prepare("UPDATE plans SET state='cancelled' WHERE id=? AND state IN ('draft','approved','running')").run(review.planId);
   this.set(`fullReview:${id}`,{...review,status:'cancelled',detail:'Full assessment cancelled after your decision; completed evidence retained.',updatedAt:now});
  }
  const after={...changes};this.db.prepare('UPDATE homes SET stage=?,notes=?,follow_up=?,viewing=?,rescued=?,revision=revision+1 WHERE id=?').run(changes.stage,changes.notes,changes.followUp,changes.viewing,Number(changes.rescued),id);this.db.prepare('INSERT INTO history(home_id,at,event,before_json,after_json) VALUES (?,?,?,?,?)').run(id,now,'Decision saved',JSON.stringify({stage:prev.stage,notes:prev.notes,followUp:prev.follow_up,viewing:prev.viewing,rescued:!!prev.rescued}),JSON.stringify(after));return this.home(id);
 });}
 reopen(id:number,revision:number){const h=this.home(id);if(!h||stageGroup(h.stage)!=='Closed')throw new Error('Only closed apartments can be reopened');return this.update(id,revision,{stage:'Unreviewed',notes:h.notes,followUp:h.followUp,viewing:h.viewing,rescued:h.rescued},true);}
 undo(id:number){const row=this.db.prepare("SELECT * FROM history WHERE home_id=? AND event='Decision saved' ORDER BY id DESC LIMIT 1").get(id) as any;if(!row)throw new Error('No decision to undo');const before=JSON.parse(row.before_json),current=this.home(id)!;this.update(id,current.revision,before);this.db.prepare("UPDATE history SET event='Decision undone' WHERE id=? OR id=(SELECT max(id) FROM history WHERE home_id=?)").run(row.id,id);}
 mergeHistory(id:number){return this.db.prepare('SELECT id,at,keep_id,duplicate_id,split FROM home_merges WHERE keep_id=? OR duplicate_id=? ORDER BY id DESC').all(id,id);}
 mergeHomes(keepId:number,duplicateId:number,revisions?:{keep:number;duplicate:number},options:{preserveCanonical?:boolean}={}){
  return this.transaction(()=>{
   if(keepId===duplicateId||this.resolveHomeId(keepId)!==keepId||this.resolveHomeId(duplicateId)!==duplicateId)throw new Error('Choose two separate apartments');
   const keep=this.db.prepare('SELECT * FROM homes WHERE id=?').get(keepId) as any,duplicate=this.db.prepare('SELECT * FROM homes WHERE id=?').get(duplicateId) as any;
   if(!keep||!duplicate)throw new Error('Apartment not found');
   if(revisions&&(keep.revision!==revisions.keep||duplicate.revision!==revisions.duplicate))throw new Error('Apartment changed; refresh before merging');
   if(!options.preserveCanonical&&duplicate.stage!=='Unreviewed'&&duplicate.stage!==keep.stage)throw new Error('Different saved stages need reconciliation before merging; no decisions were changed');
   for(const key of ['follow_up','viewing'])if(keep[key]&&duplicate[key]&&keep[key]!==duplicate[key])throw new Error('Different saved dates need reconciliation before merging');
   const ratings=this.db.prepare('SELECT id,home_id FROM rating_feedback WHERE home_id IN (?,?)').all(keepId,duplicateId);
   const duplicatePostingMarkers=(this.db.prepare('SELECT source,source_id FROM postings WHERE home_id=?').all(duplicateId) as {source:string;source_id:string}[]).map(p=>({key:`duplicatePosting:${p.source}:${p.source_id}`,value:this.get(`duplicatePosting:${p.source}:${p.source_id}`)}));
   const snapshot={keep,duplicate,duplicatePostingMarkers,postings:this.db.prepare('SELECT * FROM postings WHERE home_id=?').all(duplicateId),details:this.db.prepare('SELECT * FROM posting_details WHERE home_id=?').all(duplicateId),aliases:this.aliases(duplicateId),ratings,ratingMax:(this.db.prepare('SELECT coalesce(max(id),0) AS n FROM rating_feedback').get() as any).n};
   const merged=options.preserveCanonical?JSON.parse(keep.listing):reconcileListing(listingSchema.parse(JSON.parse(keep.listing)),listingSchema.parse(JSON.parse(duplicate.listing)),{crossPosting:true});
   const notes=[keep.notes,duplicate.notes&&duplicate.notes!==keep.notes?`[Apartment #${duplicateId}]\n${duplicate.notes}`:''].filter(Boolean).join('\n\n');
   this.db.prepare('UPDATE homes SET listing=?,notes=?,follow_up=?,viewing=?,rescued=?,revision=revision+1 WHERE id=?').run(JSON.stringify(merged),notes,options.preserveCanonical?keep.follow_up:keep.follow_up||duplicate.follow_up,options.preserveCanonical?keep.viewing:keep.viewing||duplicate.viewing,options.preserveCanonical?keep.rescued:Number(!!keep.rescued||!!duplicate.rescued),keepId);
   for(const table of ['postings','posting_details','rating_feedback'])this.db.prepare(`UPDATE ${table} SET home_id=? WHERE home_id=?`).run(keepId,duplicateId);
   this.db.prepare('UPDATE home_aliases SET canonical=? WHERE canonical=?').run(keepId,duplicateId);
   this.db.prepare('INSERT INTO home_aliases VALUES (?,?)').run(duplicateId,keepId);
   const at=new Date().toISOString(),canonicalReview=this.get<Home['fullReview']>(`fullReview:${keepId}`);
   // Merged-away jobs no longer own a separate apartment. Stop their next budget
   // reservation immediately; a late result must not revive them through the alias.
   // Keep the canonical job and parallel siblings authorized exactly as before.
   for(const id of [duplicateId,...snapshot.aliases]){
    const review=this.get<Home['fullReview']>(`fullReview:${id}`);if(!review||review.status==='complete')continue;
    if(review.planId&&review.planId!==canonicalReview?.planId)this.db.prepare("UPDATE plans SET state='cancelled' WHERE id=? AND state IN ('draft','approved','running')").run(review.planId);
    this.set(`fullReview:${id}`,{...review,status:'cancelled',detail:`Full assessment cancelled after merging into apartment #${keepId}; completed evidence retained.`,updatedAt:at});
   }
   const result=this.db.prepare('INSERT INTO home_merges(at,keep_id,duplicate_id,snapshot,merged_revision) VALUES (?,?,?,?,?)').run(at,keepId,duplicateId,JSON.stringify(snapshot),keep.revision+1);
   this.db.prepare('INSERT INTO history(home_id,at,event,before_json,after_json) VALUES (?,?,?,?,?)').run(keepId,at,'Duplicate merged',JSON.stringify({duplicateId}),JSON.stringify({alias:duplicateId,canonical:keepId,mergeId:Number(result.lastInsertRowid)}));
   return {id:keepId,alias:duplicateId,mergeId:Number(result.lastInsertRowid)};
  });
 }
 splitMerge(mergeId:number){return this.transaction(()=>{
  const merge=this.db.prepare('SELECT * FROM home_merges WHERE id=?').get(mergeId) as any;if(!merge||merge.split)throw new Error('Active merge not found');const snapshot=JSON.parse(merge.snapshot),current=this.db.prepare('SELECT * FROM homes WHERE id=?').get(merge.keep_id) as any;
  if(current.revision!==merge.merged_revision||this.resolveHomeId(merge.keep_id)!==merge.keep_id||this.resolveHomeId(merge.duplicate_id)!==merge.keep_id)throw new Error('Apartment changed after merge; split needs manual reconciliation to preserve newer changes');
  if(this.db.prepare('SELECT 1 FROM rating_feedback WHERE home_id=? AND id>?').get(merge.keep_id,snapshot.ratingMax))throw new Error('New feedback was saved after merge; split needs reconciliation');
  const before=snapshot.keep;this.db.prepare('UPDATE homes SET listing=?,notes=?,follow_up=?,viewing=?,rescued=?,revision=revision+1 WHERE id=?').run(before.listing,before.notes,before.follow_up,before.viewing,before.rescued,merge.keep_id);
  for(const p of snapshot.postings)this.db.prepare('UPDATE postings SET home_id=? WHERE source=? AND source_id=?').run(merge.duplicate_id,p.source,p.source_id);
  for(const p of snapshot.details)this.db.prepare('UPDATE posting_details SET home_id=? WHERE source=? AND source_id=?').run(merge.duplicate_id,p.source,p.source_id);
  for(const p of snapshot.postings)if(this.get<{mergeId:number}>(`duplicatePosting:${p.source}:${p.source_id}`)?.mergeId===mergeId)this.db.prepare('DELETE FROM meta WHERE key=?').run(`duplicatePosting:${p.source}:${p.source_id}`);
  for(const marker of snapshot.duplicatePostingMarkers??[])if(marker.value!==undefined)this.set(marker.key,marker.value);
  for(const r of snapshot.ratings)this.db.prepare('UPDATE rating_feedback SET home_id=? WHERE id=?').run(r.home_id,r.id);
  this.db.prepare('DELETE FROM home_aliases WHERE alias=?').run(merge.duplicate_id);for(const alias of snapshot.aliases)this.db.prepare('UPDATE home_aliases SET canonical=? WHERE alias=?').run(merge.duplicate_id,alias);
  this.db.prepare('UPDATE home_merges SET split=1 WHERE id=?').run(mergeId);
  this.db.prepare('INSERT OR REPLACE INTO duplicate_decisions VALUES (?,?,?)').run(Math.min(merge.keep_id,merge.duplicate_id),Math.max(merge.keep_id,merge.duplicate_id),'different');
  this.event(`Split duplicate merge ${mergeId}; apartment references #${merge.keep_id} and #${merge.duplicate_id} retained.`);return {ids:[merge.keep_id,merge.duplicate_id]};
 });}
 health(){return this.db.prepare('SELECT * FROM source_health').all() as any[];}
 pause(source:string,reason:string,attention=false,until=Date.now()+86400000){this.db.prepare('INSERT INTO source_health(source,paused_until,reason,needs_attention) VALUES (?,?,?,?) ON CONFLICT(source) DO UPDATE SET paused_until=excluded.paused_until,reason=excluded.reason,needs_attention=excluded.needs_attention').run(source,new Date(until).toISOString(),reason,Number(attention));this.event(`${source} paused: ${reason}`);}
 checkSource(source:string){const row=this.health().find(s=>s.source===source);if(row&&(row.needs_attention||Date.parse(row.paused_until)>Date.now()))throw new Error(`${source} is paused: ${row.reason}`);}
 async backupTo(path:string){mkdirSync(dirname(path),{recursive:true});await backup(this.db,path);}
}
