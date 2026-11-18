import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../server/db.ts';
import {listingSchema} from '../src/domain.ts';
import {createFullBackup,verifyBackup,restoreBackup} from '../server/full-backup.ts';

const listing=(sourceId='a',patch:Record<string,unknown>={})=>listingSchema.parse({source:'fixture',sourceId,url:`https://example.com/${sourceId}`,title:'Fixture',address:'100 Example St',unit:'1',rent:2400,beds:1,photos:[{id:'p1',url:`https://example.com/${sourceId}.jpg`,local:'fixture.jpg',status:'reviewed',kind:'interior',scenery:'nature',quality:4,unitCertain:true}],galleryComplete:true,expectedPhotos:1,...patch});
test('cross-posts preserve original facts, unique photo IDs, reviewed gallery and stable identity',()=>{const store=new Store(':memory:');try{
 const first=store.ingest(listing()).id,again=store.ingest(listing('b',{source:'other',rent:2500})).id;
 assert.equal(first,again);const h=store.home(first)!;assert.equal(h.listing.photos.length,2);assert.equal(new Set(h.listing.photos.map(p=>p.id)).size,2);assert.equal(h.listing.galleryComplete,true);assert.equal(h.listing.expectedPhotos,2);assert.equal(h.listing.source,'fixture');assert.equal(h.listing.rent,2500);assert.equal(store.postingDetails(first).length,2);
 store.ingest(listing('b',{source:'other',rent:2600,photos:[]} ),{preservePhotos:true});assert.equal(store.home(first)!.listing.photos.length,2);assert.equal(store.home(first)!.postings.length,2);
 store.ingest(listing('b',{source:'other',rent:2400}),{preservePhotos:true});assert.equal(store.home(first)!.listing.rent,2400);assert.ok(!store.home(first)!.listing.conflicts.some(c=>c.startsWith('rent:')));
}finally{store.close();}});
test('incomplete resumes retain earlier photos, and incompatible exact-unit ads remain separate',()=>{const store=new Store(':memory:');try{
 const id=store.ingest(listing()).id;store.ingest(listing('a',{galleryComplete:false,expectedPhotos:3,photos:[{id:'p1',url:'https://example.com/new.jpg'}]}));const h=store.home(id)!;assert.equal(h.listing.photos.length,2);assert.equal(h.listing.photos[0].status,'reviewed');assert.equal(h.listing.galleryComplete,false);assert.equal(h.listing.expectedPhotos,3);
 const other=store.ingest(listing('different',{beds:3})).id;assert.notEqual(id,other);assert.ok(store.home(id)!.possibleDuplicates.includes(other));
}finally{store.close();}});
test('explicit merge keeps both references and notes; split restores records without reusing IDs',()=>{const store=new Store(':memory:');try{
 const a=store.ingest(listing('a',{unit:''})).id,b=store.ingest(listing('b',{unit:''})).id;
 for(const [id,notes] of [[a,'First notes'],[b,'Second notes']] as const)store.update(id,store.home(id)!.revision,{stage:'Unreviewed',notes,followUp:'',viewing:'',rescued:false});
 const merged=store.mergeHomes(a,b,{keep:store.home(a)!.revision,duplicate:store.home(b)!.revision});assert.equal(store.homes().length,1);assert.equal(store.home(b)!.id,a);assert.deepEqual(store.home(a)!.aliases,[b]);assert.match(store.home(a)!.notes,/Second notes/);
 store.splitMerge(merged.mergeId);assert.equal(store.homes().length,2);assert.equal(store.home(a)!.notes,'First notes');assert.equal(store.home(b)!.notes,'Second notes');
 const again=store.mergeHomes(a,b);store.update(a,store.home(a)!.revision,{stage:'Interested',notes:'New decision',followUp:'',viewing:'',rescued:false});assert.throws(()=>store.splitMerge(again.mergeId),/changed/);assert.equal(store.home(a)!.notes,'New decision');
}finally{store.close();}});
test('cached homes are independent copies and observe raw listing and criteria changes',()=>{const store=new Store(':memory:');try{
 const id=store.ingest(listing()).id,first=store.home(id)!;first.listing.rent=1;assert.equal(store.home(id)!.listing.rent,2400);
 store.db.prepare('UPDATE homes SET listing=? WHERE id=?').run(JSON.stringify(listing('a',{rent:2900})),id);assert.equal(store.home(id)!.listing.rent,2900);
 const score=store.home(id)!.score.value;store.set('criteria',{...store.criteria,baseScore:1});assert.notEqual(store.home(id)!.score.value,score);
}finally{store.close();}});
test('full backup verifies media and private criteria and restores only to a new folder',async()=>{const root=await mkdtemp(join(tmpdir(),'finder-backup-')),data=join(root,'data'),priv=join(root,'private'),bundle=join(root,'backup'),restore=join(root,'restore');await mkdir(join(data,'media'),{recursive:true});await mkdir(priv);const filename='a'.repeat(64)+'.jpg';await writeFile(join(data,'media',filename),'fixture media');await writeFile(join(priv,'criteria.md'),'Private fixture criteria');const store=new Store(join(data,'apartments.sqlite'));
 try{const id=store.ingest(listing('backup',{photos:[{id:'p',url:'https://example.com/p',local:filename,sourceLocal:filename}]})).id;store.update(id,0,{stage:'Interested',notes:'Preserved notes',followUp:'',viewing:'',rescued:false});await createFullBackup(store,data,bundle,priv);assert.equal((await verifyBackup(bundle)).valid,true);await restoreBackup(bundle,restore);const db=new DatabaseSync(join(restore,'apartments.sqlite'),{readOnly:true});try{assert.equal((db.prepare('SELECT notes FROM homes WHERE id=?').get(id) as any).notes,'Preserved notes');}finally{db.close();}assert.equal(await readFile(join(restore,'private','criteria.md'),'utf8'),'Private fixture criteria');await assert.rejects(()=>restoreBackup(bundle,restore),/exists/);await writeFile(join(bundle,'media',filename),'corrupted');await assert.rejects(()=>verifyBackup(bundle),/checksum/);
 }finally{store.close();}
});
