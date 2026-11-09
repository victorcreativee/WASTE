"use client";
import {useCallback,useEffect,useState,useSyncExternalStore} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {API_BASE_URL,apiRequest} from "@/lib/api";
import {useHasRole} from "@/lib/session";
import {dateTime} from "@/lib/receipts";

type Tracker={id:string;label:string;serial_number:string|null;key_prefix:string;truck_id:string;plate_number:string;created_by_name:string|null;created_at:string;
  last_seen_at:string|null;last_result:string|null;retired_at:string|null;retired_by_name:string|null;retired_reason:string|null;
  stored_today:number;no_trip_today:number;no_consent_today:number;rejected_today:number;stored_7d:number};
type Truck={id:string;plate_number:string};

const RESULT:Record<string,string>={stored:"Position kept",duplicate:"Repeat of a kept position",no_trip:"Truck not on a trip",no_consent:"Driver has not agreed to location sharing",rejected:"Outside Kampala, or the time was wrong"};
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";
const noSubscribe=()=>()=>undefined;
const SILENT_MINUTES=15;

export default function TrackersPage(){
  const companyAdmin=useHasRole("company_admin");
  const url=useSyncExternalStore(noSubscribe,()=>`${API_BASE_URL||window.location.origin}/api/v1/trackers/osmand`,()=>"/api/v1/trackers/osmand");
  const [data,setData]=useState<{trackers:Tracker[];trucksWithoutTracker:Truck[]}|null>(null),[loadedAt,setLoadedAt]=useState(0),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [creating,setCreating]=useState(false),[issued,setIssued]=useState<{key:string;label:string;plate:string}|null>(null),[retiring,setRetiring]=useState<Tracker|null>(null);
  const load=useCallback(async()=>{
    try{setData((await apiRequest<{data:{trackers:Tracker[];trucksWithoutTracker:Truck[]}}>("/api/waste/fleet/trackers")).data);setLoadedAt(Date.now())}
    catch(e){setError(e instanceof Error?e.message:"Could not load the trackers")}
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  const silent=(t:Tracker)=>!t.last_seen_at||loadedAt-new Date(t.last_seen_at).getTime()>SILENT_MINUTES*60000;

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow="Service delivery" title="GPS trackers"
      description="Truck trackers keep a trip tracked when the driver’s phone drops."
      action={companyAdmin&&data?.trucksWithoutTracker.length?<button onClick={()=>setCreating(true)} className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white">Register tracker</button>:undefined}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}

    <section className="rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white p-4 text-sm">
      <p className="font-semibold text-slate-900">Setting up a tracker</p>
      <p className="mt-1 text-slate-600">Send positions over HTTP in the OsmAnd protocol (tracker or Traccar Client app):</p>
      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
        <dt className="text-slate-500">Server URL</dt><dd className="break-all font-mono text-[12.5px] text-slate-800">{url}</dd>
        <dt className="text-slate-500">Device identifier</dt><dd>The device key shown when the tracker is registered (<span className="font-mono text-[12.5px]">kwt_…</span>)</dd>
        <dt className="text-slate-500">Interval</dt><dd>Every 30 to 60 seconds. Positions stored while offline are accepted for 24 hours.</dd>
      </dl>
      <p className="mt-3 text-xs text-slate-500">Teltonika or Concox trackers need a gateway such as a Traccar server.</p>
    </section>

    <section>
      <h2 className="mb-3 text-lg font-semibold text-slate-950">Trackers</h2>
      {data===null?<p className="py-6 text-sm text-slate-500">Loading trackers…</p>:data.trackers.length?<div className="table-wrap"><table className="w-full min-w-[1000px] text-left">
        <thead><tr><th>Tracker</th><th>Truck</th><th>Last heard</th><th className="text-right">Kept today</th><th className="text-right">Not kept today</th><th className="text-right">Kept, 7 days</th><th/></tr></thead>
        <tbody>{data.trackers.map(t=>{const dropped=t.no_trip_today+t.no_consent_today+t.rejected_today;return <tr key={t.id} className={t.retired_at?"text-slate-400":""}>
          <td><p className="table-primary">{t.label}</p><p className="table-secondary"><span className="font-mono">kwt_{t.key_prefix}_…</span>{t.serial_number?` · ${t.serial_number}`:""}</p></td>
          <td>{t.plate_number}</td>
          <td>{t.retired_at?<><p className="text-[var(--color-danger)]">Retired {dateTime(t.retired_at)}</p><p className="table-secondary">{t.retired_by_name}: {t.retired_reason}</p></>
            :t.last_seen_at?<><p className={silent(t)?"text-[var(--color-warning)]":""}>{dateTime(t.last_seen_at)}</p><p className="table-secondary">{RESULT[t.last_result??""]??t.last_result}</p></>
            :<span className="text-[var(--color-warning)]">Never</span>}</td>
          <td className="text-right tabular-nums">{t.stored_today.toLocaleString("en-GB")}</td>
          <td className="text-right tabular-nums">{dropped?<span title={`Not on a trip ${t.no_trip_today} · driver not agreed ${t.no_consent_today} · rejected ${t.rejected_today}`}>{dropped.toLocaleString("en-GB")}</span>:"0"}
            {t.no_consent_today>0&&<p className="table-secondary text-[var(--color-warning)]">{t.no_consent_today} driver not agreed</p>}</td>
          <td className="text-right tabular-nums">{t.stored_7d.toLocaleString("en-GB")}</td>
          <td className="text-right">{companyAdmin&&!t.retired_at&&<button onClick={()=>setRetiring(t)} className="border border-red-300 px-3 py-2 text-xs font-semibold text-red-700">Retire</button>}</td>
        </tr>})}</tbody>
      </table></div>:<EmptyState title="No trackers registered" description={companyAdmin?"Register a tracker for each truck that has one fitted. Trucks without a tracker are tracked by the driver’s phone only.":"Your company administrator registers trackers."}/>}
      <p className="mt-2 text-xs text-slate-500">Not kept: sent while the truck was not on a trip, while the trip’s driver had not agreed to location sharing, or with a position outside Kampala or a wrong time. A tracker that has not been heard for {SILENT_MINUTES} minutes is shown in amber.</p>
    </section>

    {companyAdmin&&data&&<CreateDialog open={creating} trucks={data.trucksWithoutTracker} onClose={()=>setCreating(false)} onCreated={async issued=>{setCreating(false);setIssued(issued);setError("");await load()}}/>}
    <Modal open={Boolean(issued)} title="Copy the device key now" description="Shown once. Enter it as the tracker’s device ID." onClose={()=>setIssued(null)}>
      {issued&&<div className="grid gap-3 text-sm">
        <p className="font-medium text-slate-900">{issued.label} · {issued.plate}</p>
        <code className="block break-all border border-slate-300 bg-slate-50 px-3 py-2.5 font-mono text-[13px]">{issued.key}</code>
        <div className="flex gap-2">
          <button onClick={()=>void navigator.clipboard?.writeText(issued.key).then(()=>setNotice("Device key copied."))} className="bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white">Copy key</button>
          <button onClick={()=>setIssued(null)} className="border border-slate-300 px-4 py-2.5 text-slate-700">I have entered it</button>
        </div>
      </div>}
    </Modal>
    <RetireDialog tracker={retiring} onClose={()=>setRetiring(null)} onDone={async message=>{setRetiring(null);setNotice(message);setError("");await load()}}/>
  </div></AppShell>;
}

function CreateDialog({open,trucks,onClose,onCreated}:{open:boolean;trucks:Truck[];onClose:()=>void;onCreated:(issued:{key:string;label:string;plate:string})=>Promise<void>}){
  const [error,setError]=useState(""),[saving,setSaving]=useState(false);
  async function submit(form:FormData){
    setSaving(true);setError("");
    const serial=String(form.get("serialNumber")??"").trim();
    try{
      const r=await apiRequest<{data:{key:string;label:string;plate_number:string}}>("/api/waste/fleet/trackers",{method:"POST",body:JSON.stringify({truckId:form.get("truckId"),label:form.get("label"),...(serial?{serialNumber:serial}:{})})});
      await onCreated({key:r.data.key,label:r.data.label,plate:r.data.plate_number});
    }catch(e){setError(e instanceof Error?e.message:"Could not register the tracker")}finally{setSaving(false)}
  }
  return <Modal open={open} title="Register a tracker" description="One tracker per truck. The key is shown once." onClose={()=>!saving&&onClose()}>
    <form key={String(open)} onSubmit={e=>{e.preventDefault();void submit(new FormData(e.currentTarget))}} className="grid gap-4 text-sm">
      <label className="font-medium">Truck<select name="truckId" required className={field}>{trucks.map(t=><option key={t.id} value={t.id}>{t.plate_number}</option>)}</select></label>
      <label className="font-medium">Name<input name="label" required minLength={2} maxLength={80} className={field} placeholder="Teltonika FMB920"/></label>
      <label className="font-medium">Serial number or IMEI <span className="font-normal text-slate-500">(optional)</span><input name="serialNumber" minLength={3} maxLength={40} className={field}/></label>
      {error&&<p className="text-[var(--color-danger)]">{error}</p>}
      <button disabled={saving} className="bg-[var(--color-action)] px-4 py-3 font-semibold text-white disabled:opacity-50">{saving?"Registering…":"Register tracker"}</button>
    </form>
  </Modal>;
}

function RetireDialog({tracker,onClose,onDone}:{tracker:Tracker|null;onClose:()=>void;onDone:(m:string)=>Promise<void>}){
  const [error,setError]=useState(""),[saving,setSaving]=useState(false);
  async function submit(reason:string){
    if(!tracker)return;setSaving(true);setError("");
    try{await onDone((await apiRequest<{message:string}>(`/api/waste/fleet/trackers/${tracker.id}/retire`,{method:"POST",body:JSON.stringify({reason})})).message)}
    catch(e){setError(e instanceof Error?e.message:"Could not retire the tracker")}finally{setSaving(false)}
  }
  return <Modal open={Boolean(tracker)} title="Retire tracker" description={tracker?`${tracker.label} on ${tracker.plate_number}. Its positions are refused at once. This cannot be undone; register the tracker again to get a new key.`:""} onClose={()=>!saving&&onClose()}>
    <form key={tracker?.id} onSubmit={e=>{e.preventDefault();void submit(String(new FormData(e.currentTarget).get("reason")))}} className="grid gap-4 text-sm">
      <label className="font-medium">Reason<input name="reason" required minLength={5} maxLength={300} className={field} placeholder="Tracker removed, moved to another truck, key exposed…"/></label>
      {error&&<p className="text-[var(--color-danger)]">{error}</p>}
      <button disabled={saving} className="bg-red-700 px-4 py-3 font-semibold text-white disabled:opacity-50">{saving?"Retiring…":"Retire tracker"}</button>
    </form>
  </Modal>;
}
