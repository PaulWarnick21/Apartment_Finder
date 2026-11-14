import type {DatabaseSync} from 'node:sqlite';
import type {Home} from '../src/domain.ts';
import {deskCategory} from '../src/desk-category.ts';
import {stageGroup} from '../src/stage-transitions.ts';

/** Track entry into a section, independently of note edits or listing refreshes. */
export function categoryEntry(db:DatabaseSync,home:Home){
 const category=deskCategory(home),prior=db.prepare('SELECT category,entered_at FROM desk_membership WHERE home_id=?').get(home.id) as {category:string;entered_at:string}|undefined;
 if(prior?.category===category)return prior.entered_at;
 let enteredAt=new Date().toISOString();
 if(!prior){
  // Old exclusions were derived, not recorded as decisions. Use the last known
  // listing timestamp as their historical fallback, then track entries exactly.
  enteredAt=home.updatedAt||home.firstSeen;
  if(category==='Closed'){
   const decisions=db.prepare("SELECT at,before_json,after_json FROM history WHERE home_id=? AND event='Decision saved' ORDER BY id DESC").all(home.id) as {at:string;before_json:string;after_json:string}[];
   const entry=decisions.find(r=>stageGroup(JSON.parse(r.before_json).stage)!=='Closed'&&stageGroup(JSON.parse(r.after_json).stage)==='Closed');
   if(entry)enteredAt=entry.at;
  }
 }
 db.prepare('INSERT INTO desk_membership(home_id,category,entered_at) VALUES (?,?,?) ON CONFLICT(home_id) DO UPDATE SET category=excluded.category,entered_at=excluded.entered_at').run(home.id,category,enteredAt);
 return enteredAt;
}
