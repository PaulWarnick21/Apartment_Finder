import {createHash} from 'node:crypto';
import type {Store} from './db.ts';
import {listingSchema,type Listing,type Photo} from '../src/domain.ts';
import {compatibleUnit} from './listing-integrity.ts';
import type {DiscoveryQueue} from './discovery-queue.ts';

function forgetQueuedPosting(store:Store,source:string,sourceId:string){
 const queue=store.get<DiscoveryQueue>(`discoveryQueue:${source}`),post=store.db.prepare('SELECT url FROM postings WHERE source=? AND source_id=?').get(source,sourceId) as {url:string}|undefined;
 if(!queue||!post)return;
 queue.urls=queue.urls.filter(url=>url!==post.url);if(queue.offerings)queue.offerings=queue.offerings.filter(l=>l.source!==source||l.sourceId!==sourceId);if(queue.cards)delete queue.cards[post.url];store.set(`discoveryQueue:${source}`,queue);
}

function address(l:Listing){
 const cleanUnit=(value:string)=>{const key=value.toLowerCase().replace(/^(?:unit|suite|apt|#)\s*/,'').replace(/[^a-z0-9]/g,'');return /^(?:unknown|notprovided|na|none|studio)$/.test(key)?'':key;};
 let text=l.address.toLowerCase().replace(/\s+google\s+maps?[\s\S]*$/i,'').trim(),unit=cleanUnit(l.unit),conflict=false;
 const acceptUnit=(value:string)=>{const key=cleanUnit(value);if(unit&&key&&unit!==key)conflict=true;unit||=key;};
 const prefix=text.match(/^#?(\d+[a-z]?)\s*[-–]\s*(?=\d+\s)/);if(prefix){acceptUnit(prefix[1]);text=text.slice(prefix[0].length);}
 const suffix=text.match(/(?:\b(?:unit|suite|apt|apartment)\s*#?\s*|#)([a-z0-9-]+)/);if(suffix){acceptUnit(suffix[1]);text=text.replace(suffix[0],'');}
 const city=text.match(/\b(north vancouver|west vancouver|vancouver|burnaby|richmond|surrey|coquitlam|new westminster|port moody)\b/)?.[1];
 text=text.split(/,|\n/)[0].replace(/\b(north vancouver|west vancouver|vancouver|burnaby|richmond|surrey|coquitlam|new westminster|port moody)\b[\s\S]*$/,'').replace(/\b(bc|british columbia)\b[\s\S]*$/,'');
 text=text.replace(/\b(street|avenue|road|boulevard|drive|place|crescent|west|east|north|south)\b/g,w=>({street:'st',avenue:'ave',road:'rd',boulevard:'blvd',drive:'dr',place:'pl',crescent:'cres',west:'w',east:'e',north:'n',south:'s'}[w]!)).replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
 const type=text.match(/\b(st|ave|rd|blvd|dr|pl|cres)\b/)?.[1],street=text.replace(/\b(st|ave|rd|blvd|dr|pl|cres)\b/g,'').replace(/\s+/g,' ').trim();
 return {street:/^\d+[a-z]?\s+\S/.test(street)?street:'',unit,city,type,conflict};
}
function photoKeys(p:Photo){return [...new Set([p.hash&&`hash:${p.hash}`,p.sourceLocal&&`original:${p.sourceLocal}`,p.url&&`url:${p.url}`,p.sourceUrl&&`url:${p.sourceUrl}`].filter((key):key is string=>!!key))];}
function photos(l:Listing){return l.photos.filter(p=>!['amenity','exterior','floorplan'].includes(p.kind)&&!p.attributionPending&&!/representative|model (?:suite|unit)|similar (?:suite|unit)|stock photo/i.test(p.note));}
export function duplicateEvidence(a:Listing,b:Listing){
 if(a.offeringKind!=='unit'||b.offeringKind!=='unit'||!compatibleUnit(a,b))return;
 const x=address(a),y=address(b);if(x.conflict||y.conflict||x.unit&&y.unit&&x.unit!==y.unit||x.city&&y.city&&x.city!==y.city||x.type&&y.type&&x.type!==y.type)return;
 const sameAddress=!!x.street&&x.street===y.street;
 if(x.street&&y.street&&!sameAddress)return;
 if(sameAddress&&x.unit&&x.unit===y.unit)return 'Same normalized street address and explicit unit, with compatible rental facts';
 if(/representative|model (?:suite|unit)|similar (?:suite|unit)/i.test([a.evidence.photoProvenance,b.evidence.photoProvenance].join(' ')))return;
 const ap=photos(a),bp=photos(b),bkeys=new Set(bp.flatMap(photoKeys)),matched=ap.filter(p=>photoKeys(p).some(key=>bkeys.has(key)));
 // Count unique images, not repeated gallery slots or multiple URL/hash keys.
 const unique=(ps:Photo[])=>new Set(ps.map(p=>p.hash??p.sourceLocal??p.sourceUrl??p.url)).size;
 const count=unique(matched),coverage=count/Math.max(1,unique(ap),unique(bp));
 const attributed=(p:Photo)=>p.kind==='interior'&&p.unitCertain&&!/(?:provenance|exact.unit)[^.]*\b(?:not|uncertain|unverified)\b|not[^.]*establish[^.]*exact.unit/i.test(p.note);
 const interiors=unique(matched.filter(p=>bp.some(q=>photoKeys(p).some(key=>photoKeys(q).includes(key))&&(attributed(p)||attributed(q)))));
 if(sameAddress&&count>=4&&coverage>=.8&&interiors>=2)return `Same normalized address and ${count} matching apartment photos (${Math.round(coverage*100)}% gallery overlap)`;
 if(!x.street&&!y.street&&interiors>=4&&coverage>=.8)return `${interiors} matching reviewed, unit-attributed interior photos (${Math.round(coverage*100)}% gallery overlap)`;
}
export function initializeDuplicateIndex(store:Store){
 store.db.exec(`CREATE TABLE IF NOT EXISTS duplicate_keys(home_id INTEGER NOT NULL, key TEXT NOT NULL, PRIMARY KEY(home_id,key));
 CREATE INDEX IF NOT EXISTS duplicate_key_lookup ON duplicate_keys(key,home_id);
 CREATE INDEX IF NOT EXISTS postings_source_url ON postings(source,url);
 CREATE TABLE IF NOT EXISTS duplicate_index_dirty(home_id INTEGER PRIMARY KEY);
 CREATE TRIGGER IF NOT EXISTS duplicate_index_insert AFTER INSERT ON homes BEGIN INSERT OR IGNORE INTO duplicate_index_dirty VALUES (NEW.id); END;
 CREATE TRIGGER IF NOT EXISTS duplicate_index_update AFTER UPDATE OF listing ON homes BEGIN INSERT OR IGNORE INTO duplicate_index_dirty VALUES (NEW.id); END;`);
 if(!store.get('duplicateIndexV1'))store.transaction(()=>{store.db.exec('INSERT OR IGNORE INTO duplicate_index_dirty SELECT id FROM homes');store.set('duplicateIndexV1',true);});
}
function keys(l:Listing){const a=address(l);return [...new Set([...(a.street?[`address:${a.street}`]:[]),...photos(l).flatMap(photoKeys)])];}
export function refreshDuplicateIndex(store:Store){
 store.transaction(()=>{
  const rows=store.db.prepare('SELECT h.id,h.listing FROM homes h JOIN duplicate_index_dirty d ON d.home_id=h.id').all() as {id:number;listing:string}[];
  const remove=store.db.prepare('DELETE FROM duplicate_keys WHERE home_id=?'),insert=store.db.prepare('INSERT OR IGNORE INTO duplicate_keys VALUES (?,?)');
  for(const row of rows){remove.run(row.id);for(const key of keys(listingSchema.parse(JSON.parse(row.listing))))insert.run(row.id,key);store.db.prepare('DELETE FROM duplicate_index_dirty WHERE home_id=?').run(row.id);}
 });
}
export function findDuplicate(store:Store,listing:Listing,homeId?:number,excluded=new Set<number>()){
 refreshDuplicateIndex(store);const tokens=keys(listing);if(!tokens.length)return;
 const rows=store.db.prepare(`SELECT DISTINCT h.id,h.listing,h.first_seen FROM duplicate_keys k JOIN homes h ON h.id=k.home_id WHERE k.key IN (${tokens.map(()=>'?').join(',')}) AND h.id NOT IN (SELECT alias FROM home_aliases) ORDER BY h.first_seen,h.id`).all(...tokens) as {id:number;listing:string;first_seen:string}[];
 for(const row of rows){
  if(row.id===homeId||excluded.has(row.id))continue;
  if(homeId!==undefined){const left=[homeId,...store.aliases(homeId)],right=[row.id,...store.aliases(row.id)];if(left.some(a=>right.some(b=>store.db.prepare("SELECT 1 FROM duplicate_decisions WHERE a=? AND b=? AND decision='different'").get(Math.min(a,b),Math.max(a,b)))))continue;}
  const evidence=duplicateEvidence(listing,listingSchema.parse(JSON.parse(row.listing)));if(evidence)return {...row,evidence};
 }
}
/** Reversible alias, never a deletion; source IDs/URLs remain attached to the older home. */
export function deduplicateHome(store:Store,id:number,excluded=new Set<number>()):{olderId:number;newerId:number;evidence:string}|undefined{
 return store.transaction(()=>{
  id=store.resolveHomeId(id);const target=store.db.prepare('SELECT id,listing,first_seen FROM homes WHERE id=?').get(id) as {id:number;listing:string;first_seen:string}|undefined;if(!target)return;
  const match=findDuplicate(store,listingSchema.parse(JSON.parse(target.listing)),id,excluded);if(!match)return;
  const older=target.first_seen<match.first_seen||target.first_seen===match.first_seen&&id<match.id?id:match.id,newer=older===id?match.id:id;
  // A separate user rating or incompatible scheduled dates needs explicit reconciliation.
  const skip=()=>{excluded.add(match.id);return deduplicateHome(store,id,excluded);};
  if(store.db.prepare('SELECT 1 FROM rating_feedback WHERE home_id=?').get(newer))return skip();
  const rows=store.db.prepare('SELECT id,revision,follow_up,viewing FROM homes WHERE id IN (?,?)').all(older,newer) as {id:number;revision:number;follow_up:string;viewing:string}[];
  const keep=rows.find(row=>row.id===older)!,drop=rows.find(row=>row.id===newer)!;
  if(['follow_up','viewing'].some(key=>keep[key as 'viewing']&&drop[key as 'viewing']&&keep[key as 'viewing']!==drop[key as 'viewing']))return skip();
  const postings=store.db.prepare('SELECT source,source_id FROM postings WHERE home_id=?').all(newer) as {source:string;source_id:string}[];
  const result=store.mergeHomes(older,newer,{keep:keep.revision,duplicate:drop.revision},{preserveCanonical:true});
  for(const posting of postings){store.set(`duplicatePosting:${posting.source}:${posting.source_id}`,{homeId:older,mergeId:result.mergeId,evidence:match.evidence});forgetQueuedPosting(store,posting.source,posting.source_id);}
  store.set(`automaticDuplicate:${newer}`,{olderId:older,mergeId:result.mergeId,evidence:match.evidence,at:new Date().toISOString()});
  store.event(`Duplicate apartment #${newer} folded into older #${older}: ${match.evidence}. Older decision and assessment retained.`);
  return {olderId:older,newerId:newer,evidence:match.evidence};
 });
}
/** Remember a new cross-post without changing the older home or collecting its gallery. */
export function rememberDuplicatePosting(store:Store,listing:Listing){
 if(store.db.prepare('SELECT 1 FROM postings WHERE source=? AND source_id=?').get(listing.source,listing.sourceId))return;
 return store.transaction(()=>{
  const match=findDuplicate(store,listing);if(!match)return;
  const raw=JSON.stringify(listing),at=new Date().toISOString();
  store.db.prepare('INSERT INTO postings VALUES (?,?,?,?,?)').run(listing.source,listing.sourceId,match.id,listing.url,createHash('sha256').update(raw).digest('hex'));
  store.db.prepare('INSERT INTO posting_details VALUES (?,?,?,?,?)').run(listing.source,listing.sourceId,match.id,raw,at);
  store.set(`duplicatePosting:${listing.source}:${listing.sourceId}`,{homeId:match.id,evidence:match.evidence,at});
  forgetQueuedPosting(store,listing.source,listing.sourceId);
  return match.id;
 });
}
