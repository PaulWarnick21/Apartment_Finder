import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {assertArchivedOperation} from '../server/archived-operations.ts';

test('archived runs permit explicit status and reject every work or unspecified action',()=>{
 assert.doesNotThrow(()=>assertArchivedOperation('old run','status',['status']));
 for(const action of [undefined,'start','resume','tick','hold','init','repair','report','STATUS']){
  assert.throws(()=>assertArchivedOperation('old run',action,['status']),/archived; historical authorization cannot be reused/);
 }
 assert.throws(()=>assertArchivedOperation('old continuation','status'),/Prepare a current bounded plan and obtain fresh approval/);
});

test('archived CLI entrypoints reject before creating or opening runtime data',()=>{
 const directory=mkdtempSync(join(tmpdir(),'apartment-archived-'));
 try{
  const invocations:[string,string[]][]=[
   ['credit-limited-scan.ts',['start','10']],
   ['twenty-per-source.ts',['resume','10']],
   ['credit-scan-finish-photos.ts',['10']],
   ['twenty-finish-photos.ts',['10']],
   ['twenty-restore-gallery-slots.ts',[]],
   ['catchup-scan.ts',['init','10']],
  ];
  for(const [script,args] of invocations){
   const url=new URL(`../scripts/${script}`,import.meta.url).href;
   const code=`globalThis.fetch=async()=>{throw Error('Network disabled in archival helper test')};process.argv=${JSON.stringify(['node',url,...args])};await import(${JSON.stringify(url)});`;
   const result=spawnSync(process.execPath,['--import',import.meta.resolve('tsx'),'--input-type=module','--eval',code],{cwd:directory,encoding:'utf8',timeout:15000});
   assert.equal(result.error,undefined,`${script}: ${result.error?.message}`);
   assert.notEqual(result.status,0,script);
   assert.match(result.stderr,/archived; historical authorization cannot be reused/,script);
   assert.deepEqual(readdirSync(directory),[],`${script} must reject before touching runtime data`);
  }
 }finally{if(readdirSync(directory).length===0)rmdirSync(directory);}
});
