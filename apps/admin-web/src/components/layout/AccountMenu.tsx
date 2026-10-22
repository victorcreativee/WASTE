"use client";
import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import {Modal} from "@/components/ui/System";

type Props={name:string;email:string;initials:string;context:string;variant:"sidebar"|"compact"};

/**
 * Ends the session on the server (or every session), then clears every stored credential and returns to sign-in.
 * The server call is best-effort with a short timeout: an offline device still signs out locally.
 */
async function signOut(everywhere:boolean){
  const accessToken=sessionStorage.getItem("accessToken"),refreshToken=sessionStorage.getItem("refreshToken");
  if(accessToken&&accessToken!=="offline-local-session"){
    const controller=new AbortController(),timer=window.setTimeout(()=>controller.abort(),4000);
    await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL??""}/api/auth/logout`,{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json",Authorization:`Bearer ${accessToken}`},body:JSON.stringify({refreshToken:refreshToken||undefined,everywhere})}).catch(()=>undefined);
    window.clearTimeout(timer);
  }
  try{await window.kwmsDesktop?.offlineLogout()}catch{/* browser cleanup must still complete if desktop IPC is unavailable */}
  for(const store of [sessionStorage,localStorage])for(const key of ["accessToken","refreshToken","currentUser"])store.removeItem(key);
  window.location.replace("/login?signedOut=1");
}

export function AccountMenu({name,email,initials,context,variant}:Props){
  const [open,setOpen]=useState(false),[confirming,setConfirming]=useState(false),[signingOut,setSigningOut]=useState(false),[unsynced,setUnsynced]=useState(0),[everywhere,setEverywhere]=useState(false);
  const root=useRef<HTMLDivElement>(null);

  useEffect(()=>{
    if(!open)return;
    const close=(event:MouseEvent|KeyboardEvent)=>{
      if(event instanceof KeyboardEvent?event.key==="Escape":!root.current?.contains(event.target as Node))setOpen(false);
    };
    document.addEventListener("mousedown",close);document.addEventListener("keydown",close);
    return()=>{document.removeEventListener("mousedown",close);document.removeEventListener("keydown",close)};
  },[open]);

  async function askToSignOut(){
    setOpen(false);
    const state=await window.kwmsDesktop?.getState().catch(()=>null);
    setUnsynced((state?.pendingCount||0)+(state?.failedCount||0));
    setConfirming(true);
  }

  async function confirm(){setSigningOut(true);await signOut(everywhere);}

  const avatar=(size:string)=><span aria-hidden="true" className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 ring-1 ring-slate-200`}>{initials}</span>;

  return <div ref={root} className="relative">
    {variant==="sidebar"
      ?<button onClick={()=>setOpen(value=>!value)} aria-haspopup="menu" aria-expanded={open} className="flex w-full min-h-0 items-center gap-3 p-2 text-left hover:bg-slate-50">
        {avatar("h-9 w-9")}
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold leading-5 text-slate-900">{name}</span><span className="block truncate text-xs leading-4 text-slate-500">{email}</span></span>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-slate-400"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg>
      </button>
      :<button onClick={()=>setOpen(value=>!value)} aria-haspopup="menu" aria-expanded={open} aria-label="Account" className="flex min-h-0 items-center justify-center rounded-full p-0.5 hover:bg-slate-100">{avatar("h-8 w-8")}</button>}

    {open&&<div role="menu" className={`anim-fade absolute z-40 w-64 rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white py-1 shadow-[var(--ui-shadow-lg)] ${variant==="sidebar"?"bottom-full left-0 mb-2":"right-0 top-full mt-2"}`}>
      <div className="border-b border-slate-100 px-3 py-2.5"><p className="truncate text-sm font-semibold text-slate-900">{name}</p><p className="truncate text-xs text-slate-500">{email}</p><p className="mt-1 text-xs text-slate-400">{context}</p></div>
      <Link role="menuitem" href="/dashboard/account" onClick={()=>setOpen(false)} className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">My account</Link>
      <Link role="menuitem" href="/dashboard/notifications" onClick={()=>setOpen(false)} className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">Notifications</Link>
      <button role="menuitem" onClick={()=>void askToSignOut()} className="block w-full min-h-0 rounded-none px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">Sign out</button>
    </div>}

    <Modal open={confirming} onClose={()=>{if(!signingOut)setConfirming(false)}} title="Sign out?" description={`You are signed in as ${email}.`}>
      {unsynced>0&&<div className="feedback feedback-warning !mt-0 mb-4"><div>{unsynced} offline change{unsynced===1?" has":"s have"} not reached the server yet. They stay saved on this computer and will sync the next time someone signs in here, but nobody else can see them until then.</div></div>}
      <p className="text-sm text-slate-600">On a shared computer, always sign out when you finish so the next person cannot use your account.</p>
      <label className="mt-4 flex items-start gap-3 text-sm text-slate-700"><input type="checkbox" checked={everywhere} onChange={e=>setEverywhere(e.target.checked)} className="mt-0.5 h-4 w-4"/><span>Sign out on all my devices<span className="block text-xs text-slate-500">Use this if you signed in somewhere you no longer control.</span></span></label>
      <div className="mt-6 flex justify-end gap-2">
        <button onClick={()=>setConfirming(false)} disabled={signingOut} className="border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Stay signed in</button>
        <button onClick={()=>void confirm()} disabled={signingOut} autoFocus className="inline-flex items-center gap-2 bg-[var(--color-action)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-70">
          {signingOut&&<span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-r-transparent"/>}{signingOut?"Signing out…":"Sign out"}
        </button>
      </div>
    </Modal>
  </div>;
}
