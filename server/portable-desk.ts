import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {isIP} from 'node:net';
import {gzipSync,gunzipSync} from 'node:zlib';
import {z} from 'zod';
import {criteriaSchema,listingSchema,type FullReviewState,type Listing} from '../src/domain.ts';
import {Store} from './db.ts';
import {learningVersion} from './local-upgrades.ts';
import {scoreListing} from './scoring.ts';
import {allowedUrl,sources} from './sources.ts';
import type {SearchAreaPolicy} from './search-area.ts';

// The public export has its own explicit schema. It must never copy the runtime DB.
const columns={
 homes:'id identity listing stage notes follow_up viewing revision rescued first_seen updated_at revisit_later tag_long_term_lease tag_unfurnished',
 desk_membership:'home_id category entered_at',
 postings:'source source_id home_id url fingerprint',
 posting_details:'source source_id home_id listing captured_at',
 history:'id home_id at event before_json after_json',
 duplicate_decisions:'a b decision',
 home_aliases:'alias canonical',
 home_merges:'id at keep_id duplicate_id snapshot merged_revision split',
 rating_feedback:'id request_id home_id at user_score reason listing_json score_json criteria_json status review_json error origin',
 calibration_changes:'id feedback_id at before_json after_json reverted',
} as const;
type Table=keyof typeof columns;
type Cell=string|number|null;
type Row=Record<string,Cell>;
const tables=Object.keys(columns) as Table[];
const keys=(table:Table)=>columns[table].split(' ');
const selectedMeta=new Set(['criteria','buildingDesk','reviewWorkflow','processingPolicy','areaMixPolicy','searchAreaPolicy','fullReviewPolicy','fullViewRelaxationV1']);
const localMeta=/^(?:preservedQuickRank|fullReview):[1-9]\d*$|^verifiedLocation:[a-f0-9]{64}$|^duplicatePosting:[a-z]+:[\w.-]+$|^areaMixAdmissions:[\dT:.Z-]+$/;
const searchQueryKeys=new Set(['cat','min_bedrooms','max_bedrooms','neighbourhood','_city','exact','lat','lng','city']);
const maxCompressedBytes=5*1024*1024,maxExpandedBytes=48*1024*1024;
const reviewBudget=z.object({stopAt:z.number().positive().max(100),maxPages:z.number().int().positive(),maxPhotos:z.number().int().positive(),maxAiCalls:z.number().int().positive(),maxPublicResearchRequests:z.number().int().nonnegative().optional()});
const format='apartment-finder-portable-desk';
const cellSchema=z.union([z.string(),z.number(),z.null()]);
const envelope=z.object({format:z.literal(format),version:z.literal(1),createdAt:z.string().datetime(),meta:z.record(z.string(),z.unknown()),tables:z.record(z.string(),z.array(z.record(z.string(),cellSchema)))}).strict();
type Snapshot=z.infer<typeof envelope>;

function cleanUrl(input:string,searchRoute=false):string|undefined{
 try{
  const url=new URL(input);
  if(url.protocol!=='https:'&&url.protocol!=='http:')return;
  if(url.username||url.password||url.port||!url.hostname.includes('.')||isIP(url.hostname)||
   /\.(?:local|internal|localhost|ts\.net)$/i.test(url.hostname))return;
  if(/\.(?:avif|gif|jpe?g|png|webp)$/i.test(url.pathname)||/^(?:images\d*\.apartments\.com|photos\.zillowstatic\.com|images\.craigslist\.org|assets-listings\.rew\.ca|img\.zumpercdn\.com|media\.kijiji\.ca)$|\.fbcdn\.net$/i.test(url.hostname))return;
  url.hash='';
  for(const name of [...url.searchParams.keys()]){
   if(!searchRoute||!searchQueryKeys.has(name)||!url.searchParams.getAll(name).every(v=>/^[\w .-]{1,80}$/.test(v)))url.searchParams.delete(name);
  }
  return url.href;
 }catch{return;}
}

function cleanText(text:string):string{
 return text
  .replace(/\b[A-Z]:[\\/]Users[\\/][^\r\n"'<>|]+|\bfile:\/\/\S+/gi,'[local path removed]')
  .split(/(https?:\/\/[^\s<>"']+)/gi)
  .map(part=>/^https?:\/\//i.test(part)?cleanUrl(part)??'[private link removed]':cleanContactText(part))
  .join('');
}

function cleanContactText(text:string){
 return text
  .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email removed]')
  .replace(/(?<![\d-])(?:\+?1[\s.-]*)?(?:\(\d{3}\)[\s.-]*|\d{3}[\s.-]+)\d{3}[\s.-]+\d{4}(?!\d)|(?<![\d.-])\+?[2-9]\d{9}(?![\d.-])/g,'[phone removed]')
  .replace(/\b(?:bearer\s+|(?:password|passcode|access[-_ ]?token|refresh[-_ ]?token|api[-_ ]?key|door[-_ ]?code|alarm[-_ ]?code)\s*[=:]\s*)[\w.+/=-]+/gi,'[credential removed]')
  .replace(/\b(?:sk-[\w-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[\w]{20,})\b/g,'[credential removed]');
}

const identifierKeys=new Set(['source_id','sourceId','request_id','offeringId','identity']);
function cleanIdentifier(value:string){
 if(!/^[\w.:-]{0,200}$/.test(value))throw Error('Portable desk contains an unsupported public identifier.');
 return value;
}

function cleanListing(input:unknown):Listing{
 const listing=listingSchema.parse(input);
 const reviewed=listing.photos.filter(photo=>photo.status==='reviewed');
 const nativeUrl=cleanUrl(listing.url)??'https://invalid.example/archived-posting';
 const parsed=cleanRecord({...listing,description:'',photos:[],galleryComplete:false,allOutlooksCovered:false,
  url:nativeUrl,parentListingUrl:listing.parentListingUrl&&cleanUrl(listing.parentListingUrl),
  research:listing.research.flatMap(item=>{const url=cleanUrl(item.url);return url?[{...item,url}]:[];}),
 },true) as Listing;
 if(listing.photos.length){
  const view=reviewed.filter(photo=>photo.kind==='interior'&&photo.unitCertain&&photo.scenery==='nature');
  const outlook=view.length?' An earlier review found an actual-unit nature outlook.':'';
  parsed.evidence.archivedGallery=`Earlier review assessed ${reviewed.length} of ${listing.expectedPhotos??listing.photos.length} known photos.${outlook} Recollect the current gallery before using this evidence for a new decision.`;
 }
 return parsed;
}

function cleanData(input:unknown):unknown{
 if(typeof input==='string')return cleanText(input);
 if(!input||typeof input!=='object')return input;
 if(Array.isArray(input))return input.map(cleanData);
 const value=input as Record<string,unknown>;
 if(typeof value.source==='string'&&typeof value.sourceId==='string'&&typeof value.url==='string'&&typeof value.title==='string'&&Object.hasOwn(value,'rent')){
  return cleanListing(value);
 }
 return cleanRecord(value);
}

function cleanRecord(value:Record<string,unknown>,listing=false){
 const result:Record<string,unknown>=Object.create(null);
 for(const [key,part] of Object.entries(value)){
  if(/^(?:accountId|profileId|authorization|headers|cookie|token|tokenHash|apiKey|password|secret|rawPage|bodyHtml|local|sourceLocal|sourceUrl)$/i.test(key))continue;
  if(typeof part==='string'&&(key==='listing'||key==='listing_json'))result[key]=JSON.stringify(cleanListing(JSON.parse(part)));
  else if(typeof part==='string'&&(identifierKeys.has(key)||listing&&key==='source'))result[key]=cleanIdentifier(part);
  else result[key]=cleanData(part);
 }
 return result;
}

function cleanRow(table:Table,raw:Row,criteria?:ReturnType<typeof criteriaSchema.parse>):Row{
 const row:Row={};
 for(const key of keys(table)){
  const value=raw[key];
  if(value===undefined)throw Error(`Portable desk row is missing ${table}.${key}`);
  if(typeof value!=='string'){row[key]=value;continue;}
  if(key==='listing'||key==='listing_json'){
   const original=listingSchema.parse(JSON.parse(value)),listing=cleanListing(original);
   if(table==='homes'&&criteria&&!listing.evidence.archivedScore){
    const score=scoreListing(original,criteria,Number(raw.id));
    listing.evidence.archivedScore=`Historical fit score: ${score.value.toFixed(1)} / 5. ${score.view}. Verify current listing facts and photos before relying on this assessment.`;
   }
   if(!criteria&&(table==='homes'||table==='posting_details')){
    if(listing.available!=='Unknown')listing.evidence.archivedAvailability=listing.available;
    listing.available='Unknown';
   }
   row[key]=JSON.stringify(listing);
  }else if(key==='criteria_json'||table==='calibration_changes'&&key.endsWith('_json')){
   row[key]=JSON.stringify(cleanData(criteriaSchema.parse(JSON.parse(value))));
  }else if(key.endsWith('_json')||key==='snapshot'){
   row[key]=JSON.stringify(cleanData(JSON.parse(value)));
  }else if(key==='url'){
   row[key]=cleanUrl(value)??'https://invalid.example/archived-posting';
  }else if(key==='error'||key==='fingerprint'){
   row[key]=''; // Operational provider errors and fingerprints are unnecessary.
  }else row[key]=identifierKeys.has(key)||key==='source'?cleanIdentifier(value):cleanText(value);
 }
 if(table==='rating_feedback'&&row.status==='reviewing')row.status='pending';
 return row;
}

function cleanMeta(key:string,value:unknown):unknown{
 if(key==='criteria')return cleanData(criteriaSchema.parse(value));
 if(key==='fullReviewPolicy')return reviewBudget.parse(value);
 if(key==='searchAreaPolicy'){
  const {sourceRoutes,...policy}=value as SearchAreaPolicy;
  return {...cleanData(policy) as object,sourceRoutes:sourceRoutes&&Object.fromEntries(sources.flatMap(source=>{
   const routes=sourceRoutes[source.id];
   return routes?[[source.id,routes.flatMap(route=>{
    const url=cleanUrl(route.url,true);
    return url&&allowedUrl(url,source.hosts)?[{region:route.region,scope:route.scope,url}]:[];
   })]]:[];
  }))};
 }
 if(key.startsWith('fullReview:')){
  const review=value as FullReviewState&{archivedStatus?:FullReviewState['status']};
  const archivedStatus=review.archivedStatus??review.status;
  if(!['queued','running','paused','failed','complete','cancelled'].includes(archivedStatus))throw Error('Invalid archived review status.');
  return {status:'paused',archivedStatus,updatedAt:cleanText(review.updatedAt),detail:`Saved review was ${archivedStatus}. Verify the current listing and recollect its photos before relying on earlier scoring.`};
 }
 return cleanData(value);
}

export function writePortableDesk(database:string){
 const db=new DatabaseSync(database,{readOnly:true});
 try{
  db.exec('BEGIN');
  const snapshot:Snapshot={format,version:1,createdAt:new Date().toISOString(),tables:{},meta:{}};
  const criteriaRow=db.prepare("SELECT value FROM meta WHERE key='criteria'").get() as {value:string}|undefined;
  const criteria=criteriaSchema.parse(JSON.parse(criteriaRow?.value??'{}'));
  for(const table of tables){
   snapshot.tables[table]=[];
   for(const row of db.prepare(`SELECT ${keys(table).join(',')} FROM ${table} ORDER BY rowid`).iterate()){
    snapshot.tables[table].push(cleanRow(table,row as Row,criteria));
   }
  }
  for(const {key,value} of db.prepare('SELECT key,value FROM meta ORDER BY key').iterate() as Iterable<{key:string;value:string}>){
   if(selectedMeta.has(key)||localMeta.test(key))snapshot.meta[key]=cleanMeta(key,JSON.parse(value));
  }
  db.exec('COMMIT');
  const expanded=Buffer.from(JSON.stringify(snapshot));
  if(expanded.length>maxExpandedBytes)throw Error('Portable desk exceeds the uncompressed size limit.');
  const bytes=gzipSync(expanded);
  if(bytes.length>maxCompressedBytes)throw Error('Portable desk exceeds the GitHub backup size limit (5 MiB).');
  return {bytes,homes:snapshot.tables.homes.length,history:snapshot.tables.history.length};
 }finally{db.close();}
}

export function readPortableDesk(bytes:Buffer){
 if(bytes.length>maxCompressedBytes)throw Error('Portable desk exceeds the size limit.');
 const snapshot=envelope.parse(JSON.parse(gunzipSync(bytes,{maxOutputLength:maxExpandedBytes}).toString('utf8')));
 if(Object.keys(snapshot.tables).length!==tables.length||tables.some(table=>!snapshot.tables[table]))throw Error('Unexpected portable desk table set.');
 if(Object.keys(snapshot.meta).some(key=>!selectedMeta.has(key)&&!localMeta.test(key)))throw Error('Unexpected portable desk metadata.');
 for(const table of tables){
  const fields=keys(table);
  if(snapshot.tables[table].some(row=>Object.keys(row).length!==fields.length||fields.some(field=>!Object.hasOwn(row,field))))throw Error(`Unexpected ${table} columns in portable desk.`);
 }
 return snapshot;
}

/** Build a fresh staged database. The caller never passes the live desk here. */
export function rebuildPortableDesk(snapshot:Snapshot,file:string){
 const store=new Store(file);
 try{
  store.transaction(()=>{
   for(const table of tables){
    const fields=keys(table),insert=store.db.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')})`);
    for(const row of snapshot.tables[table]){
     const safe=cleanRow(table,row);
     insert.run(...fields.map(field=>safe[field] as SQLInputValue));
    }
   }
   const set=store.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
   for(const [key,value] of Object.entries(snapshot.meta)){
    if(selectedMeta.has(key)||localMeta.test(key))set.run(key,JSON.stringify(cleanMeta(key,value)));
   }
   // Archive recovery never starts scheduled or previously approved work.
   store.set('scanSchedule',{enabled:false});
   store.set('availabilitySchedule',{enabled:false});
   store.set('privateImported',true);
   store.set('learningVersion',learningVersion);
   store.event('Portable desk restored as historical context. Revalidate listings before relying on them for new decisions.');
  });
  store.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
 }finally{store.close();}
}
