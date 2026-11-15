import {existsSync} from 'node:fs';
import {join} from 'node:path';
import type {Budget} from './plans.ts';
import type {Photo} from '../src/domain.ts';
export type DownloadedPhoto=Pick<Photo,'hash'|'local'|'sourceLocal'|'sourceWidth'|'sourceHeight'|'sourceBytes'>;
/** Reuse only bytes downloaded in this same approved run. A URL alone is not a freshness validator. */
export function reusedDownload(budget:Budget,url:string,dataDir:string):DownloadedPhoto|undefined{
 budget.check();const value=budget.store.get<Record<string,DownloadedPhoto>>(`mediaDownloads:${budget.id}`)?.[url];
 if(!value?.hash||!value.local||!value.sourceLocal||!/^[a-f0-9]{64}\.jpg$/.test(value.local)||!/^[a-f0-9]{64}\.(jpg|png|webp|avif|gif)$/.test(value.sourceLocal))return;
 if(!existsSync(join(dataDir,'media',value.local))||!existsSync(join(dataDir,'media',value.sourceLocal)))return;
 return {hash:value.hash,local:value.local,sourceLocal:value.sourceLocal,sourceWidth:value.sourceWidth,sourceHeight:value.sourceHeight,sourceBytes:value.sourceBytes};
}
export function rememberDownload(budget:Budget,url:string,value:DownloadedPhoto){const key=`mediaDownloads:${budget.id}`,saved=budget.store.get<Record<string,DownloadedPhoto>>(key)??{};saved[url]={hash:value.hash,local:value.local,sourceLocal:value.sourceLocal,sourceWidth:value.sourceWidth,sourceHeight:value.sourceHeight,sourceBytes:value.sourceBytes};budget.store.set(key,saved);}
