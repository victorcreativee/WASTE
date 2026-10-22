"use client";
import {useEffect,type ReactNode} from "react";

export function PageHeader({eyebrow,title,description,action}:{eyebrow?:string;title:string;description?:string;action?:ReactNode}){return <header className="page-header"><div className="min-w-0">{eyebrow&&<p className="page-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description&&<p className="page-description">{description}</p>}</div>{action&&<div className="page-action">{action}</div>}</header>}
export function Feedback({tone="info",children}:{tone?:"info"|"success"|"warning"|"error";children:ReactNode}){return <div role={tone==="error"?"alert":"status"} className={`feedback feedback-${tone}`}><div className="min-w-0">{children}</div></div>}
export function EmptyState({title,description,action}:{title:string;description?:string;action?:ReactNode}){return <div className="empty-state"><p className="font-semibold text-slate-800">{title}</p>{description&&<p className="mx-auto max-w-md">{description}</p>}{action&&<div className="mt-4">{action}</div>}</div>}
export function Status({value}:{value:string}){return <span className={`status status-${value.toLowerCase().replaceAll("_","-")}`}>{value.replaceAll("_"," ")}</span>}
export function SectionHeading({title,description,action}:{title:string;description?:string;action?:ReactNode}){return <div className="section-heading"><div><h2>{title}</h2>{description&&<p>{description}</p>}</div>{action}</div>}
export function Card({className="",children}:{className?:string;children:ReactNode}){return <div className={`card ${className}`}>{children}</div>}
export function Stat({label,value,hint}:{label:string;value:ReactNode;hint?:ReactNode}){return <div className="card p-5"><p className="stat-label">{label}</p><p className="stat-value">{value}</p>{hint&&<p className="mt-2 text-xs text-slate-500">{hint}</p>}</div>}

export function Modal({open,title,description,onClose,children}:{open:boolean;title:string;description?:string;onClose:()=>void;children:ReactNode}){
  useEffect(()=>{
    if(!open)return;
    const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose()};
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    window.addEventListener("keydown",onKey);
    return()=>{window.removeEventListener("keydown",onKey);document.body.style.overflow=previousOverflow};
  },[open,onClose]);
  if(!open)return null;
  return <div className="anim-fade fixed inset-0 z-[2000] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 py-[6vh]" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section role="dialog" aria-modal="true" aria-labelledby="modal-title" className="anim-rise w-full max-w-2xl overflow-hidden rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white shadow-[var(--ui-shadow-lg)]">
      <header className="flex items-start justify-between gap-5 border-b border-slate-100 px-6 py-5"><div><h2 id="modal-title" className="text-lg font-semibold text-slate-950">{title}</h2>{description&&<p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>}</div><button type="button" onClick={onClose} aria-label="Close dialog" className="-mr-2 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></header>
      <div className="p-6">{children}</div>
    </section>
  </div>;
}
