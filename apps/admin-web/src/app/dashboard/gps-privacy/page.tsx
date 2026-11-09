"use client";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {apiRequest} from "@/lib/api";
import {useHasRole} from "@/lib/session";
import {dateTime} from "@/lib/receipts";

type State="granted"|"declined"|"withdrawn"|"outdated"|"not_asked";
type Overview={
  notice:{version:number;title:string;body:string;change_summary:string|null;published_at:string;raw_point_days:number};
  notices:{version:number;title:string;change_summary:string|null;published_at:string;published_by_name:string|null}[];
  settings:{raw_point_days:number;updated_at:string;updated_by_name:string|null};
  consents:{organization_id:string;organization_name:string;drivers:number;granted:number;refused:number;waiting:number}[];
  drivers:{id:string;full_name:string;phone:string|null;status:string;state:State;notice_version:number|null;decided_at:string|null}[]|null;
  holds:{id:string;reason:string;placed_by_name:string;placed_by_kcca:boolean;placed_at:string;released_at:string|null;released_by_name:string|null;release_note:string|null;
    trip_number:string;route_date:string;plate_number:string|null;organization_name:string;points:number}[];
  runs:{ran_at:string;raw_point_days:number;cutoff:string;deleted_points:number;held_points:number}[]|null;
  stored:{points:number;oldest:string|null};
};
const STATES:Record<State,[string,string]>={granted:["Agreed","text-slate-900"],declined:["Declined","text-[var(--color-danger)]"],
  withdrawn:["Withdrawn","text-[var(--color-danger)]"],outdated:["Must answer new notice","text-[var(--color-warning)]"],not_asked:["Not answered yet","text-[var(--color-warning)]"]};
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";
const n=(v:number)=>v.toLocaleString("en-GB");

export default function GpsPrivacyPage(){
  const kcca=useHasRole("kcca_admin"),systemAdmin=useHasRole("system_admin"),companyAdmin=useHasRole("company_admin");
  const regulator=kcca||systemAdmin;
  const [data,setData]=useState<Overview|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [dialog,setDialog]=useState<"retention"|"notice"|"hold"|"read"|null>(null),[releasing,setReleasing]=useState<Overview["holds"][number]|null>(null),[running,setRunning]=useState(false);
  const load=useCallback(async()=>{
    try{setData((await apiRequest<{data:Overview}>("/api/waste/privacy/gps/overview")).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load the GPS data policy")}
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  async function done(message:string){setDialog(null);setReleasing(null);setNotice(message);setError("");await load()}
  async function runNow(){
    setRunning(true);setError("");
    try{done((await apiRequest<{message:string}>("/api/waste/privacy/gps/retention/run",{method:"POST"})).message)}
    catch(e){setError(e instanceof Error?e.message:"Could not run the purge")}finally{setRunning(false)}
  }
  const d=data,granted=d?.consents.reduce((s,c)=>s+c.granted,0)??0,total=d?.consents.reduce((s,c)=>s+c.drivers,0)??0,lastRun=d?.runs?.[0];

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow={regulator?"Regulation":"Administration"} title="GPS data protection"
      description="Driver positions are kept only during trips, with consent, for the period KCCA sets."/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}

    {d&&<>
      <div className="grid grid-cols-2 rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white lg:grid-cols-4">
        <div className="px-4 py-3"><p className="text-xs font-medium text-slate-500">Positions kept for</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{d.settings.raw_point_days} days</p>
          <p className="text-xs text-slate-500">{d.settings.updated_by_name?`set by ${d.settings.updated_by_name}, ${dateTime(d.settings.updated_at)}`:"default"}{kcca&&<> · <button onClick={()=>setDialog("retention")} className="min-h-0 px-0 py-0 text-xs text-[var(--color-action)]">Change</button></>}</p></div>
        <div className="border-l border-slate-200 px-4 py-3"><p className="text-xs font-medium text-slate-500">Positions stored</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{n(d.stored.points)}</p>
          <p className="text-xs text-slate-500">{d.stored.oldest?`oldest ${dateTime(d.stored.oldest)}`:"none"}</p></div>
        <div className="border-t border-slate-200 px-4 py-3 lg:border-l lg:border-t-0"><p className="text-xs font-medium text-slate-500">Drivers who agreed</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${granted<total?"text-[var(--color-warning)]":"text-slate-900"}`}>{n(granted)} of {n(total)}</p>
          <p className="text-xs text-slate-500">to notice version {d.notice.version}</p></div>
        <div className="border-l border-t border-slate-200 px-4 py-3 lg:border-t-0"><p className="text-xs font-medium text-slate-500">Last deletion run</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{d.runs?(lastRun?n(lastRun.deleted_points):"—"):"Daily"}</p>
          <p className="text-xs text-slate-500">{d.runs?(lastRun?`deleted ${dateTime(lastRun.ran_at)}`:"not run yet"):"run by the platform every day"}</p></div>
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-slate-950">{d.drivers?"Drivers":"Consent by operator"}</h2>
            <p className="text-sm text-slate-600">Without agreement, the driver’s trips have no live position.</p></div>
        </div>
        {d.drivers?(d.drivers.length?<div className="table-wrap"><table className="w-full min-w-[640px] text-left">
          <thead><tr><th>Driver</th><th>Location notice</th><th>Answered</th></tr></thead>
          <tbody>{d.drivers.map(x=><tr key={x.id}><td><p className="table-primary">{x.full_name}</p><p className="table-secondary">{x.phone??""}{x.status==="inactive"?" · inactive":""}</p></td>
            <td className={STATES[x.state][1]}>{STATES[x.state][0]}{x.notice_version&&x.state!=="outdated"?<span className="text-slate-500"> · version {x.notice_version}</span>:null}</td>
            <td>{x.decided_at?dateTime(x.decided_at):"—"}</td></tr>)}</tbody>
        </table></div>:<EmptyState title="No drivers with app accounts" description="Drivers answer when they first open the app."/>)
        :d.consents.length?<div className="table-wrap"><table className="w-full min-w-[640px] text-left">
          <thead><tr><th>Operator</th><th className="text-right">Drivers</th><th className="text-right">Agreed</th><th className="text-right">Not answered</th><th className="text-right">Declined or withdrawn</th></tr></thead>
          <tbody>{d.consents.map(c=><tr key={c.organization_id}><td className="table-primary">{c.organization_name}</td><td className="text-right tabular-nums">{c.drivers}</td>
            <td className="text-right tabular-nums">{c.granted}</td><td className={`text-right tabular-nums ${c.waiting?"text-[var(--color-warning)]":""}`}>{c.waiting}</td>
            <td className={`text-right tabular-nums ${c.refused?"text-[var(--color-danger)]":""}`}>{c.refused}</td></tr>)}</tbody>
        </table></div>:<EmptyState title="No drivers yet" description="Drivers appear once they have app accounts."/>}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div><h2 className="text-lg font-semibold text-slate-950">Trips on hold</h2><p className="text-sm text-slate-600">Positions of a trip on hold are not deleted, for example during a penalty appeal or a dumping investigation. {regulator?"Holds placed by KCCA can only be released by KCCA.":"A hold placed by KCCA can only be released by KCCA."}</p></div>
          {(kcca||companyAdmin)&&<button onClick={()=>setDialog("hold")} className="bg-slate-900 px-4 py-2 text-sm text-white">Put a trip on hold</button>}
        </div>
        {d.holds.length?<div className="table-wrap"><table className="w-full min-w-[900px] text-left">
          <thead><tr><th>Trip</th><th>Reason</th><th>Placed</th><th className="text-right">Positions</th><th>Status</th><th/></tr></thead>
          <tbody>{d.holds.map(h=><tr key={h.id}>
            <td><p className="table-primary font-mono">{h.trip_number}</p><p className="table-secondary">{h.route_date}{h.plate_number?` · ${h.plate_number}`:""}{regulator?` · ${h.organization_name}`:""}</p></td>
            <td className="max-w-80 text-sm">{h.reason}</td>
            <td>{h.placed_by_name}{h.placed_by_kcca?" (KCCA)":""}<p className="table-secondary">{dateTime(h.placed_at)}</p></td>
            <td className="text-right tabular-nums">{n(h.points)}</td>
            <td>{h.released_at?<><p>Released by {h.released_by_name}</p><p className="table-secondary">{dateTime(h.released_at)}{h.release_note?` · ${h.release_note}`:""}</p></>:<span className="font-medium">Kept</span>}</td>
            <td className="text-right">{!h.released_at&&(kcca||(companyAdmin&&!h.placed_by_kcca))&&<button onClick={()=>setReleasing(h)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Release</button>}</td>
          </tr>)}</tbody>
        </table></div>:<EmptyState title="No trips on hold" description="Every trip's positions follow the retention period."/>}
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div>
          <div className="mb-3 flex items-end justify-between gap-3"><h2 className="text-lg font-semibold text-slate-950">Location notice</h2>
            <div className="flex gap-2"><button onClick={()=>setDialog("read")} className="border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700">Read current notice</button>
              {kcca&&<button onClick={()=>setDialog("notice")} className="border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700">Publish new version</button>}</div></div>
          <div className="table-wrap"><table className="w-full text-left text-sm">
            <thead><tr><th>Version</th><th>Change</th><th>Published</th></tr></thead>
            <tbody>{d.notices.map(v=><tr key={v.version}><td className="tabular-nums">{v.version}{v.version===d.notice.version?" (current)":""}</td><td>{v.change_summary??"—"}</td>
              <td>{dateTime(v.published_at)}<p className="table-secondary">{v.published_by_name??""}</p></td></tr>)}</tbody>
          </table></div>
        </div>
        {d.runs&&<div>
          <div className="mb-3 flex items-end justify-between gap-3"><h2 className="text-lg font-semibold text-slate-950">Deletion runs</h2>
            {kcca&&<button onClick={()=>void runNow()} disabled={running} className="border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 disabled:opacity-60">{running?"Deleting…":"Run now"}</button>}</div>
          {d.runs.length?<div className="table-wrap"><table className="w-full text-left text-sm">
            <thead><tr><th>Ran</th><th>Older than</th><th className="text-right">Deleted</th><th className="text-right">Kept on hold</th></tr></thead>
            <tbody>{d.runs.map(r=><tr key={r.ran_at}><td>{dateTime(r.ran_at)}</td><td>{dateTime(r.cutoff)}<p className="table-secondary">{r.raw_point_days} days</p></td>
              <td className="text-right tabular-nums">{n(r.deleted_points)}</td><td className="text-right tabular-nums">{n(r.held_points)}</td></tr>)}</tbody>
          </table></div>:<EmptyState title="Not run yet" description="Expired positions are deleted once a day."/>}
        </div>}
      </section>
    </>}

    {d&&<RetentionDialog open={dialog==="retention"} days={d.settings.raw_point_days} onClose={()=>setDialog(null)} onDone={done}/>}
    {d&&<NoticeDialog open={dialog==="notice"} current={d.notice} onClose={()=>setDialog(null)} onDone={done}/>}
    {d&&<Modal open={dialog==="read"} title={d.notice.title} description={`Version ${d.notice.version}, published ${dateTime(d.notice.published_at)}`} onClose={()=>setDialog(null)}>
      <div className="max-h-[60vh] overflow-y-auto whitespace-pre-line text-sm leading-6 text-slate-700">{d.notice.body}</div>
      <p className="mt-3 text-sm text-slate-700">Drivers also see: positions are deleted after {d.settings.raw_point_days} days.</p>
    </Modal>}
    <HoldDialog open={dialog==="hold"} onClose={()=>setDialog(null)} onDone={done}/>
    <ReleaseDialog hold={releasing} onClose={()=>setReleasing(null)} onDone={done}/>
  </div></AppShell>;
}

function useSubmit(onDone:(message:string)=>void){
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(path:string,method:string,body:unknown){
    setBusy(true);setError("");
    try{onDone((await apiRequest<{message:string}>(path,{method,body:JSON.stringify(body)})).message)}
    catch(e){setError(e instanceof Error?e.message:"Could not save")}finally{setBusy(false)}
  }
  return {busy,error,submit};
}
const Actions=({busy,label,onClose}:{busy:boolean;label:string;onClose:()=>void})=><div className="flex justify-end gap-2">
  <button type="button" onClick={onClose} className="border border-slate-300 px-4 py-2 text-slate-700">Cancel</button>
  <button disabled={busy} className="bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-60">{busy?"Saving…":label}</button></div>;

function RetentionDialog({open,days,onClose,onDone}:{open:boolean;days:number;onClose:()=>void;onDone:(m:string)=>void}){
  const {busy,error,submit}=useSubmit(onDone);
  return <Modal open={open} title="Retention period" description="How long positions are kept. Shortening deletes data for good." onClose={onClose}>
    <form key={String(open)} onSubmit={e=>{e.preventDefault();void submit("/api/waste/privacy/gps/retention","PUT",{rawPointDays:Number(new FormData(e.currentTarget).get("days"))})}} className="grid gap-4 text-sm">
      {error&&<Feedback tone="error">{error}</Feedback>}
      <label className="font-medium text-slate-700">Days<input name="days" type="number" min={30} max={730} required defaultValue={days} className={field}/><span className="mt-1 block text-xs font-normal text-slate-500">Between 30 days and 2 years.</span></label>
      <Actions busy={busy} label="Save" onClose={onClose}/>
    </form>
  </Modal>;
}

function NoticeDialog({open,current,onClose,onDone}:{open:boolean;current:Overview["notice"];onClose:()=>void;onDone:(m:string)=>void}){
  const {busy,error,submit}=useSubmit(onDone);
  return <Modal open={open} title={`Publish notice version ${current.version+1}`} description="Drivers must agree again before sharing location." onClose={onClose}>
    <form key={`${open}-${current.version}`} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void submit("/api/waste/privacy/gps/notices","POST",{title:f.get("title"),body:f.get("body"),changeSummary:f.get("changeSummary")})}} className="grid gap-4 text-sm">
      {error&&<Feedback tone="error">{error}</Feedback>}
      <label className="font-medium text-slate-700">Title<input name="title" required maxLength={150} defaultValue={current.title} className={field}/></label>
      <label className="font-medium text-slate-700">Notice<textarea name="body" required minLength={50} maxLength={8000} rows={12} defaultValue={current.body} className={field}/></label>
      <label className="font-medium text-slate-700">What changed<input name="changeSummary" required minLength={5} maxLength={300} placeholder="Shown to drivers who agreed to the previous version" className={field}/></label>
      <Actions busy={busy} label="Publish" onClose={onClose}/>
    </form>
  </Modal>;
}

function HoldDialog({open,onClose,onDone}:{open:boolean;onClose:()=>void;onDone:(m:string)=>void}){
  const {busy,error,submit}=useSubmit(onDone);
  return <Modal open={open} title="Put a trip on hold" description="Kept until the hold is released." onClose={onClose}>
    <form key={String(open)} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void submit("/api/waste/privacy/gps/holds","POST",{tripNumber:f.get("tripNumber"),reason:f.get("reason")})}} className="grid gap-4 text-sm">
      {error&&<Feedback tone="error">{error}</Feedback>}
      <label className="font-medium text-slate-700">Trip number<input name="tripNumber" required className={`${field} font-mono`} placeholder="TRP-…"/></label>
      <label className="font-medium text-slate-700">Reason<textarea name="reason" required minLength={5} maxLength={500} rows={3} placeholder="For example: penalty appeal PN-2026-0012" className={field}/></label>
      <Actions busy={busy} label="Put on hold" onClose={onClose}/>
    </form>
  </Modal>;
}

function ReleaseDialog({hold,onClose,onDone}:{hold:Overview["holds"][number]|null;onClose:()=>void;onDone:(m:string)=>void}){
  const {busy,error,submit}=useSubmit(onDone);
  return <Modal open={Boolean(hold)} title={`Release ${hold?.trip_number??"hold"}`} description="Positions may be deleted at the next daily run." onClose={onClose}>
    <form onSubmit={e=>{e.preventDefault();if(hold)void submit(`/api/waste/privacy/gps/holds/${hold.id}/release`,"POST",{note:new FormData(e.currentTarget).get("note")})}} className="grid gap-4 text-sm">
      {error&&<Feedback tone="error">{error}</Feedback>}
      {hold&&<p className="text-slate-600">Held for: {hold.reason}</p>}
      <label className="font-medium text-slate-700">Why it can be released<textarea name="note" required minLength={5} maxLength={500} rows={3} placeholder="For example: appeal decided on 12 Nov" className={field}/></label>
      <Actions busy={busy} label="Release" onClose={onClose}/>
    </form>
  </Modal>;
}
