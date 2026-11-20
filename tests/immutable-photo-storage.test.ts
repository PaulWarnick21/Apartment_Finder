import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,stat,utimes,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {storeImmutablePhoto} from '../server/photo-storage.ts';
test('identical saved media is verified and reused without opening it for replacement',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'af-immutable-photo-')),path=join(dir,'photo.jpg'),bytes=Buffer.from('fixture-image');
 await writeFile(path,bytes);await utimes(path,new Date(1000000),new Date(1000000));const before=await stat(path);
 await storeImmutablePhoto(path,bytes);assert.equal((await stat(path)).mtimeMs,before.mtimeMs);assert.deepEqual(await readFile(path),bytes);
 await assert.rejects(storeImmutablePhoto(path,Buffer.from('different')),/does not match/);assert.deepEqual(await readFile(path),bytes);
});
test('simultaneous writers publish a complete immutable file and remove temporary files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'af-concurrent-photo-')),path=join(dir,'photo.jpg'),bytes=Buffer.alloc(1024*100,77);
 await Promise.all(Array.from({length:8},()=>storeImmutablePhoto(path,bytes)));
 assert.deepEqual(await readFile(path),bytes);assert.deepEqual(await readdir(dir),['photo.jpg']);
});
