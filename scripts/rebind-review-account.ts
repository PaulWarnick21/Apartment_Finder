import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {loadEnvFile} from 'node:process';
import {z} from 'zod';
import {closeAccountUsage,readAccountUsage,validateAccountUsage} from '../server/account-usage.ts';
import {aiMode,chatGpt} from '../server/chatgpt.ts';
import {Store} from '../server/db.ts';
import type {FullReviewPolicy} from '../server/full-review.ts';

const dataDir=resolve('data/live');
const database=join(dataDir,'apartments.sqlite');
if(!existsSync(database))throw new Error('Restore your private backup before configuring the review account.');
if(existsSync('.env'))loadEnvFile('.env');
if(aiMode()!=='chatgpt')throw new Error('Full reviews require the connected ChatGPT plan.');

const store=new Store(database);
try{
 const policy=store.get<Omit<FullReviewPolicy,'accountId'|'profileId'>&Partial<Pick<FullReviewPolicy,'accountId'|'profileId'>>>('fullReviewPolicy');
 if(!policy)throw new Error('The desk has no saved full-review limits to restore.');
 const connection=await chatGpt(dataDir).state();
 if(connection.pending||!connection.active||!connection.sharing||!connection.model){
  throw new Error('Connect the same ChatGPT account in Preferences and choose an image-capable model first.');
 }
 const usage=await readAccountUsage();
 const accountId=policy.accountId??z.object({accountId:z.string().min(1)}).parse(usage).accountId;
 validateAccountUsage(usage,accountId,policy.stopAt);
 store.transaction(()=>{
  const current=store.get<FullReviewPolicy>('fullReviewPolicy');
  if(JSON.stringify(current)!==JSON.stringify(policy))throw new Error('Review settings changed. Run this command again.');
  const busy=store.db.prepare(`SELECT 1 FROM scan_lock
   UNION ALL SELECT 1 FROM parallel_scan_members
   UNION ALL SELECT 1 FROM plans WHERE state IN ('approved','running')
   UNION ALL SELECT 1 FROM meta WHERE key GLOB 'fullReview:*' AND json_extract(value,'$.status') IN ('queued','running')
   LIMIT 1`).get();
  if(busy)throw new Error('Finish or recover active work before reconnecting the review account.');
  store.set('fullReviewPolicy',{...policy,accountId,profileId:connection.active});
  store.event('Full-review account reconnected with its saved limits. No work was started.');
 });
 console.log('Full-review account reconnected. Saved limits are unchanged. No work was started.');
}finally{
 closeAccountUsage();
 store.close();
}
