import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {criteriaSchema,listingSchema,type Criteria,type Listing,type Home} from '../src/domain.ts';
import {scoreListing} from './scoring.ts';
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export class Store {
 db:DatabaseSync;
 constructor(public path:string){if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS homes(id INTEGER PRIMARY KEY AUTOINCREMENT, identity TEXT UNIQUE, listing TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'Unreviewed',notes TEXT NOT NULL DEFAULT '',follow_up TEXT NOT NULL DEFAULT '',viewing TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,rescued INTEGER NOT NULL DEFAULT 0,first_seen TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS postings(source TEXT,source_id TEXT,home_id INTEGER REFERENCES homes(id),url TEXT,fingerprint TEXT,PRIMARY KEY(source,source_id));
 CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY,home_id INTEGER,at TEXT,event TEXT,before_json TEXT,after_json TEXT);
 CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,at TEXT,message TEXT);
 CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,caps TEXT,state TEXT,created_at TEXT,expires_at TEXT,usage TEXT,detail TEXT);
 CREATE TABLE IF NOT EXISTS source_health(source TEXT PRIMARY KEY,paused_until TEXT,reason TEXT,needs_attention INTEGER DEFAULT 0,last_success TEXT);
 CREATE TABLE IF NOT EXISTS seen(source TEXT,url TEXT,checked_at TEXT,PRIMARY KEY(source,url));
 CREATE TABLE IF NOT EXISTS photo_cache(hash TEXT,version TEXT,result TEXT,PRIMARY KEY(hash,version));
 CREATE TABLE IF NOT EXISTS scan_lock(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT,heartbeat TEXT);
 CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY,source TEXT,at TEXT,kind TEXT);
 CREATE TABLE IF NOT EXISTS duplicate_decisions(a INTEGER,b INTEGER,decision TEXT,PRIMARY KEY(a,b));
 PRAGMA user_version=1;`);
 if(!this.get('criteria'))this.set('criteria',criteriaSchema.parse({}));
 }
 close(){this.db.close();}
 get<T=unknown>(key:string):T|undefined {const row=this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as {value:string}|undefined;return row?JSON.parse(row.value):undefined;}
 set(key:string,value:unknown){this.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
 get criteria():Criteria{return criteriaSchema.parse(this.get('criteria'));}
 event(message:string){this.db.prepare('INSERT INTO events(at,message) VALUES (?,?)').run(new Date().toISOString(),message);}
 events(){return this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 100').all();}
 transaction<T>(f:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const r=f();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 ingest(input:Listing){const l=listingSchema.parse(input);const fingerprint=hash(JSON.stringify(l));return this.transaction(()=>{
   const post=this.db.prepare('SELECT * FROM postings WHERE source=? AND source_id=?').get(l.source,l.sourceId) as any;
   if(post?.fingerprint===fingerprint)return {id:post.home_id,changed:false};
   const identity=l.unit&&l.address?hash(`${l.address.toLowerCase().replace(/[^a-z0-9]/g,'')}|${l.unit.toLowerCase()}`):null;
   let row=post?this.db.prepare('SELECT * FROM homes WHERE id=?').get(post.home_id) as any:identity?this.db.prepare('SELECT * FROM homes WHERE identity=?').get(identity) as any:undefined;
   const now=new Date().toISOString();
   if(row){const prev=listingSchema.parse(JSON.parse(row.listing));
     l.photos=l.photos.map(p=>{const old=prev.photos.find(o=>o.url===p.url);return old??p;});
     if(prev.source!==l.source){
       l.photos=[...prev.photos,...l.photos.filter(p=>!prev.photos.some(o=>o.url===p.url))];
       for(const key of ['rent','beds','laundry','parking','lease','sqft'] as const)if(prev[key]!==l[key])l.conflicts.push(`${key}: ${prev.source} says ${prev[key]}; ${l.source} says ${l[key]}`);
       if(prev.laundry!==l.laundry)l.laundry='unknown';
       l.galleryComplete=false;
     }
     this.db.prepare('INSERT INTO history(home_id,at,event,before_json,after_json) VALUES (?,?,?,?,?)').run(row.id,now,'Listing updated',row.listing,JSON.stringify(l));
     this.db.prepare('UPDATE homes SET listing=?,updated_at=?,revision=revision+1 WHERE id=?').run(JSON.stringify(l),now,row.id);
   }else{const result=this.db.prepare('INSERT INTO homes(identity,listing,first_seen,updated_at) VALUES (?,?,?,?)').run(identity,JSON.stringify(l),now,now);row={id:Number(result.lastInsertRowid)};}
   this.db.prepare('INSERT INTO postings VALUES (?,?,?,?,?) ON CONFLICT(source,source_id) DO UPDATE SET home_id=excluded.home_id,url=excluded.url,fingerprint=excluded.fingerprint').run(l.source,l.sourceId,row.id,l.url,fingerprint);
   return {id:row.id as number,changed:true};
 });}
 homes():Home[]{const criteria=this.criteria;const rows=this.db.prepare('SELECT * FROM homes ORDER BY id DESC').all() as any[];return rows.map(r=>{const listing=listingSchema.parse(JSON.parse(r.listing));return {id:r.id,listing,score:scoreListing(listing,criteria),stage:r.stage,notes:r.notes,followUp:r.follow_up,viewing:r.viewing,revision:r.revision,rescued:!!r.rescued,updatedAt:r.updated_at,firstSeen:r.first_seen,possibleDuplicates:rows.filter(other=>other.id!==r.id&&!!listing.address&&JSON.parse(other.listing).address===listing.address&&(!listing.unit||!JSON.parse(other.listing).unit||listing.unit===JSON.parse(other.listing).unit)&&!this.db.prepare('SELECT 1 FROM duplicate_decisions WHERE a=? AND b=?').get(Math.min(r.id,other.id),Math.max(r.id,other.id))).map(other=>other.id),postings:this.db.prepare('SELECT source,url FROM postings WHERE home_id=?').all(r.id) as any};});}
 home(id:number){return this.homes().find(h=>h.id===id);}
 update(id:number,revision:number,changes:{stage:string;notes:string;followUp:string;viewing:string;rescued:boolean}){return this.transaction(()=>{const prev=this.db.prepare('SELECT * FROM homes WHERE id=?').get(id) as any;if(!prev)throw new Error('Apartment not found');if(prev.revision!==revision)throw new Error('This apartment changed. Refresh before saving.');const after={...changes};this.db.prepare('UPDATE homes SET stage=?,notes=?,follow_up=?,viewing=?,rescued=?,revision=revision+1 WHERE id=?').run(changes.stage,changes.notes,changes.followUp,changes.viewing,Number(changes.rescued),id);this.db.prepare('INSERT INTO history(home_id,at,event,before_json,after_json) VALUES (?,?,?,?,?)').run(id,new Date().toISOString(),'Decision saved',JSON.stringify({stage:prev.stage,notes:prev.notes,followUp:prev.follow_up,viewing:prev.viewing,rescued:!!prev.rescued}),JSON.stringify(after));return this.home(id);});}
 undo(id:number){const row=this.db.prepare("SELECT * FROM history WHERE home_id=? AND event='Decision saved' ORDER BY id DESC LIMIT 1").get(id) as any;if(!row)throw new Error('No decision to undo');const before=JSON.parse(row.before_json),current=this.home(id)!;this.update(id,current.revision,before);this.db.prepare("UPDATE history SET event='Decision undone' WHERE id=? OR id=(SELECT max(id) FROM history WHERE home_id=?)").run(row.id,id);}
 health(){return this.db.prepare('SELECT * FROM source_health').all() as any[];}
 pause(source:string,reason:string,attention=false,until=Date.now()+86400000){this.db.prepare('INSERT INTO source_health(source,paused_until,reason,needs_attention) VALUES (?,?,?,?) ON CONFLICT(source) DO UPDATE SET paused_until=excluded.paused_until,reason=excluded.reason,needs_attention=excluded.needs_attention').run(source,new Date(until).toISOString(),reason,Number(attention));this.event(`${source} paused: ${reason}`);}
 checkSource(source:string){const row=this.health().find(s=>s.source===source);if(row&&(row.needs_attention||Date.parse(row.paused_until)>Date.now()))throw new Error(`${source} is paused: ${row.reason}`);}
 async backupTo(path:string){mkdirSync(dirname(path),{recursive:true});await backup(this.db,path);}
}
