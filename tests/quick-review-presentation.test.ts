import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {listingSchema,type Home} from '../src/domain.ts';
import {QuickReviewContent,ReviewActions,FullReviewStatus} from '../src/quick-review.tsx';
import {fullReviewComplete,quickPresentation,reviewLabel,reviewDecisions} from '../src/review-presentation.ts';
import {compareHomes} from '../src/desk-sort.ts';
import {deskCategory} from '../src/desk-category.ts';

function home(overrides:Partial<Home>={}):Home{
 return {id:1,listing:listingSchema.parse({source:'fixture',sourceId:'1',url:'https://example.test/1',title:'Saved listing',address:'100 Example Street',area:'Downtown Vancouver',rent:2400,beds:1,photos:[{id:'one',url:'https://example.test/one.jpg',local:'one.jpg',status:'downloaded'},{id:'two',url:'https://example.test/two.jpg',status:'unavailable'}]}),score:{value:4.9,low:4,high:5,base:4,adjustments:[],flags:[],reasons:[],eligible:true,uncertain:false,view:'Nature dominant'},stage:'Unreviewed',notes:'Keep my note',followUp:'',viewing:'',revision:1,rescued:false,updatedAt:'2026-11-18T13:00:00Z',firstSeen:'2026-11-18T13:00:00Z',possibleDuplicates:[],postings:[{source:'fixture',url:'https://example.test/1'}],reviewMode:'quick',quickRank:{grade:'F',rankValue:10,eligible:true,reasons:['Farther from downtown'],flags:['View not confirmed']},...overrides};
}

test('quick view keeps grade F reviewable and does not expose a provisional full score',()=>{
 const h=home(),html=renderToStaticMarkup(createElement(QuickReviewContent,{home:h,busy:false,onDecision:()=>{},onRetry:()=>{}}));
 assert.match(html,/Quick rank F/);assert.match(html,/2,400/);assert.match(html,/100 Example Street/);
 assert.match(html,/Interested<\/button>/);assert.match(html,/Not Interested<\/button>/);
 assert.match(html,/\/media\/one.jpg/);assert.match(html,/Photo two · unavailable/);
 assert.match(html,/Some listing photos are still pending or inaccessible/);
 assert.doesNotMatch(html,/4\.9|Score Breakdown|Your Rating|Nature dominant/);
 assert.equal(quickPresentation(h),true);assert.equal(reviewLabel(h),'Quick rank F');
});

test('full score and Serious Candidates are gated on completed assessment, not user stage',()=>{
 for(const status of ['queued','running','paused','failed','cancelled'] as const){
  const h=home({stage:'Interested',reviewMode:'full',fullReview:{status,detail:'Saved work retained',updatedAt:'2026-11-18T13:00:00Z'}});
  assert.equal(fullReviewComplete(h),false);assert.equal(quickPresentation(h),true);assert.equal(reviewLabel(h),'Quick rank F');
  assert.equal(deskCategory(h),'Scoring in Progress');assert.equal(deskCategory({...h,stage:'Not Interested'}),'Closed');
  const ready=reviewDecisions(h).find(d=>d.stage==='Serious Candidates');assert.equal(ready?.disabled,true);
  const html=renderToStaticMarkup(createElement(ReviewActions,{home:h,busy:false,onDecision:()=>{}}));assert.match(html,/<button disabled=""[^>]*>Serious Candidates/);assert.match(html,/>Not Interested<\/button>/);
 }
 const done=home({stage:'Interested',reviewMode:'full',fullReview:{status:'complete',detail:'All accessible photos reviewed',updatedAt:'2026-11-18T13:00:00Z'}});
 assert.equal(fullReviewComplete(done),true);assert.equal(quickPresentation(done),false);assert.equal(reviewLabel(done),'Score 4.9 / 5');
 assert.equal(deskCategory(done),'Interested');
 assert.equal(reviewDecisions(done).find(d=>d.stage==='Serious Candidates')?.disabled,false);
});

test('Interested without a review stays in Scoring in Progress and offers recovery; legacy completed homes stay Interested',()=>{
 const h=home({stage:'Interested'});
 assert.equal(deskCategory(h),'Scoring in Progress');
 const html=renderToStaticMarkup(createElement(FullReviewStatus,{home:h,retry:()=>{}}));
 assert.match(html,/Full scoring not started/);assert.match(html,/Start full scoring/);
 assert.equal(deskCategory({...h,reviewMode:'full'}),'Interested');
 assert.equal(deskCategory({...h,reviewMode:undefined,quickRank:undefined}),'Interested');
});

test('Scoring in Progress defaults to longest waiting first, regardless of provisional score or job updates',()=>{
 const earlier=home({id:1,stage:'Interested',categoryEnteredAt:'2026-11-17T10:00:00Z',fullReview:{status:'paused',detail:'Paused',updatedAt:'2026-11-18T14:00:00Z'},score:{...home().score,value:0}});
 const later=home({id:2,stage:'Interested',categoryEnteredAt:'2026-11-18T10:00:00Z',fullReview:{status:'running',detail:'Running',updatedAt:'2026-11-18T13:00:00Z'}});
 assert.deepEqual([later,earlier].sort((a,b)=>compareHomes(a,b,'Scoring in Progress','score')).map(h=>h.id),[1,2]);
 assert.deepEqual([earlier,later].sort((a,b)=>compareHomes(a,b,'Scoring in Progress','recent')).map(h=>h.id),[2,1]);
});

test('failed review offers explicit retry while closed choices do not',()=>{
 const h=home({stage:'Interested',fullReview:{status:'failed',detail:'Account connection required',updatedAt:'2026-11-18T13:00:00Z'}});
 const render=(value:Home)=>renderToStaticMarkup(createElement(FullReviewStatus,{home:value,retry:()=>{}}));
 assert.match(render(h),/Account connection required/);assert.match(render(h),/Retry full scoring/);
 assert.doesNotMatch(render({...h,stage:'Not Interested'}),/Retry full scoring/);
});

test('completed assessments do not repeat completion notices on Interested cards',()=>{
 const h=home({stage:'Interested',reviewMode:'full',fullReview:{status:'complete',detail:'Full scoring complete',updatedAt:'2026-11-18T13:00:00Z'}});
 assert.equal(renderToStaticMarkup(createElement(FullReviewStatus,{home:h})), '');
 assert.equal(reviewLabel(h),'Score 4.9 / 5');
 assert.equal(reviewDecisions(h).find(d=>d.stage==='Serious Candidates')?.disabled,false);
});

test('reopened quick review retains a letter even when old complete evidence is reusable',()=>{
 const h=home({fullReview:{status:'complete',detail:'Earlier assessment',updatedAt:'2026-11-16T13:00:00Z'}});
 assert.equal(quickPresentation(h),true);assert.equal(reviewLabel(h),'Quick rank F');
 const rejected=home({quickRank:{grade:'F',rankValue:0,eligible:false,reasons:['Studio apartment'],flags:[]}});
 assert.deepEqual(reviewDecisions(rejected).map(d=>d.stage),['Not Interested']);
});

test('Unreviewed sort follows quick rank even when numeric full scores disagree',()=>{
 const best=home({id:1,quickRank:{grade:'S',rankValue:90,eligible:true,reasons:[],flags:[]},score:{...home().score,value:.1}}),last=home({id:2});
 assert.deepEqual([last,best].sort((a,b)=>compareHomes(a,b,'Unreviewed','score')).map(h=>h.id),[1,2]);
 assert.equal(reviewDecisions(home({reviewMode:undefined,quickRank:undefined,stage:'Interested'}))[0].stage,'Serious Candidates');
});

test('external listing strings render as text in the quick decision view',()=>{
 const h=home();h.listing.address='<script>bad()</script>';h.quickRank!.flags=['<img src=x onerror=bad()>'];
 const html=renderToStaticMarkup(createElement(QuickReviewContent,{home:h,busy:false,onDecision:()=>{},onRetry:()=>{}}));
 assert.match(html,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);assert.doesNotMatch(html,/<img src="x"/);
});
