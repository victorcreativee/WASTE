"use client";
import {useCallback,useEffect,useState} from "react";
import {apiRequest,openAuthenticatedFile} from "@/lib/api";

type Mine={notice:{version:number;title:string;body:string;change_summary:string|null;raw_point_days:number};
  consent:{state:"granted"|"declined"|"withdrawn"|"outdated"|"not_asked";notice_version:number|null;decided_at:string|null};
  data:{points:number;first_at:string|null;last_at:string|null;trips:number}};

const day=(iso:string|null)=>iso?new Date(iso).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"Africa/Kampala"}):"—";

/** The driver's GPS notice and consent (migration 114). Reports whether location may be shared during trips. */
export function LocationConsent({onChange}:{onChange:(granted:boolean)=>void}){
  const [mine,setMine]=useState<Mine|null>(null),[reading,setReading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const load=useCallback(async()=>{
    try{const data=(await apiRequest<{data:Mine}>("/api/waste/privacy/gps/mine")).data;setMine(data);onChange(data.consent.state==="granted")}
    catch(e){setError(e instanceof Error?e.message:"Could not load your location settings")}
  },[onChange]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);

  async function answer(decision:"granted"|"declined"|"withdrawn"){
    if(!mine)return;setBusy(true);setError("");
    try{await apiRequest("/api/waste/privacy/gps/consent",{method:"POST",body:JSON.stringify({decision,noticeVersion:mine.notice.version})});setReading(false);await load()}
    catch(e){setError(e instanceof Error?e.message:"Could not save your answer")}finally{setBusy(false)}
  }
  async function download(){
    try{await openAuthenticatedFile("/api/waste/privacy/gps/mine/export",{download:"my-location-data.csv"})}
    catch(e){setError(e instanceof Error?e.message:"Could not download your data")}
  }
  if(!mine)return error?<p className="mt-6 text-sm text-red-700">{error}</p>:null;
  const {consent,notice,data}=mine,asking=consent.state==="not_asked"||consent.state==="outdated"||reading;

  return <section className="mt-6 border border-slate-300 bg-white">
    {asking?<div className="p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Location notice · version {notice.version}</p>
      <h2 className="mt-1 text-lg font-semibold text-slate-950">{notice.title}</h2>
      {consent.state==="outdated"&&notice.change_summary&&<p className="mt-2 border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900">What changed: {notice.change_summary}. Location sharing is paused until you answer.</p>}
      <div className="mt-3 max-h-72 overflow-y-auto whitespace-pre-line text-sm leading-6 text-slate-700">{notice.body}</div>
      <p className="mt-3 text-sm text-slate-700">Positions are deleted after <strong>{notice.raw_point_days} days</strong>.</p>
      {error&&<p className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button disabled={busy} onClick={()=>void answer("granted")} className="bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">Allow during trips</button>
        <button disabled={busy} onClick={()=>void answer(consent.state==="granted"||consent.state==="outdated"?"withdrawn":"declined")} className="border border-slate-300 px-4 py-2.5 text-sm text-slate-700 disabled:opacity-60">{consent.state==="granted"||consent.state==="outdated"?"Stop sharing":"Not now"}</button>
        {reading&&<button onClick={()=>setReading(false)} className="px-2 py-2.5 text-sm text-slate-500">Close</button>}
      </div>
    </div>:<div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
      <div>
        <p className="font-semibold text-slate-900">{consent.state==="granted"?"Location sharing during trips is on":"Location sharing is off"}</p>
        <p className="text-xs text-slate-500">{consent.state==="granted"?`Agreed ${day(consent.decided_at)} · `:"Dispatch cannot see your truck during trips · "}{data.points.toLocaleString("en-GB")} positions stored{data.first_at?` since ${day(data.first_at)}`:""} · deleted after {notice.raw_point_days} days</p>
        {error&&<p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {data.points>0&&<button onClick={()=>void download()} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Download my data</button>}
        <button onClick={()=>setReading(true)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Read notice</button>
        {consent.state==="granted"?<button disabled={busy} onClick={()=>void answer("withdrawn")} className="border border-slate-300 px-3 py-2 text-xs text-slate-700 disabled:opacity-60">Turn off</button>
          :<button disabled={busy} onClick={()=>void answer("granted")} className="bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">Turn on</button>}
      </div>
    </div>}
  </section>;
}
