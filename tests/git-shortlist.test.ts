import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,symlinkSync,readFileSync,renameSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {Store} from '../server/db.ts';
import {listingSchema} from '../src/domain.ts';

test('real Git hooks include fresh shortlist, block stale pushes and fail safely without data',()=>{
 const workspace=resolve('.'),root=mkdtempSync(join(tmpdir(),'shortlist-git-')),repo=join(root,'repo'),remote=join(root,'remote.git');mkdirSync(repo);
 symlinkSync(join(workspace,'scripts'),join(repo,'scripts'),process.platform==='win32'?'junction':'dir');
 symlinkSync(join(workspace,'node_modules'),join(repo,'node_modules'),process.platform==='win32'?'junction':'dir');
 const env={...process.env,AF_NODE:process.execPath,GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.com',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.com'};
 const git=(args:string[],ok=true)=>{const r=spawnSync('git',args,{cwd:repo,env,encoding:'utf8'});if(ok)assert.equal(r.status,0,r.stdout+r.stderr);else assert.notEqual(r.status,0);return r;};
 git(['init','--initial-branch=main']);git(['init','--bare',remote]);git(['remote','add','origin',remote]);
 git(['config','core.hooksPath',join(workspace,'.githooks').replaceAll('\\','/')]);
 const database=join(repo,'data/live/apartments.sqlite'),store=new Store(database);
 try{
  const id=store.ingest(listingSchema.parse({source:'fixture',sourceId:'1',url:'https://example.com/home',title:'Fixture',address:'1 Example Street',rent:2500,beds:1})).id;
  store.db.prepare("UPDATE homes SET stage='Interested',notes='Initial choice' WHERE id=?").run(id);
  git(['commit','--allow-empty','-m','First snapshot']);
  const initial=JSON.parse(git(['show','HEAD:backups/shortlist.json']).stdout);assert.equal(initial.apartments[0].notes,'Initial choice');
  git(['push','origin','main']);
  store.db.prepare("UPDATE homes SET notes='Changed after commit' WHERE id=?").run(id);
  assert.match(git(['push','origin','main'],false).stderr,/saved apartments changed/);
  const check=spawnSync(process.execPath,['--import','tsx',join(workspace,'scripts/git-shortlist.ts'),'push'],{cwd:repo,env,encoding:'utf8',input:`refs/heads/main ${git(['rev-parse','HEAD']).stdout.trim()} refs/heads/main ${'0'.repeat(40)}\n`});
  assert.notEqual(check.status,0);assert.match(check.stderr,/saved apartments changed/);
  git(['commit','--allow-empty','-m','Updated snapshot']);git(['push','origin','main']);
  const saved=JSON.parse(git(['--git-dir',remote,'show','main:backups/shortlist.json']).stdout);assert.equal(saved.apartments[0].notes,'Changed after commit');
 }finally{store.close();}
 const before=readFileSync(join(repo,'backups/shortlist.json'),'utf8');renameSync(database,database+'.saved');
 git(['commit','--allow-empty','-m','Must fail without database'],false);
 assert.equal(readFileSync(join(repo,'backups/shortlist.json'),'utf8'),before);
 const empty=new Store(database);empty.close();
 assert.match(git(['commit','--allow-empty','-m','Must fail with empty database'],false).stderr,/Restore your private backup/);
 assert.equal(readFileSync(join(repo,'backups/shortlist.json'),'utf8'),before);
 unlinkSync(join(repo,'backups/shortlist.json'));
 assert.match(git(['commit','--allow-empty','-m','Must check committed shortlist'],false).stderr,/Restore your private backup/);
 assert.equal(git(['show','HEAD:backups/shortlist.json']).stdout,before);

 unlinkSync(database);renameSync(database+'.saved',database);
 const existing=new Store(database);
 try{existing.db.prepare("UPDATE homes SET stage='Not Interested'").run();}
 finally{existing.close();}
 git(['commit','--allow-empty','-m','All homes were declined locally']);
 assert.deepEqual(JSON.parse(git(['show','HEAD:backups/shortlist.json']).stdout).apartments,[]);
});
