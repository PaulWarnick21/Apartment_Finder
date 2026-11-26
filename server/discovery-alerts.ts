import {randomUUID} from 'node:crypto';
import type {Store} from './db.ts';

export type DiscoveryAlert={id:string;source:string;at:string;message:string;dismissedAt?:string;resolvedAt?:string};
export function discoveryAlerts(store:Store){return store.get<DiscoveryAlert[]>('discoveryAlerts')??[];}
export function raiseDiscoveryAlert(store:Store,source:string,message:string,now:Date){
 const alerts=discoveryAlerts(store);
 // One notification per slowdown episode, including after dismissal or restart.
 if(alerts.some(a=>a.source===source&&!a.resolvedAt))return;
 store.set('discoveryAlerts',[...alerts,{id:randomUUID(),source,at:now.toISOString(),message}].slice(-100));
 store.event(message);
}
export function resolveDiscoveryAlert(store:Store,source:string,now:Date,recovered=true){
 const alerts=discoveryAlerts(store);if(!alerts.some(a=>a.source===source&&!a.resolvedAt))return;
 store.set('discoveryAlerts',alerts.map(a=>a.source===source&&!a.resolvedAt?{...a,resolvedAt:now.toISOString()}:a));
 if(recovered)store.event(`${source}: recent scan results recovered; productive batches can continue without an added wait inside scheduled windows.`);
}
export function dismissDiscoveryAlert(store:Store,id:string){
 const alerts=discoveryAlerts(store);if(!alerts.some(a=>a.id===id))throw Error('Scan alert not found');
 store.set('discoveryAlerts',alerts.map(a=>a.id===id?{...a,dismissedAt:new Date().toISOString()}:a));
 return {ok:true};
}
