// Runs in an isolated world. Read only the matching property's public listing
// fields; never return the full application cache, account data, or form values.
export function captureZillow(){
 if(location.origin!=='https://www.zillow.com')throw new Error('Unexpected Zillow origin');
 const body=document.body?.innerText??'';
 const warning=/access denied|unusual traffic|verify (?:that )?you are human|too many requests|temporarily unavailable|press (?:and|&) hold|please verify you.re a human/i.test(body)?'Zillow shows an access warning; source paused.':null;
 const links=[...new Set([...document.querySelectorAll('a[href]')].map(a=>{try{const u=new URL(a.href);return u.origin===location.origin&&/^\/homedetails\/[^/]+\/\d+_zpid\/$/.test(u.pathname)?u.origin+u.pathname:null;}catch{return null;}}).filter(Boolean))].slice(0,500);
 const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 let html='<main>'+links.map(url=>`<a href="${escape(url)}">Rental listing</a>`).join('')+'</main>',images=[],advertisedPhotos=null,galleryComplete=false,text='Zillow rental search';
 const nextLink=document.querySelector('a[rel="next"],a[aria-label="Next page"],a[title="Next page"]');
 if(nextLink?.href){try{const next=new URL(nextLink.href);if(next.origin===location.origin&&!next.username&&!next.password)html+=`<a rel="next" href="${escape(next.href)}">Next page</a>`;}catch{}}
 const id=location.pathname.match(/\/(\d+)_zpid\//)?.[1];
 if(!id&&!warning){
  // Key names only, bounded to the public search subtree. Never copy account data,
  // cookies, CSRF values or the surrounding application state into diagnostics.
  try{
   const data=JSON.parse(document.querySelector('#__NEXT_DATA__')?.textContent??'{}'),pp=data.props?.pageProps;
   const keyPaths=[];const walk=(value,path,depth)=>{if(depth>4||keyPaths.length>=100||!value||typeof value!=='object')return;for(const key of Object.keys(value).slice(0,40)){if(keyPaths.length>=100)break;keyPaths.push(path+'.'+key);if(!Array.isArray(value[key]))walk(value[key],path+'.'+key,depth+1);}};
   walk(pp?.searchPageState,'searchPageState',0);
   html+='<script id="af-zillow-search-keys" type="application/json">'+JSON.stringify({pagePropKeys:Object.keys(pp??{}).slice(0,40),searchKeyPaths:keyPaths}).replaceAll('<','\\u003c')+'</script>';
  }catch{}
 }
 if(id&&!warning){
  let cache;try{const next=JSON.parse(document.querySelector('#__NEXT_DATA__')?.textContent??'{}');const raw=next.props?.pageProps?.componentProps?.gdpClientCache;cache=typeof raw==='string'?JSON.parse(raw):raw;}catch{}
  const found=Object.values(cache??{}).map(v=>v?.property).find(p=>String(p?.zpid)===id);
  if(!found)throw new Error('Zillow listing data not available; no partial gallery claimed');
  const property={};
  for(const key of ['zpid','streetAddress','city','state','price','bedrooms','bathrooms','livingArea','description','homeStatus'])property[key]=found[key];
  property.neighborhoodRegion={name:found.neighborhoodRegion?.name};
  property.resoFacts={};for(const key of ['laundryFeatures','leaseTerm','furnished'])property.resoFacts[key]=found.resoFacts?.[key];
  const photoUrl=raw=>{try{const u=new URL(raw);return u.origin==='https://photos.zillowstatic.com'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
  property.originalPhotos=(found.originalPhotos??[]).map(p=>({mixedSources:{jpeg:(p.mixedSources?.jpeg??[]).map(im=>({url:photoUrl(im.url),width:Number(im.width)||0,height:Number(im.height)||0})).filter(im=>im.url)}}));
  advertisedPhotos=found.responsivePhotos?.length??found.originalPhotos?.length??null;
  property.responsivePhotos=Array.from({length:Math.min(advertisedPhotos??0,10000)},()=>({}));
  images=property.originalPhotos.map(p=>[...p.mixedSources.jpeg].sort((a,b)=>b.width-a.width)[0]).filter(Boolean).map(im=>({...im,alt:''}));
  galleryComplete=images.length>0&&images.length===advertisedPhotos;
  const next={props:{pageProps:{componentProps:{gdpClientCache:JSON.stringify({target:{property}})}}}};
  html='<script id="__NEXT_DATA__" type="application/json">'+JSON.stringify(next).replaceAll('<','\\u003c')+'</script>';
  text=String(property.description??'');
 }
 const truncated=html.length>1000000||text.length>150000||images.length>500;
 return {url:location.origin+location.pathname,title:document.title.slice(0,1000),html:html.slice(0,1000000),text:text.slice(0,150000),images:images.slice(0,500),advertisedPhotos,galleryComplete:galleryComplete&&!truncated,warning,truncated,links};
}
