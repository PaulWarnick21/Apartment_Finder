import {load} from 'cheerio';
import type {Page} from 'playwright';
import type {DiscoveryCard} from './source-discovery.ts';

const mainSelector='[role="main"][aria-label="Collection of Marketplace items"]';
const sidebarSelector='[role="navigation"][aria-label="Marketplace sidebar"]';
const itemSelector='a[href*="/marketplace/item/"]';
const snapshotId='af-facebook-current-results';
const maxCards=2000;
type Feed={edges:unknown[];page_info?:{has_next_page?:boolean}};
type SearchLocation={city:'Vancouver';radiusKm:number;label:string};
export type FacebookSearchSnapshot={recognized:boolean;cards:DiscoveryCard[];visibleUrls:string[];hasNext:boolean|null;searchLocation?:SearchLocation;html:string};
type PublicSnapshot={url:string;recognized:boolean;cards:DiscoveryCard[];visibleUrls:string[];hasNext:boolean|null;searchLocation?:SearchLocation};
function text(value:unknown,max=500){return typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,max):undefined;}
function itemUrl(value:unknown,base:string){try{if(typeof value!=='string')return null;const u=new URL(value,base);if(u.protocol!=='https:'||u.hostname!=='www.facebook.com'||!/^\/marketplace\/item\/\d+\/?$/.test(u.pathname))return null;return u.origin+u.pathname.replace(/\/?$/,'/');}catch{return null;}}
function searchUrl(value:string){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='www.facebook.com'&&u.pathname.startsWith('/marketplace/')&&!/^\/marketplace\/item\//.test(u.pathname);}catch{return false;}}
function locationLabel(value:unknown):SearchLocation|undefined{const label=text(value,100),match=label?.match(/^Vancouver\s*[·•]\s*(\d+(?:\.\d+)?)\s*km$/i)??label?.match(/^Location: Vancouver, British Columbia, Within (\d+(?:\.\d+)?) km$/i),radiusKm=Number(match?.[1]);return label&&match&&radiusKm>0&&radiusKm<=500?{city:'Vancouver',radiusKm,label}:undefined;}
/** Search scope is visible public evidence, never inferred from the URL alone. */
export function facebookSearchLocation(html:string){const $=load(html),main=$(mainSelector);if(main.length!==1)return undefined;const sidebar=$(sidebarSelector).find('[role="button"][aria-label]').map((_,e)=>$(e).attr('aria-label')).get().map(locationLabel).filter((v):v is SearchLocation=>!!v);if(sidebar.length===1)return sidebar[0];const labels=main.find('[role="button"][aria-label]').map((_,e)=>$(e).attr('aria-label')).get().map(locationLabel).filter((v):v is SearchLocation=>!!v);return labels.length===1?labels[0]:undefined;}
function price(value:unknown){const n=typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value)?Number(value):typeof value==='number'?value:NaN;return Number.isFinite(n)&&n>0&&n<1_000_000?n:null;}
function location(value:string){return {city:value.match(/\b(North Vancouver|West Vancouver|New Westminster|Port Moody|Vancouver|Burnaby|Richmond|Coquitlam|Surrey|Calgary|Toronto|Ottawa|Edmonton|Victoria|Kelowna)\b/i)?.[0],area:value.match(/\b(Coal Harbour|West End|Yaletown|Downtown(?: Vancouver)?|Kitsilano|Mount Pleasant|Olympic Village|Fairview)\b/i)?.[0]};}
function visibleCard(url:string,label:string):DiscoveryCard{const prices=[...new Set([...label.matchAll(/\$\s*([\d,]+)(?:\.\d{2})?/g)].map(m=>Number(m[1].replaceAll(',',''))).filter(n=>n>1))];return {url,title:label.slice(0,500),rent:prices.length===1?prices[0]:null,beds:Number(label.match(/\b(\d+)\s*(?:bedrooms?|beds?|br)\b/i)?.[1])||null,...location(label)};}

/** Whitelist public listing-card fields; never retain seller, tracking or account data. */
function listingCard(value:unknown):DiscoveryCard|null{
 if(!value||typeof value!=='object')return null;const row=value as Record<string,any>;
 if(typeof row.id!=='string'||!/^\d+$/.test(row.id))return null;
 const title=text(row.marketplace_listing_title);if(!title)return null;
 const subtitles=Array.isArray(row.custom_sub_titles_with_rendering_flags)?row.custom_sub_titles_with_rendering_flags.slice(0,8).map((s:any)=>text(s?.subtitle)).filter(Boolean).join(' '):'';
 const card:DiscoveryCard={url:'https://www.facebook.com/marketplace/item/'+row.id+'/',title,rent:price(row.listing_price?.amount),beds:Number(title.match(/\b(\d+)\s*(?:bedrooms?|beds?|br)\b/i)?.[1])||null,...location(title+' '+subtitles)};
 const city=text(row.location?.reverse_geocode?.city,100);if(city)card.city=city;
 if(Number.isSafeInteger(row.creation_time)&&row.creation_time>946684800&&row.creation_time<4102444800)card.postedAt=new Date(row.creation_time*1000).toISOString();
 if(row.is_sold===true){card.availability='unavailable';card.availabilityEvidence='Marketplace listing is marked sold';}
 return card;
}
function mergeCards(cards:DiscoveryCard[],extra:DiscoveryCard[]){const found=new Map(cards.map(c=>[c.url,c]));for(const c of extra){const previous=found.get(c.url);found.set(c.url,{...previous,...c,rent:c.rent??previous?.rent,beds:c.beds??previous?.beds,city:c.city??previous?.city,area:c.area??previous?.area,postedAt:c.postedAt??previous?.postedAt});}if(found.size>maxCards)throw Error('Facebook discovery exceeds bounded public card snapshot');return [...found.values()];}
function publicCard(value:unknown,url:string):DiscoveryCard|null{
 if(!value||typeof value!=='object')return null;const row=value as Record<string,unknown>,listing=itemUrl(row.url,url);if(!listing)return null;
 const card:DiscoveryCard={url:listing,title:text(row.title),rent:price(row.rent),beds:typeof row.beds==='number'&&Number.isInteger(row.beds)&&row.beds>=0&&row.beds<=20?row.beds:null,city:text(row.city,100),area:text(row.area,100)};
 if(typeof row.postedAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(row.postedAt)&&Number.isFinite(Date.parse(row.postedAt)))card.postedAt=new Date(row.postedAt).toISOString();
 if(row.availability==='unavailable'){card.availability='unavailable';card.availabilityEvidence='Marketplace listing is marked sold';}
 return card;
}
function escape(value:string){return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}
function renderSnapshot(state:PublicSnapshot){const visible=new Set(state.visibleUrls);return '<!doctype html><html><head><title>Marketplace rental search</title></head><body><main role="main" aria-label="Collection of Marketplace items">'+(state.searchLocation?'<span role="button" aria-label="'+escape(state.searchLocation.label)+'">'+escape(state.searchLocation.label)+'</span>':'')+state.cards.map(c=>'<a href="'+escape(c.url)+'"'+(visible.has(c.url)?' data-af-visible="true"':'')+'>'+escape([c.title,c.rent!=null?'$'+c.rent:'',c.city,c.area].filter(Boolean).join(' '))+'</a>').join('')+'</main><script id="'+snapshotId+'" type="application/json">'+JSON.stringify(state).replaceAll('<','\\u003c')+'</script></body></html>';}

/** Only the observed current Marketplace feed is admissible; recommendations elsewhere are not. */
export function facebookSearchSnapshot(html:string,url:string):FacebookSearchSnapshot{
 const empty={recognized:false,cards:[],visibleUrls:[],hasNext:null} satisfies Omit<FacebookSearchSnapshot,'html'>;
 if(!searchUrl(url))return {...empty,html:renderSnapshot({...empty,url})};
 const $=load(html);const hydrated=$('#'+snapshotId);
 if(hydrated.length)try{
  const state=JSON.parse(hydrated.text());if(state.url!==url||!Array.isArray(state.cards)||state.cards.length>maxCards||!Array.isArray(state.visibleUrls))return {...empty,html:renderSnapshot({...empty,url})};
  const cards=state.cards.map((c:unknown)=>publicCard(c,url)).filter((c:DiscoveryCard|null):c is DiscoveryCard=>!!c),known=new Set(cards.map((c:DiscoveryCard)=>c.url));
  const clean:PublicSnapshot={url,recognized:state.recognized===true,cards,visibleUrls:[...new Set<string>(state.visibleUrls.map((u:unknown)=>itemUrl(u,url)).filter((u:string|null):u is string=>!!u&&known.has(u)))],hasNext:typeof state.hasNext==='boolean'?state.hasNext:null,searchLocation:locationLabel(state.searchLocation?.label)};
  return {...clean,html:renderSnapshot(clean)};
 }catch{return {...empty,html:renderSnapshot({...empty,url})};}
 const main=$(mainSelector);if(main.length!==1)return {...empty,html:renderSnapshot({...empty,url})};
 const visible:DiscoveryCard[]=[];main.find(itemSelector).each((_,node)=>{const a=$(node),u=itemUrl(a.attr('href'),url);if(!u)return;const copy=a.clone();copy.find('*').after(' ');visible.push(visibleCard(u,text(copy.text(),1500)??''));});
 let cards=mergeCards([],visible),hasNext:boolean|null=null;const visibleIds=new Set(cards.map(c=>c.url.match(/item\/(\d+)/)![1]));
 let visited=0;const feeds:Feed[]=[];
 const walk=(value:unknown,depth=0)=>{if(!value||typeof value!=='object'||depth>40||++visited>100000)return;const row=value as Record<string,any>;if(row.viewer?.marketplace_feed_stories&&Array.isArray(row.viewer.marketplace_feed_stories.edges))feeds.push(row.viewer.marketplace_feed_stories);for(const child of Object.values(row))walk(child,depth+1);};
 $('script[type="application/json"]').each((_,node)=>{const body=$(node).text();if(body.length>8_000_000||!body.includes('marketplace_feed_stories'))return;try{walk(JSON.parse(body));}catch{/* Visible cards remain usable when embedded state is unavailable. */}});
 const matching=feeds.filter(feed=>feed.edges.length<=200&&feed.edges.some((edge:any)=>typeof edge?.node?.listing?.id==='string'&&visibleIds.has(edge.node.listing.id)));
 // Ambiguous current feed identity must not merge an unrelated recommendation list.
 if(matching.length===1){const feed=matching[0];cards=mergeCards(cards,feed.edges.map((e:any)=>listingCard(e?.node?.listing)).filter((c):c is DiscoveryCard=>!!c));hasNext=typeof feed.page_info?.has_next_page==='boolean'?feed.page_info.has_next_page:null;}
 const state:PublicSnapshot={url,recognized:true,cards,visibleUrls:[...new Set(visible.map(c=>c.url))],hasNext,searchLocation:facebookSearchLocation(html)};return {...state,html:renderSnapshot(state)};
}

/** One ordinary scroll, accounted before any action. No cursor replay or endpoint synthesis. */
export async function continueFacebookSearch(page:Page,previousHtml:string,url:string,reserve:()=>Promise<void>,check:()=>void){
 check();if(page.url()!==url)throw Error('Facebook continuation changed search scope; inventory remains incomplete');
 const before=facebookSearchSnapshot(previousHtml,url),main=page.locator(mainSelector);
 if(!before.recognized||!before.visibleUrls.length||await main.count()!==1)return {...before,progressed:false,reason:'Facebook current results container unavailable; coverage remains unverified'};
 await reserve();check();
 const last=main.locator(itemSelector).last();await last.scrollIntoViewIfNeeded({timeout:10000});
 const box=await last.boundingBox();if(!box)return {...before,progressed:false,reason:'Facebook final result card is not visible; coverage remains unverified'};
 // The map occupies a separate panel. Wheel over a real result card, never the
 // default mouse position or the main container's centre (which can be the map).
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.wheel(0,2200);await page.waitForTimeout(4000);check();
 if(page.url()!==url)throw Error('Facebook continuation changed search scope; inventory remains incomplete');
 const after=facebookSearchSnapshot(await page.content(),url);
 if(!after.recognized)return {...before,progressed:false,reason:'Facebook results container disappeared; coverage remains unverified'};
 const known=new Set(before.cards.map(c=>c.url)),visible=new Set(before.visibleUrls),progressed=after.cards.some(c=>!known.has(c.url))||after.visibleUrls.some(u=>!visible.has(u));
 // Keep all previously rendered URLs: virtualized cards cycling back into view are not progress.
 const state:PublicSnapshot={url,recognized:true,cards:mergeCards(before.cards,after.cards),visibleUrls:[...new Set([...before.visibleUrls,...after.visibleUrls])],hasNext:after.hasNext,searchLocation:after.searchLocation??before.searchLocation};
 return {...state,html:renderSnapshot(state),progressed,reason:progressed?undefined:'Facebook scroll exposed no additional cards; coverage remains unverified'};
}

/** Choose only a uniquely advertised acceptable preset, never a narrower guessed radius. */
export function preferredFacebookRadius(labels:string[]){for(const km of [4,3,5]){const matches=labels.filter(label=>{const m=label.trim().match(/^(?:Within\s+)?(\d+(?:\.\d+)?)\s*(?:km|kilomet(?:er|re)s?)$/i);return m&&Number(m[1])===km;});if(matches.length>1)return undefined;if(matches.length===1)return {km,label:matches[0]};}return undefined;}

/** Inspect public location controls; applying an observed acceptable preset is opt-in. */
export async function inspectFacebookLocationControls(page:Page,url:string,reserve:()=>Promise<void>,check:()=>void,mode:{apply?:boolean}={}){
 check();if(page.url()!==url)throw Error('Facebook location inspection changed search scope; inventory remains incomplete');
 const main=page.locator(mainSelector);let button=page.locator(sidebarSelector).getByRole('button',{name:/^Location: Vancouver, British Columbia, Within \d+(?:\.\d+)? km$/i});
 const desktopMatches=await button.count();
 if(desktopMatches!==1)button=main.getByRole('button',{name:/^Vancouver\s*·\s*\d+(?:\.\d+)?\s*km$/i});
 const accessibleMatches=await button.count();
 if(accessibleMatches!==1){
  // Facebook's accessibility tree can omit the observed DOM button. Match its exact
  // public aria-label instead; ordinary click actionability still forbids hidden controls.
  const observedLabels=await main.locator('[role="button"][aria-label]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')??'').filter(label=>/^Vancouver\s*·\s*\d+(?:\.\d+)?\s*km$/i.test(label)));
  if(observedLabels.length!==1)return {inspected:false as const,reason:'Observed Vancouver radius control unavailable',accessibleMatches,observedLabels};
  button=main.locator('[role="button"][aria-label="'+observedLabels[0]+'"]');
  if(await button.count()!==1)return {inspected:false as const,reason:'Observed Vancouver radius control is ambiguous',accessibleMatches,observedLabels};
 }
 const searchLocation=locationLabel(await button.getAttribute('aria-label'));if(!searchLocation)return {inspected:false as const,reason:'Observed Vancouver radius label unavailable'};
 if(!await button.isVisible())return {inspected:false as const,searchLocation,reason:'Observed Vancouver radius control is hidden',desktopMatches,accessibleMatches};
 const dialog=page.locator('[role="dialog"]:visible');
 if(await dialog.count())return {inspected:false as const,searchLocation,reason:'An existing dialog prevents scoped location inspection'};
 await reserve();check();
 let attemptedApply=false,applied=false,verifiedRadiusKm:number|undefined,afterUrl=url,reason:string|undefined;
 try{
  await button.click({timeout:10000});await dialog.waitFor({state:'visible',timeout:10000});check();
  if(page.url()!==url||await dialog.count()!==1)throw Error('Facebook location dialog could not be isolated; inventory remains incomplete');
  // The visible modal shell precedes its asynchronously loaded location form.
  const form=dialog.locator('input:not([type="hidden"]),[role="combobox"],select,[role="slider"]').filter({visible:true});
  const formReady=await form.first().waitFor({state:'visible',timeout:12000}).then(()=>true,()=>false);check();
  if(!formReady)return {inspected:false as const,searchLocation,afterUrl:page.url(),reason:'Facebook location form did not render within 12 seconds; approximate search retained'};
  const controls=await dialog.evaluate(root=>{
   // Read only the location/radius dialog. Never serialize the surrounding logged-in page.
   if(!/\b(?:location|radius)\b/i.test((root as HTMLElement).innerText??root.textContent??''))throw Error('Facebook location dialog was not recognized');
   return Array.from(root.querySelectorAll('button,[role="button"],[role="combobox"],[role="slider"],select,option,[role="option"],input')).slice(0,60).flatMap(element=>{
    const role=element.getAttribute('role')??'',tag=element.tagName.toLowerCase(),type=element.getAttribute('type')??'';
    if(tag==='input'&&!['','text','search','range','number','radio','checkbox'].includes(type))return [];
    const labelledBy=(element.getAttribute('aria-labelledby')??'').split(/\s+/).map(id=>root.ownerDocument.getElementById(id)).filter(node=>node&&root.contains(node)).map(node=>node!.textContent).join(' ');
    const label=(element.getAttribute('aria-label')||labelledBy||element.closest('label')?.textContent||element.getAttribute('placeholder')||'').replace(/\s+/g,' ').trim().slice(0,150);
    const labelText=(element.textContent??'').replace(/\s+/g,' ').trim().slice(0,150);
    if((tag==='option'||role==='option')&&!/\b(?:km|kilomet(?:er|re)s?|miles?|meters?|metres?)\b/i.test(labelText))return [];
    const value=element instanceof HTMLInputElement&&['','text','search','range','number'].includes(type)&&(/\b(?:location|radius|distance|search)\b/i.test(label)||['range','number'].includes(type))?element.value.replace(/\s+/g,' ').trim().slice(0,150):undefined;
    return [{tag,role:role||undefined,label:label||undefined,text:labelText||undefined,type:type||undefined,value}];
   });
  });
  // Inspect only an explicitly named Radius field. The opened option labels are
  // observed UI evidence for a later change, never guessed presets or endpoints.
  const radius=dialog.getByRole('combobox',{name:/^Radius(?:\s+[\d.]+\s*(?:km|kilomet(?:er|re)s?|miles?))?$/i});
  let radiusOptions:{kind:'select'|'combobox';labels:string[];observedCount:number}|undefined;
  if(await radius.count()===1){
   const kind=await radius.evaluate(element=>element.tagName.toLowerCase());
   if(kind==='select'){
    const labels=await radius.locator('option').allTextContents();radiusOptions={kind:'select',labels:labels.slice(0,40).map(label=>label.replace(/\s+/g,' ').trim().slice(0,100)),observedCount:labels.length};
    if(mode.apply)reason='Native radius options were inspected; visible option application remains unverified';
   }else{
    const options=page.locator('[role="option"]:visible');
    if(await options.count()===0){
     await reserve();check();await radius.click({timeout:10000});
     await options.first().waitFor({state:'visible',timeout:5000}).catch(()=>{});check();
     const labels=await options.allTextContents();radiusOptions={kind:'combobox',labels:labels.slice(0,40).map(label=>label.replace(/\s+/g,' ').trim().slice(0,100)),observedCount:labels.length};
     const chosen=preferredFacebookRadius(radiusOptions.labels),apply=dialog.getByRole('button',{name:/^Apply$/i});
     if(mode.apply&&chosen&&await apply.count()===1&&await apply.isVisible()){
      const option=page.getByRole('option',{name:chosen.label,exact:true});
      if(await option.count()===1&&await option.isVisible()){
       await reserve();check();await option.click({timeout:10000});
       await options.first().waitFor({state:'hidden',timeout:5000});
       if(await apply.count()===1&&await apply.isVisible()&&await apply.isEnabled()){
        await reserve();check();attemptedApply=true;await apply.click({timeout:10000});
        await dialog.waitFor({state:'hidden',timeout:10000});await page.waitForTimeout(4000);check();afterUrl=page.url();
        for(const selector of [sidebarSelector,mainSelector]){
         const candidates=page.locator(selector).getByRole('button',{name:/^(?:Location: Vancouver, British Columbia, Within \d+(?:\.\d+)? km|Vancouver\s*·\s*\d+(?:\.\d+)?\s*km)$/i});
         if(await candidates.count()===1&&await candidates.isVisible()){const actual=locationLabel(await candidates.getAttribute('aria-label'));if(actual?.radiusKm===chosen.km){applied=true;verifiedRadiusKm=actual.radiusKm;break;}}
        }
        if(!applied)reason='Applied radius could not be verified in the visible Vancouver search label';
       }else reason='Observed Apply control did not become actionable; radius was not applied';
      }else reason='Advertised radius option is ambiguous or hidden; radius was not applied';
     }else if(mode.apply)reason=chosen?'A unique visible Apply control was not available; radius was not applied':'No unique advertised 4 km, 3 km or 5 km preset was available; radius was not applied';
     if(!attemptedApply&&await options.count()){
      await page.keyboard.press('Escape');
      await options.first().waitFor({state:'hidden',timeout:5000});
      if(await options.count())throw Error('Facebook radius options did not close; inventory remains incomplete');
     }
    }
   }
  }
  return {inspected:true as const,searchLocation,controls,radiusOptions,attemptedApply,applied,afterUrl,verifiedRadiusKm,reason};
 }finally{
  // A modal left open would intercept later scrolls; failure to close leaves explicit incomplete work.
  if(await dialog.count()){
   if(await dialog.count()!==1||!await dialog.evaluate(root=>/\b(?:location|radius)\b/i.test((root as HTMLElement).innerText??root.textContent??'')))throw Error('Facebook location dialog changed unexpectedly; inventory remains incomplete');
   await page.keyboard.press('Escape');
   const closed=await dialog.waitFor({state:'hidden',timeout:1500}).then(()=>true,()=>false);
   if(!closed){
    const close=dialog.getByRole('button',{name:/^(?:Close|Cancel)(?: dialog)?$/i});
    if(await dialog.count()===1&&await close.count()===1)await close.click({timeout:3000});
    await dialog.waitFor({state:'hidden',timeout:5000}).catch(()=>{throw Error('Facebook location dialog did not close; inventory remains incomplete');});
   }
  }
  check();if(!attemptedApply&&page.url()!==url||attemptedApply&&!searchUrl(page.url()))throw Error('Facebook location inspection changed search scope; inventory remains incomplete');
 }
}
