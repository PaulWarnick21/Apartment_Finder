import test from 'node:test';import assert from 'node:assert/strict';
import {facebookSearchSnapshot,facebookSearchLocation,continueFacebookSearch,inspectFacebookLocationControls,preferredFacebookRadius} from '../server/facebook-discovery.ts';
import {discoveryCards} from '../server/source-discovery.ts';import {sourceById} from '../server/sources.ts';
const url='https://www.facebook.com/marketplace/vancouver/propertyrentals/';
const item=(id:number)=>'https://www.facebook.com/marketplace/item/'+id+'/';
function feed(ids:number[],visible=ids,hasNext=true){return '<html><body><nav>Private notification with account-secret <a href="'+item(999)+'">Personal saved listing</a></nav><div role="main" aria-label="Collection of Marketplace items">'+visible.map(id=>'<a href="'+item(id)+'?tracking=private"><span>1 Bed 1 Bath Apartment</span><span>$2,400</span><span>Vancouver, BC</span></a>').join('')+'</div><script type="application/json">'+JSON.stringify({require:[{__bbox:{result:{data:{viewer:{accountEmail:'private@example.test',marketplace_feed_stories:{edges:ids.map(id=>({cursor:'secret-cursor',node:{tracking:'private-tracking',listing:{id:String(id),marketplace_listing_title:'1 Bed 1 Bath Apartment',listing_price:{amount:'2400.00'},location:{reverse_geocode:{city:'Vancouver',state:'BC',city_page:{id:'private-profile'}}},creation_time:1791308346,marketplace_listing_seller:{id:'private-seller',name:'Private name'}}}})),page_info:{has_next_page:hasNext,end_cursor:'secret-cursor'}}}}}}}]})+'</script></body></html>';}
test('Facebook parses all observed feed edges while excluding other account/navigation data',()=>{
 const state=facebookSearchSnapshot(feed([1,2,3],[1,2]),url);
 assert.equal(state.recognized,true);assert.equal(state.hasNext,true);assert.deepEqual(state.cards.map(c=>c.url),[item(1),item(2),item(3)]);assert.equal(state.visibleUrls.length,2);
 assert.equal(state.cards[2].rent,2400);assert.equal(state.cards[2].beds,1);assert.equal(state.cards[2].city,'Vancouver');assert.equal(state.cards[2].postedAt,'2026-10-06T17:39:06.000Z');
 for(const secret of ['private','Private','secret-cursor','accountEmail','marketplace_listing_seller','tracking',item(999)])assert.ok(!state.html.includes(secret),secret);
 assert.deepEqual(discoveryCards(state.html,sourceById('facebook'),url),state.cards);
 assert.equal(discoveryCards(state.html,sourceById('facebook'),url+'?radius=3').length,0,'sanitized cards are bound to the original configured URL');
});
test('Facebook rejects unrelated embedded feeds, absent current results and untrusted item URLs',()=>{
 const unrelated=feed([7,8],[1]);assert.deepEqual(facebookSearchSnapshot(unrelated,url).cards.map(c=>c.url),[item(1)]);
 assert.equal(facebookSearchSnapshot(feed([1]).replace('Collection of Marketplace items','Notifications'),url).recognized,false);
 assert.equal(facebookSearchSnapshot('<a href="'+item(1)+'">1 Bed Vancouver</a>',url).cards.length,0);
 assert.equal(facebookSearchSnapshot(feed([1]),'https://untrusted.test/marketplace/search/').cards.length,0);
 const injected=feed([1]).replace('</div>','<a href="https://evil.test/marketplace/item/2/">Fake</a></div>');assert.equal(facebookSearchSnapshot(injected,url).cards.length,1);
});
test('visible Facebook radius remains public search-scope evidence through sanitization',()=>{
 const raw=feed([1]).replace('<div role="main" aria-label="Collection of Marketplace items">','<div role="main" aria-label="Collection of Marketplace items"><div role="button" aria-label="Vancouver · 72 km">Vancouver · 72 km</div>');
 assert.deepEqual(facebookSearchLocation(raw),{city:'Vancouver',radiusKm:72,label:'Vancouver · 72 km'});
 const snapshot=facebookSearchSnapshot(raw,url);assert.equal(snapshot.searchLocation?.radiusKm,72);assert.equal(facebookSearchLocation(snapshot.html)?.radiusKm,72);assert.equal(facebookSearchSnapshot(snapshot.html,url).searchLocation?.radiusKm,72);
});
function browser(html:string,changeUrl=false){let wheel=0,moved=false;const page:any={url:()=>changeUrl&&wheel?url+'?location=elsewhere':url,locator:()=>({count:async()=>1,locator:()=>({last:()=>({scrollIntoViewIfNeeded:async()=>{},boundingBox:async()=>({x:200,y:100,width:200,height:300})})})}),mouse:{move:async(x:number,y:number)=>{assert.equal(x,300);assert.equal(y,250);moved=true;},wheel:async()=>{assert.equal(moved,true,'wheel is directed at a real result card');wheel++;}},waitForTimeout:async()=>{},content:async()=>html};return {page,wheels:()=>wheel};}
test('one accounted ordinary scroll merges cards and retains growth despite virtualized old cards',async()=>{
 const before=facebookSearchSnapshot(feed([1,2,3],[1,2]),url),b=browser(feed([1,2,3],[3,4]));let spent=0;
 const result=await continueFacebookSearch(b.page,before.html,url,async()=>{spent++;},()=>{});
 assert.equal(spent,1);assert.equal(b.wheels(),1);assert.equal(result.progressed,true);assert.deepEqual(result.cards.map(c=>c.url),[item(1),item(2),item(3),item(4)]);
 assert.ok(!result.html.includes('account-secret'));assert.equal('end' in result,false,'a scroll never proves catalogue exhaustion');
 const revealed=await continueFacebookSearch(browser(feed([1,2,3],[2,3])).page,before.html,url,async()=>{},()=>{});assert.equal(revealed.progressed,true,'revealing embedded cards is forward scroll progress');
 const cycled=await continueFacebookSearch(browser(feed([1,2,3],[1,2])).page,revealed.html,url,async()=>{},()=>{});assert.equal(cycled.progressed,false,'previously rendered virtualized cards are not new progress');
});
test('no-progress remains unverified and exhausted budget prevents any scroll',async()=>{
 const html=feed([1]),b=browser(html);const unchanged=await continueFacebookSearch(b.page,html,url,async()=>{},()=>{});assert.equal(unchanged.progressed,false);assert.match(unchanged.reason!,/unverified/);
 const blocked=browser(html);await assert.rejects(()=>continueFacebookSearch(blocked.page,html,url,async()=>{throw Error('page cap reached');},()=>{}),/page cap/);assert.equal(blocked.wheels(),0);
 await assert.rejects(()=>continueFacebookSearch(browser(html,true).page,html,url,async()=>{},()=>{}),/changed search scope/);
 const missing=browser(html);const result=await continueFacebookSearch(missing.page,'<body>Log in</body>',url,async()=>{throw Error('must not spend');},()=>{});assert.equal(result.progressed,false);assert.equal(missing.wheels(),0);
});
function locationBrowser(stuck=false,accessible=true,hasRadius=false,closeFallback=false,display:{desktop?:boolean;mainVisible?:boolean;apply?:boolean;labels?:string[];afterUrl?:string;hideApply?:boolean;formMissing?:boolean}={}){
 let open=false,dropdown=false,clicks=0,currentRadius=72,pendingRadius=72,currentUrl=url,optionClicks=0;const labels=display.labels??['3 km','5 km','72 km'];
 const options={count:async()=>dropdown?labels.length:0,allTextContents:async()=>dropdown?labels:[],first:()=>({waitFor:async({state}:{state:string})=>{if((state==='visible')!==dropdown)throw Error('option state mismatch');}})};
 const radius={count:async()=>hasRadius?1:0,evaluate:async()=> 'div',click:async()=>{dropdown=true;}};
 const close={count:async()=>closeFallback?1:0,click:async()=>{open=false;dropdown=false;}};
 const apply={count:async()=>display.apply?1:0,isVisible:async()=>!display.hideApply,isEnabled:async()=>true,click:async()=>{currentRadius=pendingRadius;currentUrl=display.afterUrl??url;open=false;}};
 const dialog={count:async()=>open?1:0,locator:()=>({filter:()=>({first:()=>({waitFor:async()=>{if(display.formMissing)throw Error('form unavailable');}})})}),getByRole:(_role:string,options:{name:RegExp})=>options.name.test('Close')?close:options.name.test('Apply')?apply:radius,waitFor:async({state}:{state:string})=>{if((state==='visible')!==open)throw Error('dialog state mismatch');},evaluate:async()=>[{tag:'input',label:'Location',type:'text',value:'Vancouver, British Columbia'},{tag:'div',role:'combobox',label:'Radius',text:'72 km'}]};
 const button={count:async()=>1,isVisible:async()=>display.mainVisible!==false,getAttribute:async()=> 'Vancouver · '+currentRadius+' km',click:async()=>{clicks++;open=true;}};
 const desktop={...button,isVisible:async()=>true,getAttribute:async()=> 'Location: Vancouver, British Columbia, Within '+currentRadius+' km'};
 return {clicks:()=>clicks,optionClicks:()=>optionClicks,open:()=>open,currentRadius:()=>currentRadius,page:{url:()=>currentUrl,waitForTimeout:async()=>{},getByRole:(_role:string,{name}:{name:string})=>({count:async()=>dropdown?labels.filter(l=>l===name).length:0,isVisible:async()=>dropdown,click:async()=>{optionClicks++;pendingRadius=Number(name.match(/\d+/)![0]);dropdown=false;}}),locator:(selector:string)=>selector.includes('[role="dialog"]')?dialog:selector.includes('[role="option"]')?options:selector.includes('Marketplace sidebar')?{getByRole:()=>display.desktop?desktop:{count:async()=>0}}:{getByRole:()=>accessible?button:{count:async()=>0},locator:(s:string)=>s==='[role="button"][aria-label]'?{evaluateAll:async()=>['Vancouver · 72 km']}:button},keyboard:{press:async(key:string)=>{assert.equal(key,'Escape');if(!stuck){if(dropdown)dropdown=false;else open=false;}}}} as any};
}
test('location inspection spends once and closes its scoped public dialog before continuing',async()=>{
 const b=locationBrowser();let spent=0;const result=await inspectFacebookLocationControls(b.page,url,async()=>{spent++;},()=>{});assert.equal(result.inspected,true);assert.equal(result.searchLocation?.radiusKm,72);assert.equal(spent,1);assert.equal(b.clicks(),1);assert.equal(b.open(),false);
 const stopped=locationBrowser();await assert.rejects(()=>inspectFacebookLocationControls(stopped.page,url,async()=>{throw Error('page cap reached');},()=>{}),/page cap/);assert.equal(stopped.clicks(),0);
 await assert.rejects(()=>inspectFacebookLocationControls(locationBrowser(true).page,url,async()=>{},()=>{}),/did not close/);
 const fallback=locationBrowser(true,true,false,true);assert.equal((await inspectFacebookLocationControls(fallback.page,url,async()=>{},()=>{})).inspected,true);assert.equal(fallback.open(),false,'a unique scoped Close control preserves captured evidence when Escape is unsupported');
 const dom=locationBrowser(false,false);assert.equal((await inspectFacebookLocationControls(dom.page,url,async()=>{},()=>{})).inspected,true);assert.equal(dom.clicks(),1,'exact observed DOM label remains usable when absent from the accessibility tree');
});
test('radius option inspection reads actual advertised labels with one additional accounted action and applies nothing',async()=>{
 const b=locationBrowser(false,true,true);let spent=0;const result=await inspectFacebookLocationControls(b.page,url,async()=>{spent++;},()=>{});assert.equal(result.inspected,true);assert.deepEqual(result.radiusOptions,{kind:'combobox',labels:['3 km','5 km','72 km'],observedCount:3});assert.equal(spent,2);assert.equal(b.open(),false);assert.equal(result.searchLocation?.radiusKm,72);
});
test('desktop location control is preferred and a hidden mobile control is never clicked',async()=>{
 const desktop=locationBrowser(false,true,false,false,{desktop:true,mainVisible:false});const result=await inspectFacebookLocationControls(desktop.page,url,async()=>{},()=>{});assert.equal(result.inspected,true);assert.equal(result.searchLocation?.label,'Location: Vancouver, British Columbia, Within 72 km');
 const hidden=locationBrowser(false,false,false,false,{mainVisible:false});const unavailable=await inspectFacebookLocationControls(hidden.page,url,async()=>{throw Error('must not spend on hidden control');},()=>{});assert.equal(unavailable.inspected,false);assert.equal(hidden.clicks(),0);assert.match(unavailable.reason!,/hidden/);
});
test('radius choice uses only unique advertised 4, 3 or 5 km options and never narrows below 3 km',()=>{
 assert.deepEqual(preferredFacebookRadius(['2 km','5 km','4 kilometers','3 km']),{km:4,label:'4 kilometers'});assert.equal(preferredFacebookRadius(['3 km','5 km'])?.km,3);assert.equal(preferredFacebookRadius(['2 km','5 km'])?.km,5);assert.equal(preferredFacebookRadius(['1 km','2 km','10 km']),undefined);assert.equal(preferredFacebookRadius(['4 km','4 kilometers','3 km']),undefined);
});
test('opt-in radius application accounts each action, verifies the visible label and returns an observed changed URL',async()=>{
 const afterUrl=url+'?radius=4',b=locationBrowser(false,true,true,false,{desktop:true,apply:true,labels:['2 km','3 km','4 km','5 km','72 km'],afterUrl});let spent=0;
 const result=await inspectFacebookLocationControls(b.page,url,async()=>{spent++;},()=>{},{apply:true});assert.equal(result.applied,true);assert.equal(result.verifiedRadiusKm,4);assert.equal(result.afterUrl,afterUrl);assert.equal(spent,4);assert.equal(b.currentRadius(),4);assert.equal(b.open(),false);
});
test('ambiguous or hidden radius application controls leave preferences unchanged',async()=>{
 for(const display of [{labels:['2 km','10 km']},{labels:['3 km','3 kilometers','5 km']},{labels:['4 km'],hideApply:true}]){
  const b=locationBrowser(false,true,true,false,{desktop:true,apply:true,...display});const result=await inspectFacebookLocationControls(b.page,url,async()=>{},()=>{},{apply:true});assert.equal(result.applied,false);assert.equal(b.currentRadius(),72);assert.equal(b.optionClicks(),0);assert.equal(b.open(),false);
 }
});
test('an empty location modal shell is explicitly incomplete and is dismissed without applying',async()=>{
 const b=locationBrowser(false,true,false,false,{desktop:true,formMissing:true});const result=await inspectFacebookLocationControls(b.page,url,async()=>{},()=>{},{apply:true});assert.equal(result.inspected,false);assert.match(result.reason!,/form did not render/);assert.equal(b.currentRadius(),72);assert.equal(b.open(),false);
});
