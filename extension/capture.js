// Runs in Chrome's isolated world, only after the local app grants one capture.
// No fetch, clicks, scrolling, form values, cookies or page script execution.
export function capturePage(){
 if(location.origin!=='https://www.apartments.com')throw new Error('Open the Apartments.com listing first');
 const visibleText=document.body?.innerText??'';
 // Availability text inside a listing is not evidence that website access failed.
 // Explicit security/rate-limit challenges still stop, including overlays on a listing.
 const challenge=visibleText.match(/access denied|unusual traffic|verify (?:that )?you are human|too many requests|press (?:and|&) hold/i);
 const outageHeading=/^(?:(?:the |this )?(?:site|website|service) (?:is )?)?(?:temporarily unavailable|service unavailable)[.!\s]*$/i;
 const outage=[document.title,document.querySelector('h1')?.textContent??'',visibleText.trim().split('\n')[0]??''].find(t=>outageHeading.test(t.trim()));
 const matched=challenge?.[0]??outage;
 const warning=matched?`Apartments.com access warning: ${matched.trim().slice(0,160)}. Page evidence retained for diagnosis.`:null;
 const warningAt=challenge?.index??(outage?Math.max(0,visibleText.indexOf(outage)):0);
 const warningEvidence=warning?visibleText.slice(Math.max(0,warningAt-200),warningAt+1800):undefined;
 const root=document.querySelector('#profileApp')??document.querySelector('main')??document.body;
 const clone=root.cloneNode(true);
 // A listing's own header contains its price and core facts: preserve it.
 clone.querySelectorAll('script,style,iframe,form,input,textarea,select,button,nav,footer,#mainHeader,#profileFooter,#profileFooterWrapper,#nearbySection,#modalContactLead,#contactLead,#officeHoursSection,#mapSection,#rentalDetailContainer,#sharingModal,#applyNowLeadForm,#contactContainer,[hidden],[aria-hidden="true"]').forEach(n=>n.remove());
 for(const el of [clone,...clone.querySelectorAll('*')])for(const a of [...el.attributes])if(!['id','class','href','src','srcset','alt','data-src','data-original','itemprop','content'].includes(a.name))el.removeAttribute(a.name);
 // Strip query strings from outbound links; keep image URLs as evidence only.
 for(const el of clone.querySelectorAll('a[href]')){try{const u=new URL(el.getAttribute('href'),location.href);el.setAttribute('href',u.origin+u.pathname);}catch{el.removeAttribute('href');}}
 const imageMap=new Map();
 const addImage=(raw,alt='',width=0,height=0)=>{if(!raw)return;try{const u=new URL(raw,location.href);if(u.protocol==='https:'&&!u.username&&!u.password&&/^images\d+\.apartments\.com$/.test(u.hostname)&&u.pathname.startsWith('/i2/')&&(!imageMap.has(u.href)||width>imageMap.get(u.href).width))imageMap.set(u.href,{url:u.href,alt:alt.slice(0,1000),width:Math.min(width,100000),height:Math.min(height,100000)});}catch{}};
 const addResponsive=el=>{for(const part of (el.getAttribute('srcset')??'').split(',')){const m=part.trim().match(/^(\S+)\s+(\d+)w$/);if(m)addImage(m[1],el.alt??'',Number(m[2]),0);}};
 for(const el of root.querySelectorAll('img')){
  if(el.closest('#nearbySection,nav,footer,#mainHeader,#profileFooter'))continue;
  for(const raw of [el.currentSrc,el.src,el.getAttribute('data-src'),el.getAttribute('data-original')])addImage(raw,el.alt??'',el.naturalWidth||0,el.naturalHeight||0);
  addResponsive(el);
 }
 // Read only image references already present in the listing gallery DOM.
 // No remote URLs are constructed, fetched or loaded by this enumeration.
 const active=document.querySelector('#rentalDetailContainer #activeMedia');
 const viewing=active&&active.getClientRects().length>0;
 if(viewing)imageMap.clear(); // Exclude separate building/map previews from this unit's gallery.
 const imageSelector=viewing?'#rentalDetailContainer #activeMedia,#rentalDetailContainer #activeMedia *':'#gallerySection *,#carouselSection *,#profileMediaViewer *';
 for(const el of document.querySelectorAll(imageSelector)){
  addResponsive(el);
  if(el.id==='activeMedia'||el.closest('#activeMedia'))for(const raw of [el.currentSrc,el.src,el.getAttribute('src')])addImage(raw,el.alt??'',el.naturalWidth||0,el.naturalHeight||0);
  for(const name of ['content','data-src','data-original','data-image','data-image-url','href'])addImage(el.getAttribute(name));
  for(const match of (el.getAttribute('style')??'').matchAll(/url\(["']?([^"')]+)["']?\)/g))addImage(match[1]);
 }
 const gallery=document.querySelector('#carouselPillPhotosLink')?.textContent??'';
 const count=gallery.match(/(\d+)\s*photos?/i);
 const text=clone.textContent??'',html=clone.outerHTML;
 return {url:location.origin+location.pathname,title:document.title.slice(0,1000),text:text.slice(0,150000),html:html.slice(0,1000000),images:[...imageMap.values()].slice(0,500),advertisedPhotos:count?Number(count[1]):null,galleryComplete:false,warning,...(warningEvidence?{warningEvidence}:{}),truncated:text.length>150000||html.length>1000000||imageMap.size>500};
}
