"use client";
import Link from "next/link";
import {useCallback,useEffect,useRef,useState} from "react";
import {apiRequest} from "@/lib/api";

export type AppNotification={id:string;category:string;severity:"info"|"warning"|"critical";title:string;body:string;link:string|null;read_at:string|null;created_at:string};

export const SEVERITY_MARK={info:"bg-slate-300",warning:"bg-[var(--color-warning)]",critical:"bg-[var(--color-danger)]"};

export function timeAgo(iso:string){
  const minutes=Math.round((Date.now()-new Date(iso).getTime())/60000);
  if(minutes<1)return "just now";if(minutes<60)return `${minutes} min ago`;
  const hours=Math.round(minutes/60);if(hours<24)return `${hours} h ago`;
  const days=Math.round(hours/24);return days<7?`${days} d ago`:new Date(iso).toLocaleDateString("en-GB",{day:"numeric",month:"short"});
}

/** Top-bar bell: unread count (refreshed every minute and when the tab regains focus) and the latest notifications. */
export function NotificationBell(){
  const [unread,setUnread]=useState(0),[open,setOpen]=useState(false),[items,setItems]=useState<AppNotification[]|null>(null);
  const root=useRef<HTMLDivElement>(null);

  const refresh=useCallback(()=>{apiRequest<{data:{unread:number}}>("/api/waste/notifications/unread-count").then(r=>setUnread(r.data.unread)).catch(()=>undefined)},[]);
  useEffect(()=>{
    const first=window.setTimeout(refresh,0),timer=window.setInterval(refresh,60_000);
    const onFocus=()=>{if(document.visibilityState==="visible")refresh()};
    document.addEventListener("visibilitychange",onFocus);
    return()=>{window.clearTimeout(first);window.clearInterval(timer);document.removeEventListener("visibilitychange",onFocus)};
  },[refresh]);
  useEffect(()=>{
    if(!open)return;
    const close=(event:MouseEvent|KeyboardEvent)=>{if(event instanceof KeyboardEvent?event.key==="Escape":!root.current?.contains(event.target as Node))setOpen(false)};
    document.addEventListener("mousedown",close);document.addEventListener("keydown",close);
    return()=>{document.removeEventListener("mousedown",close);document.removeEventListener("keydown",close)};
  },[open]);

  async function toggle(){
    const next=!open;setOpen(next);
    if(next){setItems(null);try{setItems((await apiRequest<{data:AppNotification[]}>("/api/waste/notifications?limit=8")).data)}catch{setItems([])}}
  }
  async function markAll(){
    await apiRequest("/api/waste/notifications/read",{method:"POST",body:JSON.stringify({all:true})}).catch(()=>undefined);
    setUnread(0);setItems(list=>list?.map(n=>({...n,read_at:n.read_at||new Date().toISOString()}))??null);
  }
  async function openItem(n:AppNotification){
    setOpen(false);
    if(!n.read_at){setUnread(count=>Math.max(0,count-1));await apiRequest("/api/waste/notifications/read",{method:"POST",body:JSON.stringify({ids:[n.id]})}).catch(()=>undefined);}
  }

  return <div ref={root} className="relative">
    <button onClick={()=>void toggle()} aria-label={unread?`Notifications, ${unread} unread`:"Notifications"} aria-haspopup="dialog" aria-expanded={open} className="relative flex h-9 w-9 min-h-0 items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-800">
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
      {unread>0&&<span className="absolute right-0.5 top-0.5 min-w-4 rounded-[3px] bg-[var(--color-danger)] px-1 text-[10px] font-semibold leading-4 text-white tabular-nums">{unread>99?"99+":unread}</span>}
    </button>
    {open&&<div role="dialog" aria-label="Notifications" className="anim-fade absolute right-0 top-full z-40 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white shadow-[var(--ui-shadow-lg)]">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5"><p className="text-sm font-semibold text-slate-900">Notifications</p>{unread>0&&<button onClick={()=>void markAll()} className="min-h-0 p-0 text-xs font-medium text-[var(--color-action)] hover:underline">Mark all as read</button>}</div>
      <div className="max-h-[60vh] overflow-y-auto">
        {items===null?<p className="px-4 py-6 text-center text-sm text-slate-500">Loading…</p>:items.length?<ul className="divide-y divide-slate-100">{items.map(n=><li key={n.id}>
          <Link href={n.link||"/dashboard/notifications"} onClick={()=>void openItem(n)} className={`flex gap-3 px-4 py-3 hover:bg-slate-50 ${n.read_at?"":"bg-[var(--color-action-soft)]/40"}`}>
            <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 ${SEVERITY_MARK[n.severity]}`}/>
            <span className="min-w-0"><span className={`block text-sm ${n.read_at?"text-slate-700":"font-semibold text-slate-900"}`}>{n.title}</span><span className="mt-0.5 line-clamp-2 block text-xs text-slate-500">{n.body}</span><span className="mt-1 block text-[11px] text-slate-400">{timeAgo(n.created_at)}</span></span>
          </Link></li>)}</ul>:<p className="px-4 py-8 text-center text-sm text-slate-500">You&rsquo;re all caught up.</p>}
      </div>
      <Link href="/dashboard/notifications" onClick={()=>setOpen(false)} className="block border-t border-slate-100 px-4 py-2.5 text-center text-sm font-medium text-[var(--color-action)] hover:bg-slate-50">All notifications and settings</Link>
    </div>}
  </div>;
}
