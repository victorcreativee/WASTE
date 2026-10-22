"use client";
import dynamic from "next/dynamic";
import {useEffect,useState} from "react";
import {Feedback,Modal} from "@/components/ui/System";
import {apiRequest} from "@/lib/api";
import {Division,currentPosition,readPhoto} from "@/lib/dumping";

const DumpingMap=dynamic(()=>import("@/components/gis/DumpingMap"),{ssr:false,loading:()=><div className="flex h-[260px] items-center justify-center bg-slate-50 text-sm text-slate-500">Loading map…</div>});
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";

/** Report a dumping site: place (current location or a click on the map), landmark, division, what was dumped, a photo. */
export function ReportSiteDialog({open,onClose,onDone}:{open:boolean;onClose:()=>void;onDone:(message:string)=>void}){
  const [divisions,setDivisions]=useState<Division[]>([]),[point,setPoint]=useState<{latitude:number;longitude:number}|null>(null);
  const [photo,setPhoto]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{if(open&&!divisions.length)apiRequest<{data:Division[]}>("/api/waste/dumping/divisions").then(r=>setDivisions(r.data)).catch(()=>undefined)},[open,divisions.length]);

  async function locate(){setError("");try{setPoint(await currentPosition())}catch(e){setError(e instanceof Error?e.message:"Location not available")}}
  async function pickPhoto(file:File|undefined){setError("");if(!file){setPhoto(null);return}try{setPhoto(await readPhoto(file))}catch(e){setError(e instanceof Error?e.message:"The photo could not be used")}}
  function close(){setPoint(null);setPhoto(null);setError("");onClose()}
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!point)return setError("Choose the place: use your location or click the map");
    const form=new FormData(e.currentTarget);setBusy(true);setError("");
    try{
      const r=await apiRequest<{message:string;data:{site_number:string}}>("/api/waste/dumping/reports",{method:"POST",body:JSON.stringify({...point,landmark:form.get("landmark")||undefined,divisionId:form.get("divisionId")||undefined,description:form.get("description"),photo:photo||undefined})});
      setPoint(null);setPhoto(null);onDone(`${r.message}: ${r.data.site_number}.`);
    }catch(err){setError(err instanceof Error?err.message:"Could not send the report")}finally{setBusy(false)}
  }

  return <Modal open={open} title="Report illegal dumping" description="Mark the exact place. A report within 75 m of a site already reported is added to that site." onClose={close}>
    <form onSubmit={submit} className="grid gap-4 text-sm">
      {error&&<Feedback tone="error">{error}</Feedback>}
      <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="font-medium text-slate-700">Place</p><button type="button" onClick={()=>void locate()} className="min-h-0 border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700">Use my current location</button></div>
        <div className="overflow-hidden border border-slate-200"><DumpingMap picked={point} onPick={(latitude,longitude)=>setPoint({latitude,longitude})} height={260}/></div>
        <p className="mt-1 text-xs text-slate-500">{point?`${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`:"Click the map where the waste is."}</p></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="font-medium text-slate-700">Landmark<input name="landmark" maxLength={300} placeholder="e.g. behind Nakawa market footbridge" className={field}/></label>
        <label className="font-medium text-slate-700">Division<select name="divisionId" className={field}><option value="">Not sure</option>{divisions.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      </div>
      <label className="font-medium text-slate-700">What was dumped<textarea name="description" required minLength={5} rows={3} placeholder="What kind of waste, roughly how much, and when it appeared." className={field}/></label>
      <label className="font-medium text-slate-700">Photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e=>void pickPhoto(e.target.files?.[0])} className="mt-1 block w-full text-sm font-normal"/></label>
      {photo&&<img src={photo} alt="Selected photo" className="max-h-40 w-auto border border-slate-200"/>}
      <div className="flex justify-end gap-2"><button type="button" onClick={close} className="border border-slate-300 px-4 py-2.5 font-medium text-slate-700">Cancel</button><button disabled={busy} className="bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">{busy?"Sending…":"Send report"}</button></div>
    </form>
  </Modal>;
}
