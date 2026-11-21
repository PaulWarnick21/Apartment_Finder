import {z} from 'zod';
import type {Store} from './db.ts';
import {buildBuildingIndex,buildingPair,buildingReady,emptyBuildingMemory,type BuildingMemory,type BuildingIndex} from '../src/buildings.ts';

export const buildingMemoryKey='buildingDesk';
export function buildingDesk(store:Store,homes=store.homes()){
 const ratings:BuildingIndex['ratings']={};
 for(const row of store.db.prepare('SELECT home_id,user_score,reason FROM rating_feedback ORDER BY id DESC').all() as {home_id:number;user_score:number;reason:string}[]){const id=store.resolveHomeId(row.home_id);ratings[id]??={score:row.user_score,reason:row.reason};}
 return buildBuildingIndex(homes,store.get<BuildingMemory>(buildingMemoryKey),ratings);
}
const key=z.string().min(1).max(600);
const change=z.discriminatedUnion('action',[
 z.object({action:z.literal('notes'),revision:z.number().int().nonnegative(),key,notes:z.string().max(10000)}).strict(),
 z.object({action:z.enum(['confirm','dismiss']),revision:z.number().int().nonnegative(),a:key,b:key}).strict(),
 z.object({action:z.literal('assign'),revision:z.number().int().nonnegative(),homeId:z.number().int().positive(),targetHomeId:z.number().int().positive(),confirmation:z.literal('SAME BUILDING GROUP')}).strict(),
 z.object({action:z.enum(['separate','restore']),revision:z.number().int().nonnegative(),homeId:z.number().int().positive()}).strict()
]);
export function updateBuildingDesk(store:Store,input:unknown){
 const patch=change.parse(input);
 return store.transaction(()=>{
  const memory=store.get<BuildingMemory>(buildingMemoryKey)??emptyBuildingMemory();
  if(memory.revision!==patch.revision)throw Error('Building notes or groups changed. Reload the saved building context before trying again; your draft is retained.');
  const homes=store.homes(),index=buildBuildingIndex(homes,memory);
  if(patch.action==='notes'){
   if(!index.groups.some(g=>g.key===patch.key))throw Error('Building changed; refresh the desk.');
   memory.notes[patch.key]=patch.notes;
   memory.assigned??={};for(const id of index.groups.find(g=>g.key===patch.key)!.homeIds)memory.assigned[id]=patch.key;
  }else if(patch.action==='assign'){
   const home=homes.find(h=>h.id===patch.homeId),target=homes.find(h=>h.id===patch.targetHomeId);
   if(!home||!target||home.id===target.id)throw Error('Choose two different saved apartments.');
   if(!buildingReady(home)||!buildingReady(target))throw Error('Both apartments must be fully scored and outside sections 1 and 1.5 before grouping.');
   const sourceGroup=index.groups.find(g=>g.homeIds.includes(home.id))!,targetGroup=index.groups.find(g=>g.homeIds.includes(target.id))!;
   if(sourceGroup.key===targetGroup.key)throw Error('These apartments are already in the same building group.');
   memory.assigned??={};memory.assigned[home.id]=targetGroup.key;delete memory.separate[home.id];
   if(sourceGroup.notes&&sourceGroup.notes!==targetGroup.notes)memory.notes[targetGroup.key]=[targetGroup.notes,`[${sourceGroup.label}]\n${sourceGroup.notes}`].filter(Boolean).join('\n\n');
  }else if('homeId' in patch){
   const group=index.groups.find(g=>g.homeIds.includes(patch.homeId));
   if(patch.action==='restore'){
    if(!memory.separate[patch.homeId]||!group)throw Error('This unit has no building separation to undo.');
    delete memory.separate[patch.homeId];
    const restored=buildBuildingIndex(homes,memory).groups.find(g=>g.homeIds.includes(patch.homeId))!;
    if(group.notes&&group.notes!==restored.notes)memory.notes[restored.key]=[restored.notes,`[Apartment #${patch.homeId}]\n${group.notes}`].filter(Boolean).join('\n\n');
   }else{
   if(!group||group.homeIds.length<2)throw Error('Choose a unit in a building group.');
   memory.separate[String(patch.homeId)]=true;
   // Keep shared reminders visible on the separated unit without modifying its unit notes.
   memory.notes[`separate:${patch.homeId}`]=group.notes;
   }
  }else{
   if(patch.a===patch.b||![patch.a,patch.b].every(key=>index.groups.some(g=>g.key===key)))throw Error('Building groups changed; refresh the desk.');
   if(!index.suggestions.some(p=>buildingPair(p.a,p.b)===buildingPair(patch.a,patch.b)))throw Error('This building suggestion changed; refresh the desk.');
   if(patch.action==='dismiss')memory.dismissed.push(buildingPair(patch.a,patch.b));
   else{
    const a=index.groups.find(g=>g.key===patch.a)!,b=index.groups.find(g=>g.key===patch.b)!;
    if(![a,b].every(group=>homes.some(home=>group.homeIds.includes(home.id)&&buildingReady(home))))throw Error('Both building groups need a fully scored apartment outside sections 1 and 1.5 before grouping.');
    // Prefer the resolved civic address so future units join the same building.
    const [keep,other]=b.key.startsWith('address:')&&!a.key.startsWith('address:')?[b,a]:[a,b];
    memory.links[other.key]=keep.key;
    memory.assigned??={};for(const id of [...keep.homeIds,...other.homeIds])memory.assigned[id]=keep.key;
    if(other.notes&&other.notes!==keep.notes)memory.notes[keep.key]=[keep.notes,`[${other.label}]\n${other.notes}`].filter(Boolean).join('\n\n');
   }
  }
  memory.revision++;store.set(buildingMemoryKey,memory);store.event(patch.action==='notes'?'Shared building notes saved.':patch.action==='confirm'?'Same-building grouping confirmed; individual apartments kept separate.':patch.action==='dismiss'?'Possible same-building suggestion dismissed.':`Building membership updated for apartment #${'homeId' in patch?patch.homeId:''}.`);
  return buildingDesk(store,homes);
 });
}
