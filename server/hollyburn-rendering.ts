import type {Page} from 'playwright';

/** Wait on the observed search app, never navigate or infer empty inventory. */
export async function waitForHollyburnSearch(page:Page,url:string,check:()=>void,timeoutMs=15000){
 const parsed=new URL(url);
 if(parsed.origin!=='https://www.hollyburn.com'||!/^\/find-an-apartment\/?$/.test(parsed.pathname))return false;
 check();
 try{
  await page.waitForFunction(()=>{
   const app=document.getElementById('find_appartment_app');
   if(!app||app.querySelector('.loading-container'))return false;
   return Array.from(app.querySelectorAll('a[href]')).some(link=>{
    try{const target=new URL(link.getAttribute('href')??'',location.href);return target.origin===location.origin&&/^\/building\/[^/]+\/$/.test(target.pathname);}catch{return false;}
   });
  },undefined,{timeout:Math.min(15000,Math.max(1,timeoutMs))});
  check();return true;
 }catch(error){
  check();
  if(error instanceof Error&&error.name==='TimeoutError')return false;
  throw error;
 }
}
