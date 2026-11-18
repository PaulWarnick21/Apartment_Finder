import {useEffect,useRef,useState,type ReactNode} from 'react';
import type {Photo} from './domain';
import {isWindowView,photosForDisplay} from './photo-order';
import {photoUrl,preloadPhotos,warmPhoto} from './photo-loading';

/** Browse saved photos without opening the apartment or changing its review state. */
export function CardPhotos({photos,apartmentId,fallback,demo=false}:{photos:Photo[];apartmentId:number;fallback:ReactNode;demo?:boolean}){
 const gallery=photosForDisplay(photos).filter(photo=>photo.local);
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const container=useRef<HTMLDivElement>(null);
 const [visible,setVisible]=useState(false),[displayed,setDisplayed]=useState<{id:string;url:string}|null>(null);
 const gesture=useRef<{id:number;x:number;y:number;vertical:boolean}|null>(null);
 const index=Math.max(0,gallery.findIndex(photo=>photo.id===selectedId));
 const photo=gallery[index];
 const requested=photo?photoUrl(photo,'card'):'';
 const neighbours=[gallery[index+1],gallery[index-1],gallery[index+2]].filter(Boolean).map(p=>photoUrl(p,'card')).join('\n');
 useEffect(()=>{
  const element=container.current;if(!element)return;
  if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
  const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{rootMargin:'120px'});
  observer.observe(element);return()=>observer.disconnect();
 },[!!photo]);
 useEffect(()=>{
  if(!visible||!photo)return;
  const controller=new AbortController();
  void warmPhoto(requested,controller.signal).then(ready=>{
   if(!controller.signal.aborted)setDisplayed({id:photo.id,url:ready?requested:'/media/'+photo.local});
  });
  return()=>controller.abort();
 },[visible,requested,photo?.id]);
 useEffect(()=>{if(visible)return preloadPhotos(neighbours.split('\n'));},[visible,neighbours]);
 const move=(direction:number)=>{
  const next=gallery[Math.max(0,Math.min(gallery.length-1,index+direction))];
  if(next)setSelectedId(next.id);
 };
 if(!photo)return <>{fallback}<span className="image-label">{demo?'Demo illustration':'Photos not collected'}</span></>;
 const shown=gallery.find(item=>item.id===displayed?.id)??photo;
 const showing=displayed&&shown.id===displayed.id?displayed.url:requested;
 const loading=visible&&!!displayed&&displayed.id!==photo.id;
 return <div ref={container} className="card-photos" role="group" aria-label={`Apartment ${apartmentId} photos`} aria-busy={loading}
  onKeyDown={event=>{
   if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
   event.preventDefault();event.stopPropagation();move(event.key==='ArrowLeft'?-1:1);
  }}
  onPointerDown={event=>{
   if(!event.isPrimary){gesture.current=null;return;}
   if(event.pointerType==='mouse'||(event.target as HTMLElement).closest('button'))return;
   gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,vertical:false};
   event.currentTarget.setPointerCapture(event.pointerId);
  }}
  onPointerMove={event=>{
   const start=gesture.current;
   if(!start||start.id!==event.pointerId)return;
   const dx=Math.abs(event.clientX-start.x),dy=Math.abs(event.clientY-start.y);
   if(dy>10&&dy>dx)start.vertical=true;
  }}
  onPointerUp={event=>{
   const start=gesture.current;gesture.current=null;
   if(!start||start.id!==event.pointerId||start.vertical)return;
   const dx=event.clientX-start.x,dy=event.clientY-start.y;
   if(Math.abs(dx)>=40&&Math.abs(dx)>Math.abs(dy)*1.5)move(dx<0?1:-1);
  }}
  onPointerCancel={()=>{gesture.current=null;}}
  onLostPointerCapture={()=>{gesture.current=null;}}>
  <img loading="lazy" decoding="async" draggable={false} src={showing} alt={shown.note||`Apartment ${apartmentId} · photo ${gallery.indexOf(shown)+1}`}/>
  <span className="image-label">{isWindowView(shown)?'Window view':'Listing photo'}</span>
  {loading&&<span className="card-photo-loading">Loading photo…</span>}
  {gallery.length>1&&<>
   <button type="button" className="card-photo-arrow card-photo-previous" aria-label={`Previous photo of apartment ${apartmentId}`} disabled={index===0} onClick={()=>move(-1)}><span aria-hidden="true">‹</span></button>
   <button type="button" className="card-photo-arrow card-photo-next" aria-label={`Next photo of apartment ${apartmentId}`} disabled={index===gallery.length-1} onClick={()=>move(1)}><span aria-hidden="true">›</span></button>
   <span className="card-photo-count" role="status" aria-live="polite" aria-atomic="true"><span className="card-photo-sr-only">Photo </span>{index+1} / {gallery.length}</span>
  </>}
 </div>;
}
