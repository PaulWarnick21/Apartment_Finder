import {useEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import type {Photo} from './domain';
import {photosForDisplay} from './photo-order';
import {photoUrl,preloadPhotos,warmPhoto} from './photo-loading';

type ApartmentContext={apartmentId:number;rent:number|null;score?:number;grade?:string;quick?:boolean};
export function PhotoGallery({photos,...context}:{photos:Photo[]}&ApartmentContext){
 const [enlarged,setEnlarged]=useState<string|null>(null);
 const gallery=photosForDisplay(photos).filter(p=>p.local);
 return <><div className="photo-grid">{photosForDisplay(photos).map(p=><figure key={p.id}>
  {p.local?<button className="photo-open" aria-label={`Enlarge photo ${p.id}`} onClick={()=>setEnlarged(p.id)}><img loading="lazy" decoding="async" src={photoUrl(p,'card')} alt={p.note||'Apartment photo'} style={{aspectRatio:p.sourceWidth&&p.sourceHeight?`${p.sourceWidth} / ${p.sourceHeight}`:'4 / 3',objectFit:'contain'}}/><span>Enlarge ↗</span></button>:<div className="photo-pending">Photo {p.id} · {p.status}</div>}
  <figcaption>{p.note||(context.quick?'Listing photo · not fully assessed':'Review pending')}</figcaption>
 </figure>)}</div>{enlarged&&gallery.some(p=>p.id===enlarged)&&<PhotoViewer photos={gallery} selectedId={enlarged} select={setEnlarged} close={()=>setEnlarged(null)} {...context}/>}</>;
}
function PhotoViewer({photos,selectedId,select,close,apartmentId,rent,score,grade,quick}:{photos:Photo[];selectedId:string;select:(id:string)=>void;close:()=>void}&ApartmentContext){
 const dialog=useRef<HTMLDialogElement>(null),viewport=useRef<HTMLDivElement>(null);
 const index=photos.findIndex(p=>p.id===selectedId),photo=photos[index];
 // Navigation receives only this apartment's gallery. No wrapping or cross-listing callback.
 const move=(delta:number)=>{const next=photos[index+delta];if(next)select(next.id);};
 const nearby=[photos[index+1],photos[index+2],photos[index-1]].filter((item):item is Photo=>!!item);
 const next=photos[index+1],nextOriginal=next&&(next.sourceBytes??0)<=2_000_000?photoUrl(next,'original'):undefined;
 const nearbyUrls=[...nearby.map(item=>photoUrl(item,'preview')),...(nextOriginal?[nextOriginal]:[])].join('\n');
 useEffect(()=>preloadPhotos(nearbyUrls?nearbyUrls.split('\n'):[]),[nearbyUrls]);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null,modal=dialog.current!;modal.showModal();return()=>{modal.close();previous?.focus({preventScroll:true});};},[]);
 return createPortal(<dialog ref={dialog} className="photo-viewer" aria-label={`Apartment #${apartmentId} enlarged photos`} onCancel={e=>{e.preventDefault();close();}} onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();e.stopPropagation();move(e.key==='ArrowRight'?1:-1);}}}>
  <header className="photo-viewer-toolbar"><div className="photo-apartment-context"><strong>Apartment #{apartmentId}</strong><span>{rent===null?'Rent not listed':new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(rent)+' / month'}</span><b>{quick?`Quick rank ${grade??'pending'}`:score===undefined?'Full scoring pending':`Score ${score.toFixed(1)} / 5`}</b></div><button className="photo-viewer-close" aria-label="Close enlarged photo" onClick={close}>Close ×</button></header>
  <PhotoCanvas photo={photo} viewport={viewport} navigation={<><button aria-label="Previous photo" disabled={index===0} onClick={()=>move(-1)}>← Previous</button><span aria-live="polite">Photo {index+1} of {photos.length}</span><button aria-label="Next photo" disabled={index===photos.length-1} onClick={()=>move(1)}>Next →</button></>}/>
 </dialog>,document.body);
}
type ViewerImage={photoId:string;url:string;kind:'card'|'preview'|'source'|'saved';note:string};
/** Decoded images may arrive out of order; a late preview cannot replace an original,
 * and navigating away invalidates every outstanding result for the old selection. */
export function loadViewerPhoto(photo:Photo,onImage:(image:ViewerImage)=>void,onUnavailable:()=>void,onSourceFailure:()=>void,load:(url:string,signal?:AbortSignal)=>Promise<boolean>=warmPhoto){
 let live=true,priority=0,finished=0;const controller=new AbortController();
 const candidates=[{url:photoUrl(photo,'card'),kind:'card' as const},{url:photoUrl(photo,'preview'),kind:'preview' as const},{url:photoUrl(photo,'original'),kind:photo.sourceLocal?'source' as const:'saved' as const}];
 candidates.forEach((candidate,index)=>{void load(candidate.url,controller.signal).catch(()=>false).then(ok=>{
  if(!live)return;
  finished++;
  if(ok&&index+1>priority){priority=index+1;onImage({photoId:photo.id,...candidate,note:photo.note||'Apartment photo'});}
  if(!ok&&candidate.kind==='source')onSourceFailure();
  if(finished===candidates.length&&!priority){
   // Older installations or a damaged derivative must not hide a valid saved copy.
   if(photo.sourceLocal&&photo.local)void load(photoUrl({local:photo.local},'original'),controller.signal).catch(()=>false).then(saved=>{if(!live)return;if(saved)onImage({photoId:photo.id,url:photoUrl({local:photo.local},'original'),kind:'saved',note:photo.note||'Apartment photo'});else onUnavailable();});
   else onUnavailable();
  }
 });});
 return()=>{live=false;controller.abort();};
}
function PhotoCanvas({photo,viewport,navigation}:{photo:Photo;viewport:RefObject<HTMLDivElement|null>;navigation:ReactNode}){
 const [zoom,setZoom]=useState<number|null>(null),[natural,setNatural]=useState({width:0,height:0}),[size,setSize]=useState({width:0,height:0}),[failed,setFailed]=useState(false),[unavailable,setUnavailable]=useState(false),[displayed,setDisplayed]=useState<ViewerImage|null>(null);
 const selectedKey=[photo.id,photo.local,photo.sourceLocal].join('\n');
 useEffect(()=>{setZoom(null);setFailed(false);setUnavailable(false);viewport.current?.scrollTo(0,0);return loadViewerPhoto(photo,setDisplayed,()=>setUnavailable(true),()=>setFailed(true));},[selectedKey]);
 useEffect(()=>{const stage=viewport.current!;stage.scrollTo(0,0);stage.focus({preventScroll:true});const observer=new ResizeObserver(()=>setSize({width:stage.clientWidth,height:stage.clientHeight}));observer.observe(stage);return()=>observer.disconnect();},[viewport]);
 const fit=natural.width&&size.width?Math.min(1,size.width/natural.width,size.height/natural.height):1,scale=zoom??fit;
 const pending=displayed?.photoId!==photo.id,source=displayed?.kind==='source';
 function changeZoom(value:number|null){setZoom(value);viewport.current?.scrollTo(0,0);}
 return <><div className="photo-viewer-controls"><div className="photo-navigation">{navigation}</div><div className="photo-zoom-controls">
  <button aria-label="Zoom out" disabled={scale<=fit} onClick={()=>changeZoom(Math.max(fit,scale/2))}>−</button><span aria-live="polite">{Math.round(scale*100)}%</span><button aria-label="Zoom in" disabled={scale>=4} onClick={()=>changeZoom(Math.min(4,scale*2))}>+</button><button onClick={()=>changeZoom(1)}>Actual size</button><button onClick={()=>changeZoom(null)}>Fit image</button>
 </div><p className="photo-resolution">{pending?'Loading selected photo…':<>{natural.width>0?`${natural.width} × ${natural.height} pixels · `:''}{source?'Source file — saved without recompression':failed?'Source file unavailable — showing saved preview':photo.sourceLocal?'Saved preview — loading source file':'Saved preview — source-quality copy not yet retrieved'}{scale>1?' · Enlarged beyond native resolution':''}</>}</p></div>
 <div className="photo-viewer-stage" ref={viewport} tabIndex={0} aria-busy={pending&&!unavailable} aria-label="Photo; scroll to examine when zoomed">
  {unavailable?<p role="alert">This saved photo is unavailable. Use Previous or Next to continue.</p>:displayed?<img src={displayed.url} alt={displayed.note} draggable={false} decoding="async" onError={()=>setUnavailable(true)} onLoad={e=>setNatural({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})} style={natural.width?{width:natural.width*scale,height:natural.height*scale}:undefined}/>:<p role="status">Loading photo…</p>}
 </div></>;
}
