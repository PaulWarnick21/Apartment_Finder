import {hash,type Store} from './db.ts';

type Rejection={at:number;until:number;policy:string;reason:string};
const policy=(store:Store)=>hash(JSON.stringify(store.db.prepare(`SELECT key,json_extract(value,'$.quickIntake') AS intake,json_extract(value,'$.mainlandOnly') AS mainland,json_extract(value,'$.regions') AS regions,json_extract(value,'$.allowNearbyFallback') AS nearby,json_extract(value,'$.configuredAt') AS configured FROM meta WHERE key IN ('criteria','searchAreaPolicy') ORDER BY key`).all()));
const multi=(source:string,url:string)=>source==='hollyburn'&&/\/building\//.test(url)||source==='zumper'&&/\/apartment-buildings\//.test(url);
const key=(source:string,url:string,id?:string)=>`intakeRejection:${source}:${hash(url+(multi(source,url)?'|'+(id??''):''))}`;
/** Only explicit outcomes are remembered. A failed fetch never establishes removal. */
export function rememberIntakeRejection(store:Store,source:string,url:string,reason:string,id?:string,now=Date.now()){
 if(!['outside-area','room','building','floorplan','existing'].includes(reason)||multi(source,url)&&!id)return;
 store.set(key(source,url,id),{at:now,until:now+(reason==='existing'?86400000:7*86400000),policy:policy(store),reason} satisfies Rejection);
}
export function intakeRejected(store:Store,source:string,url:string,id?:string,now=Date.now()){
 if(multi(source,url)&&!id)return false;
 const saved=store.get<Rejection>(key(source,url,id));return !!saved&&saved.until>now&&saved.policy===policy(store);
}
export function clearIntakeRejection(store:Store,source:string,url:string){
 store.db.prepare('DELETE FROM meta WHERE key=?').run(key(source,url));
 // Explicit building retries may collect a changed inventory, without reviving unit decisions.
 store.db.prepare('DELETE FROM meta WHERE key=?').run(`inventoryChecked:${source}:${hash(url)}`);
}
/** Shared building inventories are checked daily, even when all their offers were rejected. */
export function buildingRecentlyChecked(store:Store,source:string,url:string,now=Date.now()){
 if(!multi(source,url))return false;
 const at=store.get<string>(`inventoryChecked:${source}:${hash(url)}`);return !!at&&now-Date.parse(at)<86400000;
}
