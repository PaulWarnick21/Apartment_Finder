import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryEnd,nextDiscovery} from '../server/source-discovery.ts';
import {sourceById,allowedUrl} from '../server/sources.ts';

const rew=sourceById('rew'),root='https://www.rew.ca/rentals/areas/example-vancouver-bc';
const pager=(current:number,next?:number)=>`<div class="paginator"><ul><li class="paginator-page is-active"><a href="${root}${current===1?'':'/page/'+current}">${current}</a></li><li class="paginator-next_page paginator-control">${next?`<a rel="next" href="${root}/page/${next}">Next</a>`:'<i class="rewicon-angle-right"></i>'}</li></ul></div>`;
test('REW recognizes its explicit disabled final-page control only for the current catalogue',()=>{
 assert.equal(discoveryEnd(pager(2),rew,root+'/page/2')?.exhausted,true);
 assert.equal(discoveryEnd(pager(1,2),rew,root)?.exhausted,false);
 assert.equal(nextDiscovery(pager(1,2),rew,root),root+'/page/2');
 assert.equal(discoveryEnd(pager(2),rew,root),null);
 assert.equal(discoveryEnd('<main>No next link</main>',rew,root),null);
 assert.equal(discoveryEnd('<div class="paginator"><li class="paginator-page is-active"><a href="'+root+'">1</a></li></div>',rew,root),null);
});
test('Zumper permits its observed application CDN without widening source or media destinations',()=>{
 const s=sourceById('zumper'),url='https://d214hhm15p4t1d.cloudfront.net/web-zumper/example/js/main.js';
 assert.equal(allowedUrl(url,s.assetHosts??[]),true);
 assert.equal(allowedUrl(url,s.hosts),false);
 assert.equal(allowedUrl(url,s.mediaHosts),false);
 assert.equal(allowedUrl('https://unrelated.cloudfront.net/main.js',s.assetHosts??[]),false);
});
