import {useEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import type {Photo} from './domain';
import {photosForDisplay} from './photo-order';

type ApartmentContext={apartmentId:number;rent:number|null;score:number};
export function PhotoGallery({photos,...context}:{photos:Photo[]}&ApartmentContext){
 const [enlarged,setEnlarged]=useState<string|null>(null);
 const gallery=photosForDisplay(photos).filter(p=>p.local);
 return <><div className="photo-grid">{photosForDisplay(photos).map(p=><figure key={p.id}>
  {p.local?<button className="photo-open" aria-label={`Enlarge photo ${p.id}`} onClick={()=>setEnlarged(p.id)}><img src={'/media/'+p.local} alt={p.note||'Apartment photo'}/><span>Enlarge ↗</span></button>:<div className="photo-pending">Photo {p.id} · {p.status}</div>}
  <figcaption>{p.note||'Review pending'}</figcaption>
 </figure>)}</div>{enlarged&&gallery.some(p=>p.id===enlarged)&&<PhotoViewer photos={gallery} selectedId={enlarged} select={setEnlarged} close={()=>setEnlarged(null)} {...context}/>}</>;
}
function PhotoViewer({photos,selectedId,select,close,apartmentId,rent,score}:{photos:Photo[];selectedId:string;select:(id:string)=>void;close:()=>void}&ApartmentContext){
 const dialog=useRef<HTMLDialogElement>(null),viewport=useRef<HTMLDivElement>(null);
 const index=photos.findIndex(p=>p.id===selectedId),photo=photos[index];
 // Navigation receives only this apartment's gallery. No wrapping or cross-listing callback.
 const move=(delta:number)=>{const next=photos[index+delta];if(next)select(next.id);};
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null,modal=dialog.current!;modal.showModal();return()=>{modal.close();previous?.focus({preventScroll:true});};},[]);
 return createPortal(<dialog ref={dialog} className="photo-viewer" aria-label={`Apartment #${apartmentId} enlarged photos`} onCancel={e=>{e.preventDefault();close();}} onKeyDown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();e.stopPropagation();move(e.key==='ArrowRight'?1:-1);}}}>
  <header className="photo-viewer-toolbar"><div className="photo-apartment-context"><strong>Apartment #{apartmentId}</strong><span>{rent===null?'Rent not listed':new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD',maximumFractionDigits:0}).format(rent)+' / month'}</span><b>Score {score.toFixed(1)} / 5</b></div><button className="photo-viewer-close" aria-label="Close enlarged photo" onClick={close}>Close ×</button></header>
  <PhotoCanvas key={photo.id} photo={photo} viewport={viewport} navigation={<><button aria-label="Previous photo" disabled={index===0} onClick={()=>move(-1)}>← Previous</button><span aria-live="polite">Photo {index+1} of {photos.length}</span><button aria-label="Next photo" disabled={index===photos.length-1} onClick={()=>move(1)}>Next →</button></>}/>
 </dialog>,document.body);
}
function PhotoCanvas({photo,viewport,navigation}:{photo:Photo;viewport:RefObject<HTMLDivElement|null>;navigation:ReactNode}){
 const [zoom,setZoom]=useState<number|null>(null),[natural,setNatural]=useState({width:0,height:0}),[size,setSize]=useState({width:0,height:0}),[failed,setFailed]=useState(false),[unavailable,setUnavailable]=useState(false);
 useEffect(()=>{const stage=viewport.current!;stage.scrollTo(0,0);stage.focus({preventScroll:true});const observer=new ResizeObserver(()=>setSize({width:stage.clientWidth,height:stage.clientHeight}));observer.observe(stage);return()=>observer.disconnect();},[viewport]);
 const fit=natural.width&&size.width?Math.min(1,size.width/natural.width,size.height/natural.height):1,scale=zoom??fit;
 const source=!!photo.sourceLocal&&!failed;
 function changeZoom(value:number|null){setZoom(value);viewport.current?.scrollTo(0,0);}
 return <><div className="photo-viewer-controls"><div className="photo-navigation">{navigation}</div><div className="photo-zoom-controls">
  <button aria-label="Zoom out" disabled={scale<=fit} onClick={()=>changeZoom(Math.max(fit,scale/2))}>−</button><span aria-live="polite">{Math.round(scale*100)}%</span><button aria-label="Zoom in" disabled={scale>=4} onClick={()=>changeZoom(Math.min(4,scale*2))}>+</button><button onClick={()=>changeZoom(1)}>Actual size</button><button onClick={()=>changeZoom(null)}>Fit image</button>
 </div><p className="photo-resolution">{natural.width>0?`${natural.width} × ${natural.height} pixels · `:''}{source?'Source file — saved without recompression':failed?'Source file unavailable — showing saved preview':'Saved preview — source-quality copy not yet retrieved'}{scale>1?' · Enlarged beyond native resolution':''}</p></div>
 <div className="photo-viewer-stage" ref={viewport} tabIndex={0} aria-label="Photo; scroll to examine when zoomed">
  {unavailable?<p role="alert">This saved photo is unavailable. Use Previous or Next to continue.</p>:<img key={source?'source':'preview'} src={'/media/'+(source?photo.sourceLocal:photo.local)} alt={photo.note||'Apartment photo'} draggable={false} onError={()=>{setNatural({width:0,height:0});if(source)setFailed(true);else setUnavailable(true);}} onLoad={e=>setNatural({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})} style={natural.width?{width:natural.width*scale,height:natural.height*scale}:undefined}/>}
 </div></>;
}
