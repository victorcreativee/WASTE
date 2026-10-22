"use client";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,PageHeader} from "@/components/ui/System";
import {Pagination} from "@/components/ui/Pagination";
import {ReportSiteDialog} from "@/components/dumping/ReportSiteDialog";
import {SitePanel} from "@/components/dumping/SitePanel";
import {apiRequest} from "@/lib/api";
import {useServerList} from "@/lib/factory";
import {STATUS,Site,SiteDetail,day,readPhoto,sizeLabel} from "@/lib/dumping";

type Overview={open_orders:number;overdue_orders:number;awaiting_kcca:number;cleared_90d:number;attributed_recent:number;repeat_offender:boolean;rules:{repeat_offences:number;repeat_window_days:number}};
type View="orders"|"attributed";
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";

export default function CleanupOrdersPage(){
  const [view,setView]=useState<View>("orders"),[overview,setOverview]=useState<Overview|null>(null),[site,setSite]=useState<SiteDetail|null>(null);
  const [reporting,setReporting]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const list=useServerList<Site>(`/api/waste/dumping/company/sites?kind=${view}`);
  const load=useCallback(async()=>{
    try{setOverview((await apiRequest<{data:Overview}>("/api/waste/dumping/company/overview")).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load cleanup orders")}
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  async function open(id:string){try{setSite((await apiRequest<{data:SiteDetail}>(`/api/waste/dumping/sites/${id}`)).data)}catch(e){setError(e instanceof Error?e.message:"Could not open the site")}}
  async function done(message:string){setNotice(message);setError("");await Promise.all([load(),list.reload()]);if(site)await open(site.id);}
  const o=overview;

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow="KCCA regulation" title="Dumping cleanups" description="Cleanups KCCA has ordered from your company, and dumping sites KCCA attributes to you. Clear each site by its deadline and report it with a photo."
      action={<button onClick={()=>setReporting(true)} className="border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Report dumping</button>}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}
    {o?.repeat_offender&&<Feedback tone="warning">KCCA has attributed {o.attributed_recent} dumping sites to your company in the last {o.rules.repeat_window_days} days. From {o.rules.repeat_offences} a company is treated as a repeat offender.</Feedback>}

    {o&&<div className="grid grid-cols-2 border border-slate-200 bg-white sm:grid-cols-4 rounded-[var(--ui-radius-lg)]">
      {([["Cleanups to do",o.open_orders],["Overdue",o.overdue_orders],["Waiting for KCCA",o.awaiting_kcca],["Cleared (90 days)",o.cleared_90d]] as const).map(([label,value],i)=>
        <div key={label} className={`px-4 py-3 ${i?"border-l border-slate-200":""}`}><p className="text-xs font-medium text-slate-500">{label}</p><p className={`mt-1 text-xl font-semibold tabular-nums ${label==="Overdue"&&value>0?"text-[var(--color-danger)]":"text-slate-900"}`}>{value}</p></div>)}
    </div>}

    <section className="space-y-3">
      <div role="radiogroup" aria-label="Show" className="inline-flex overflow-hidden rounded-[var(--ui-radius)] border border-slate-300 bg-white text-sm">
        {([["orders","Cleanup orders"],["attributed",`Attributed to us${o?.attributed_recent?` (${o.attributed_recent})`:""}`]] as const).map(([value,label],i)=><button key={value} role="radio" aria-checked={view===value} onClick={()=>{setView(value);list.setPage(1)}} className={`min-h-0 rounded-none px-3 py-1.5 ${i?"border-l border-slate-300":""} ${view===value?"bg-slate-900 text-white":"text-slate-700 hover:bg-slate-50"}`}>{label}</button>)}
      </div>
      {list.error&&<Feedback tone="error">{list.error}</Feedback>}
      {list.rows.length?<div className="table-wrap"><table className="w-full min-w-[820px] text-left">
        <thead><tr><th>Site</th><th>Status</th><th>Size</th><th>Deadline</th><th/></tr></thead>
        <tbody>{list.rows.map(s=><tr key={s.id}>
          <td><p className="table-primary">{s.landmark||s.site_number}</p><p className="table-secondary">{s.site_number}{s.division_name?` · ${s.division_name}`:""}</p></td>
          <td><span className={STATUS[s.status].className}>{STATUS[s.status].label}</span>{s.hazardous&&<p className="table-secondary text-[var(--color-danger)]">Hazardous</p>}</td>
          <td>{sizeLabel(s.size)}</td>
          <td className={s.overdue?"font-medium text-[var(--color-danger)]":""}>{s.cleanup_due_on?day(s.cleanup_due_on):"—"}{s.overdue&&<p className="table-secondary text-[var(--color-danger)]">Overdue</p>}</td>
          <td className="text-right"><button onClick={()=>void open(s.id)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">{view==="orders"&&s.status==="cleanup_ordered"?"Report cleanup":"Open"}</button></td>
        </tr>)}</tbody>
      </table></div>:!list.loading&&<EmptyState title={view==="orders"?"No cleanup orders":"KCCA has not attributed any dumping to your company"}/>}
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} totalPages={list.totalPages} onPage={list.setPage} onPageSize={list.setPageSize}/>
    </section>

    {site&&<SitePanel site={site} onClose={()=>setSite(null)} actions={site.status==="cleanup_ordered"&&site.cleanup_organization_id?<CleanupReportForm site={site} onDone={done} onError={setError}/>:null}/>}
    <ReportSiteDialog open={reporting} onClose={()=>setReporting(false)} onDone={message=>{setReporting(false);setNotice(message)}}/>
  </div></AppShell>;
}

function CleanupReportForm({site,onDone,onError}:{site:SiteDetail;onDone:(message:string)=>Promise<void>;onError:(message:string)=>void}){
  const [photo,setPhoto]=useState<string|null>(null),[busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!photo)return onError("Add a photo of the cleared site");
    setBusy(true);
    try{await apiRequest(`/api/waste/dumping/sites/${site.id}/cleanup-report`,{method:"PATCH",body:JSON.stringify({note:new FormData(e.currentTarget).get("note"),photo})});setPhoto(null);await onDone(`${site.site_number}: cleanup reported to KCCA.`)}
    catch(err){onError(err instanceof Error?err.message:"Could not report the cleanup")}finally{setBusy(false)}
  }
  return <form onSubmit={submit} className="grid gap-3 border-y border-slate-100 py-4">
    <h3 className="font-semibold">Report the cleanup</h3>
    <p className="text-slate-600">Due {day(site.cleanup_due_on)}. KCCA checks the photo and may inspect the site before confirming it.</p>
    <label className="font-medium text-slate-700">What was done<textarea name="note" required minLength={3} rows={2} placeholder="e.g. Cleared with one tipper trip; waste taken to Kiteezi, ticket KIT-..." className={field}/></label>
    <label className="font-medium text-slate-700">Photo of the cleared site<input type="file" required accept="image/jpeg,image/png,image/webp" capture="environment" onChange={async e=>{const f=e.target.files?.[0];try{setPhoto(f?await readPhoto(f):null)}catch(err){onError(err instanceof Error?err.message:"Photo not usable")}}} className="mt-1 block w-full text-sm font-normal"/></label>
    {photo&&<img src={photo} alt="Cleanup photo" className="max-h-40 w-auto border border-slate-200"/>}
    <div className="flex justify-end"><button disabled={busy} className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy?"Sending…":"Report cleanup"}</button></div>
  </form>;
}
