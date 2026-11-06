"use client";
import {useEffect,useState} from "react";
import {apiRequest,openAuthenticatedFile} from "@/lib/api";

type Facility={code:string;name:string};
const kampalaDay=(offsetDays=0)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Kampala"}).format(new Date(Date.now()+offsetDays*86400000));
const field="mt-1 w-full border border-slate-300 bg-white px-3 py-2.5 font-normal";

/** Downloads the weighbridge workbook for one facility and period. */
export function WeighbridgeExport(){
  const [facilities,setFacilities]=useState<Facility[]>([]),[facility,setFacility]=useState("BUYALA"),[from,setFrom]=useState(()=>kampalaDay(-7)),[to,setTo]=useState(()=>kampalaDay());
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{apiRequest<{data:Facility[]}>("/api/waste/disposal/facilities").then(result=>setFacilities(result.data)).catch(()=>setFacilities([{code:"BUYALA",name:"Buyala Waste Management Facility"}]))},[]);
  async function download(){
    try{
      setBusy(true);setError("");
      await openAuthenticatedFile(`/api/waste/weighbridge/report.xlsx?facility=${encodeURIComponent(facility)}&from=${from}&to=${to}`,{download:`${facility.toLowerCase()}-weighbridge-${from}-to-${to}.xlsx`});
    }catch(e){setError(e instanceof Error?e.message:"Could not export the report")}finally{setBusy(false)}
  }
  return <section className="mt-7 border border-slate-200 bg-white p-4">
    <h2 className="font-semibold text-slate-950">Export to Excel</h2>
    <p className="mt-1 text-sm text-slate-600">Daily log, summary, vehicles, drivers and the monthly archive, for completed tickets.</p>
    <div className="mt-3 grid items-end gap-3 text-sm sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto]">
      <label className="font-medium">Facility<select value={facility} onChange={e=>setFacility(e.target.value)} className={field}>{facilities.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
      <label className="font-medium">From<input type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)} className={field}/></label>
      <label className="font-medium">To<input type="date" value={to} min={from} max={kampalaDay()} onChange={e=>setTo(e.target.value)} className={field}/></label>
      <button onClick={()=>void download()} disabled={busy||!from||!to} className="bg-[var(--color-action)] px-5 py-2.5 font-semibold text-white disabled:opacity-50">{busy?"Preparing…":"Export Excel"}</button>
    </div>
    {error&&<p className="mt-2 text-sm text-[var(--color-danger)]">{error}</p>}
  </section>;
}
