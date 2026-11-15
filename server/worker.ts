import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {storePhoto} from './photo-storage.ts';
import {Store,hash} from './db.ts';
import {Budget,claimPlan,getPlan} from './plans.ts';
import {sourceById} from './sources.ts';
import {SourceSession} from './transport.ts';
import {discover,parseListing} from './parsers.ts';
import {type VisionProvider} from './provider.ts';
import {createVisionProvider} from './chatgpt-provider.ts';
import type {Listing} from '../src/domain.ts';
export async function assessPhotos(store:Store,l:Listing,provider:VisionProvider,budget:Budget,dataDir:string){
 const otherUnit=/photos?\s+(?:are\s+)?(?:of|show|from)\s+(?:a\s+)?(?:similar|other|different|display|model)\s+(?:unit|suite)|photos?\s+(?:are\s+)?(?:representative|for illustrative purposes)|not\s+(?:the\s+)?actual\s+unit/i.test(l.description);
 const checkProvenance=()=>{if(otherUnit)for(const p of l.photos){p.unitCertain=false;p.note=`Exact-unit provenance unverified: listing describes representative photos. ${p.note}`.slice(0,2000);}};
 try{for(const photo of l.photos){budget.check();if(!photo.local||!photo.hash||photo.status==='unavailable')continue;const context='photo-context:'+hash(JSON.stringify([provider.version,l.source,l.sourceId,l.unit,l.description,photo.hash]));if(photo.status==='reviewed'&&photo.version===provider.version)continue;const cached=store.db.prepare('SELECT result FROM photo_cache WHERE hash=? AND version=?').get(photo.hash,provider.version) as any;if(cached){Object.assign(photo,JSON.parse(cached.result),{status:'reviewed',version:provider.version,unitCertain:!otherUnit&&store.get<boolean>(context)===true});continue;}budget.reserveAi();const finding=await provider.review(photo,join(dataDir,'media',photo.local));Object.assign(photo,finding,{status:'reviewed',version:provider.version});store.set(context,!otherUnit&&finding.unitCertain);store.db.prepare('INSERT OR REPLACE INTO photo_cache VALUES (?,?,?)').run(photo.hash,provider.version,JSON.stringify({...finding,unitCertain:false}));}}finally{checkProvenance();}
}
export async function runPlan(store:Store,id:string,dataDir:string){const {runRegularPlan}=await import('./regular-worker.ts');return runRegularPlan(store,id,dataDir);}
