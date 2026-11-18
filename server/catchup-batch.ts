import type {DailyScanCaps} from './catchup-policy.ts';

type PhaseChoice={phase:'inventory'|'assessment';source:string};

/** One approval keeps the existing aggregate phase allowance while independent
 * sources share it. Inventory's listing slots are schema placeholders only. */
export function quickCatchupBatch(choice:PhaseChoice,peers:readonly string[],remaining:DailyScanCaps,concurrency=3){
 const maxPages=Math.min(choice.phase==='inventory'?8:90,remaining.pages);
 const maxPhotos=choice.phase==='inventory'?0:Math.min(1500,remaining.photos);
 const capacity=Math.min(3,Number.isInteger(concurrency)?Math.max(1,concurrency):3,Math.floor(maxPages/2),remaining.listings,choice.phase==='assessment'?maxPhotos:Infinity);
 if(capacity<1)throw new Error('Daily allowance cannot support another catch-up phase');
 const sources=[...new Set([choice.source,...peers])].slice(0,capacity);
 const maxListings=choice.phase==='inventory'?sources.length:Math.min(60,remaining.listings);
 if(choice.phase==='inventory')return {sources,maxPages,maxListings,maxPhotos};
 // Match the worker's static 75% preferred-source share, retaining at least two
 // page visits and one candidate for each other source. Divide the existing
 // thirty-new-home target across those shares, rather than multiplying it.
 let pages=maxPages,listings=maxListings,target=Math.min(30,maxListings);
 const targetNewListingsBySource:Record<string,number>={};
 for(const [index,source] of sources.entries()){
  const count=sources.length-index;
  const priority=index===0&&count>1?Math.max(0,Math.min(.75,(pages-2*(count-1))/pages,(listings-(count-1))/listings)):0;
  const share=priority>0?priority:1/count,candidates=Math.floor(listings*share);
  const assigned=Math.min(candidates,Math.max(1,Math.floor(target*share)));
  targetNewListingsBySource[source]=assigned;target-=assigned;
  pages-=Math.floor(pages*share);listings-=candidates;
 }
 return {sources,maxPages,maxListings,maxPhotos,targetNewListingsPerSource:Math.min(30,maxListings),targetNewListingsBySource};
}
