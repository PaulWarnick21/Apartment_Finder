import {buildBuildingIndex,type BuildingMemory} from '../src/buildings.ts';
import {DatabaseSync} from 'node:sqlite';
import {criteriaSchema,listingSchema,type Home} from '../src/domain.ts';
import {scoreListing} from './scoring.ts';
import {quickRank} from './quick-rank.ts';

export const shortlistStages=new Set(['Interested','Serious Candidates','Ready to Apply','In Progress','Inquiry Sent','Viewing Booked','Applied','Leased','Closed']);

/** A read-only, assistant-independent recovery index; deliberately excludes galleries and private criteria. */
export function shortlistBackup(database:string,exportedAt=new Date().toISOString()){
 const db=new DatabaseSync(database,{readOnly:true});
 try{
  db.exec('BEGIN');
  const meta=<T>(key:string):T|undefined=>{const row=db.prepare('SELECT value FROM meta WHERE key=?').get(key) as {value:string}|undefined;return row?JSON.parse(row.value):undefined;};
  const criteria=criteriaSchema.parse(meta('criteria'));
  const aliases=db.prepare('SELECT alias,canonical FROM home_aliases').all() as {alias:number;canonical:number}[];
  const aliasMap=new Map(aliases.map(a=>[a.alias,a.canonical]));
  const canonical=(id:number)=>{const visited=new Set<number>();while(aliasMap.has(id)){if(visited.has(id))throw new Error('Apartment alias cycle');visited.add(id);id=aliasMap.get(id)!;}return id;};
  const postings=db.prepare('SELECT source,source_id,home_id,url FROM postings ORDER BY source,source_id').all() as {source:string;source_id:string;home_id:number;url:string}[];
  const ratings=db.prepare('SELECT home_id,user_score,reason,at FROM rating_feedback ORDER BY id DESC').all() as {home_id:number;user_score:number;reason:string;at:string}[];
  const homes=db.prepare('SELECT * FROM homes WHERE id NOT IN (SELECT alias FROM home_aliases) ORDER BY id').all() as {id:number;listing:string;stage:Home['stage'];notes:string;follow_up:string;viewing:string;first_seen:string;updated_at:string;revision:number;revisit_later?:number;tag_long_term_lease?:number;tag_unfurnished?:number}[];
  const buildingIndex=buildBuildingIndex(homes.map(h=>({id:h.id,listing:listingSchema.parse(JSON.parse(h.listing))})),meta<BuildingMemory>('buildingDesk'));
  const buildingKeys=new Map(buildingIndex.groups.flatMap(g=>g.homeIds.map(id=>[id,g.key] as const)));
  const apartments=homes.filter(h=>shortlistStages.has(h.stage)).map(h=>{
   const l=listingSchema.parse(JSON.parse(h.listing)),score=scoreListing(l,criteria,h.id),rating=ratings.find(r=>canonical(r.home_id)===h.id);
   const grade=meta<Home['quickRank']>(`preservedQuickRank:${h.id}`)??quickRank(l,criteria,h.id);
   const review=meta<Home['fullReview']>(`fullReview:${h.id}`);
   return {id:h.id,buildingKey:buildingKeys.get(h.id),aliases:aliases.filter(a=>canonical(a.alias)===h.id).map(a=>a.alias),stage:h.stage,revisitLater:['Interested','Serious Candidates'].includes(h.stage)&&!!h.revisit_later,tagLongTermLease:!!h.tag_long_term_lease,tagUnfurnished:!!h.tag_unfurnished,
    title:l.title,address:l.address,unit:l.unit,area:l.area,rent:l.rent,beds:l.beds,baths:l.baths,sqft:l.sqft,
    url:l.url,source:l.source,sourceId:l.sourceId,
    postings:postings.filter(p=>canonical(p.home_id)===h.id).map(p=>({source:p.source,sourceId:p.source_id,url:p.url})),
    score:{value:score.value,eligible:score.eligible,uncertain:score.uncertain,view:score.view},quickGrade:grade.grade,
    assessmentStatus:review?.status??'not-recorded',userRating:rating?{score:rating.user_score,reason:rating.reason,at:rating.at}:null,
    notes:h.notes,followUp:h.follow_up,viewing:h.viewing,firstSeen:h.first_seen,listingUpdatedAt:h.updated_at,revision:h.revision};
  });
  db.exec('COMMIT');
  return {format:'apartment-finder-shortlist',version:1,exportedAt,
   coverage:'Current Interested and later stages, including pending assessments, Leased and Closed; canonical homes with all saved cross-post URLs and alias IDs.',
   recovery:'Use apartments to rebuild a shortlist in any tool. Preserve IDs, stages, notes and score snapshots. Scores reflect saved evidence at export time; assessmentStatus distinguishes incomplete reviews. Source pages may expire. No automatic full-app import is provided.',
   buildings:buildingIndex.groups.filter(g=>apartments.some(h=>h.buildingKey===g.key)).map(g=>({...g,homeIds:g.homeIds.filter(id=>apartments.some(h=>h.id===id))})),
   omitted:['photos','full descriptions','private criteria','credentials','complete decision history','Unreviewed and Not Interested apartments'],apartments};
 }finally{db.close();}
}
