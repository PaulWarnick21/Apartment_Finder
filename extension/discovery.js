// Runs in the isolated page world; listing links and pagination remain separate.
export function captureApartmentDiscovery(){
 const links=[...new Set([...document.querySelectorAll('a[href]')].map(a=>a.href).filter(h=>/^https:\/\/www\.apartments\.com\/[^/]+\/[a-z0-9]{7}\/$/.test(h)))].slice(0,500);
 const anchors=[...document.querySelectorAll('a[href]')];
 const candidate=anchors.find(a=>a.rel==='next'||/next(?: page)?/i.test(a.getAttribute('aria-label')??'')||/^next\s*[›»→]?$/i.test(a.textContent.trim()));
 let next=null;try{const u=new URL(candidate?.href??'',location.href);if(u.origin===location.origin&&u.href!==location.href&&!links.includes(u.href)&&/\/\d+\/$/.test(u.pathname))next=u.href;}catch{}
 return {links,next};
}
