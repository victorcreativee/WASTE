"use client";
import dynamic from "next/dynamic";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,PageHeader} from "@/components/ui/System";
import {Pagination} from "@/components/ui/Pagination";
import {ComplianceNoticeDialog,type NoticeDraft} from "@/components/command-center/ComplianceNoticeDialog";
import {ReportSiteDialog} from "@/components/dumping/ReportSiteDialog";
import {SitePanel} from "@/components/dumping/SitePanel";
import {IssuePenaltyDialog,type PenaltyDraft} from "@/components/penalties/IssuePenaltyDialog";
import {apiRequest} from "@/lib/api";
import {useHasRole} from "@/lib/session";
import {useServerList} from "@/lib/factory";
import {PERIODS} from "@/lib/disposal";
import {Division,SIZES,STATUS,Site,SiteDetail,WASTE_TYPES,day,readPhoto,sizeLabel} from "@/lib/dumping";

const DumpingMap=dynamic(()=>import("@/components/gis/DumpingMap"),{ssr:false,loading:()=><div className="flex h-[460px] items-center justify-center bg-slate-50 text-sm text-slate-500">Loading map…</div>});
type Org={id:string;name:string;type:string;is_active:boolean};
type Overview={period:{from:string;to:string;label:string};rules:{cleanupDays:Record<string,number>;hazardousCleanupDays:number;repeatOffences:number;repeatWindowDays:number};
  totals:{open:number;reported:number;verified:number;cleanup_ordered:number;cleanup_reported:number;overdue:number;hazardous_open:number;new_sites:number;recurrences:number;cleared:number;dismissed:number;median_days_to_clear:number|null;hotspots:number};
  divisions:Array<{id:string;name:string;open:number;cleared:number;overdue:number}>;
  companies:Array<{id:string;name:string;attributed_recent:number;open_orders:number;overdue_orders:number;cleared:number;repeat_offender:boolean}>;
  sites:Array<Site>};
const FILTERS:Array<[string,string]>=[["open","Open"],["reported","To inspect"],["cleanup_reported","Cleanup to confirm"],["overdue","Overdue"],["cleared","Cleared"],["dismissed","Closed"]];
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";
const todayIso=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
const plusDays=(n:number)=>{const d=new Date();d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};

export default function IllegalDumpingPage(){
  const [period,setPeriod]=useState("30d"),[data,setData]=useState<Overview|null>(null),[filter,setFilter]=useState("open");
  const [site,setSite]=useState<SiteDetail|null>(null),[reporting,setReporting]=useState(false),[draft,setDraft]=useState<NoticeDraft|null>(null),[penalty,setPenalty]=useState<PenaltyDraft|null>(null);
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[orgs,setOrgs]=useState<Org[]>([]),[divisions,setDivisions]=useState<Division[]>([]);
  const canAct=useHasRole("kcca_admin");
  const list=useServerList<Site>(`/api/waste/dumping/sites?status=${filter}`);

  const load=useCallback(async()=>{
    try{setData((await apiRequest<{data:Overview}>(`/api/waste/dumping/overview?period=${period}`)).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load illegal dumping")}
  },[period]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  useEffect(()=>{
    apiRequest<{data:Division[]}>("/api/waste/dumping/divisions").then(r=>setDivisions(r.data)).catch(()=>undefined);
    apiRequest<{data:Org[]}>("/api/organizations").then(r=>setOrgs(r.data.filter(o=>o.is_active&&["waste_collection_company","recycling_company","processing_plant"].includes(o.type)))).catch(()=>undefined);
  },[]);

  async function open(id:string){try{setSite((await apiRequest<{data:SiteDetail}>(`/api/waste/dumping/sites/${id}`)).data)}catch(e){setError(e instanceof Error?e.message:"Could not open the site")}}
  async function refresh(message:string,keepOpen=true){setNotice(message);setError("");await Promise.all([load(),list.reload()]);if(keepOpen&&site)await open(site.id);}
  const t=data?.totals;

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow="City oversight" title="Illegal dumping" description="Every reported dumping site, from first report to confirmed clean-up. Inspect reports, hold companies responsible where the evidence supports it, order cleanups with deadlines and check they were done."
      action={<div className="flex gap-2"><select aria-label="Period" value={period} onChange={e=>setPeriod(e.target.value)} className="border border-slate-300 bg-white px-3 py-2 text-sm">{PERIODS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>{canAct&&<button onClick={()=>setReporting(true)} className="bg-[var(--color-action)] px-3 py-2 text-sm font-semibold text-white">Report a site</button>}</div>}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}

    {t&&<div className="grid grid-cols-2 border border-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-6 rounded-[var(--ui-radius-lg)]">
      {([["Open sites",t.open,`${t.reported} to inspect · ${t.hazardous_open} hazardous`],["Cleanups overdue",t.overdue,`${t.cleanup_ordered} ordered · ${t.cleanup_reported} to confirm`],["Hotspots",t.hotspots,"repeat reports or recurrence"],["New this period",t.new_sites,`${t.recurrences} came back`],["Cleared this period",t.cleared,`${t.dismissed} closed as unfounded`],["Median days to clear",t.median_days_to_clear??"—","from first report"]] as const).map(([label,value,hint],i)=>
        <div key={label} className={`px-4 py-3 ${i?"border-l border-slate-200":""}`}><p className="text-xs font-medium text-slate-500">{label}</p><p className={`mt-1 text-xl font-semibold tabular-nums ${label==="Cleanups overdue"&&Number(value)>0?"text-[var(--color-danger)]":"text-slate-900"}`}>{value}</p><p className="text-xs text-slate-500">{hint}</p></div>)}
    </div>}

    {data&&<div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="overflow-hidden border border-slate-200 bg-white"><DumpingMap sites={data.sites} onSelect={id=>void open(id)}/>
        <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-200 px-4 py-2 text-xs text-slate-600">{(["reported","verified","cleanup_ordered","cleanup_reported","cleared"] as const).map(s=><span key={s}><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{background:STATUS[s].color}}/>{STATUS[s].label}</span>)}<span>Larger dot: hotspot · red ring: overdue</span></p></div>
      <div className="space-y-6">
        <div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Division</th><th className="text-right">Open</th><th className="text-right">Overdue</th><th className="text-right">Cleared</th></tr></thead>
          <tbody>{data.divisions.map(d=><tr key={d.id}><td>{d.name}</td><td className="text-right tabular-nums">{d.open}</td><td className={`text-right tabular-nums ${d.overdue?"font-medium text-[var(--color-danger)]":""}`}>{d.overdue}</td><td className="text-right tabular-nums">{d.cleared}</td></tr>)}</tbody></table></div>
        {data.companies.length>0&&<div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Company</th><th className="text-right" title={`Sites attributed in the last ${data.rules.repeatWindowDays} days`}>Held responsible</th><th className="text-right">Cleanups open</th></tr></thead>
          <tbody>{data.companies.map(c=><tr key={c.id}><td><p className="table-primary">{c.name}</p>{c.repeat_offender&&<p className="table-secondary text-[var(--color-danger)]">Repeat offender</p>}</td><td className="text-right tabular-nums">{c.attributed_recent}</td><td className="text-right tabular-nums">{c.open_orders}{c.overdue_orders?<span className="text-[var(--color-danger)]"> ({c.overdue_orders} late)</span>:null}</td></tr>)}</tbody></table></div>}
      </div>
    </div>}

    <section className="space-y-3">
      <div role="radiogroup" aria-label="Show" className="inline-flex flex-wrap overflow-hidden rounded-[var(--ui-radius)] border border-slate-300 bg-white text-sm">
        {FILTERS.map(([value,label],i)=><button key={value} role="radio" aria-checked={filter===value} onClick={()=>{setFilter(value);list.setPage(1)}} className={`min-h-0 rounded-none px-3 py-1.5 ${i?"border-l border-slate-300":""} ${filter===value?"bg-slate-900 text-white":"text-slate-700 hover:bg-slate-50"}`}>{label}</button>)}
      </div>
      {list.error&&<Feedback tone="error">{list.error}</Feedback>}
      {list.rows.length?<div className="table-wrap"><table className="w-full min-w-[900px] text-left">
        <thead><tr><th>Site</th><th>Status</th><th>Size</th><th>Cleanup</th><th className="text-right">Reports</th><th/></tr></thead>
        <tbody>{list.rows.map(s=><tr key={s.id}>
          <td><p className="table-primary">{s.landmark||s.site_number}</p><p className="table-secondary">{s.site_number}{s.division_name?` · ${s.division_name}`:""}</p></td>
          <td><span className={STATUS[s.status].className}>{STATUS[s.status].label}</span>{(s.hazardous||s.hotspot)&&<p className="table-secondary text-[var(--color-danger)]">{[s.hazardous&&"Hazardous",s.hotspot&&"Hotspot"].filter(Boolean).join(" · ")}</p>}</td>
          <td>{sizeLabel(s.size)}</td>
          <td>{s.cleanup_due_on?<><p>{s.cleanup_organization_name||"KCCA crew"}</p><p className={`table-secondary ${s.overdue?"font-medium text-[var(--color-danger)]":""}`}>Due {day(s.cleanup_due_on)}</p></>:"—"}</td>
          <td className="text-right tabular-nums">{s.report_count}{s.recurrence_count?<span className="table-secondary"> · back {s.recurrence_count}×</span>:null}</td>
          <td className="text-right"><button onClick={()=>void open(s.id)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">{canAct&&["reported","cleanup_reported"].includes(s.status)?"Review":"Open"}</button></td>
        </tr>)}</tbody>
      </table></div>:!list.loading&&<EmptyState title="No sites in this view"/>}
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} totalPages={list.totalPages} onPage={list.setPage} onPageSize={list.setPageSize}/>
    </section>

    {site&&<SitePanel site={site} onClose={()=>setSite(null)} actions={canAct?<KccaActions site={site} orgs={orgs} divisions={divisions} onDone={refresh} onError={setError} onPenalty={setPenalty}
      onNotice={()=>setDraft({key:site.id,organizationId:site.responsible_organization_id!,organizationName:site.responsible_organization_name!,category:"service_delivery",severity:site.hazardous?"critical":"warning",
        title:`Illegal dumping attributed to your company: ${site.site_number}`,
        details:[`KCCA illegal dumping enforcement, site ${site.site_number}${site.landmark?` (${site.landmark})`:""}${site.division_name?`, ${site.division_name}`:""}.`,`- First reported ${day(site.first_reported_at)}; ${site.report_count} report(s)${site.recurrence_count?`; dumping came back ${site.recurrence_count} time(s)`:""}.`,`- Evidence: ${site.responsibility_basis}`].join("\n"),
        requiredAction:"Stop dumping at unauthorized sites, take all collected waste to a KCCA disposal facility, and report the corrective action taken with your crews.",dueDate:plusDays(14)})}/>:null}/>}
    <ReportSiteDialog open={reporting} onClose={()=>setReporting(false)} onDone={message=>{setReporting(false);void refresh(message,false)}}/>
    <ComplianceNoticeDialog draft={draft} onClose={()=>setDraft(null)} onIssued={message=>{setDraft(null);setNotice(message)}}/>
    <IssuePenaltyDialog draft={penalty} onClose={()=>setPenalty(null)} onIssued={message=>{setPenalty(null);setNotice(message)}}/>
  </div></AppShell>;
}

type Mode=null|"verify"|"dismiss"|"responsible"|"order"|"confirm"|"reject";

function KccaActions({site,orgs,divisions,onDone,onError,onNotice,onPenalty}:{site:SiteDetail;orgs:Org[];divisions:Division[];onDone:(message:string)=>Promise<void>;onError:(message:string)=>void;onNotice:()=>void;onPenalty:(draft:PenaltyDraft)=>void}){
  const [mode,setMode]=useState<Mode>(null),[busy,setBusy]=useState(false),[photo,setPhoto]=useState<string|null>(null);
  const collectors=orgs.filter(o=>o.type==="waste_collection_company");
  async function send(path:string,body:unknown,message:string){
    setBusy(true);
    try{await apiRequest(`/api/waste/dumping/sites/${site.id}/${path}`,{method:"PATCH",body:JSON.stringify(body)});setMode(null);setPhoto(null);await onDone(message)}
    catch(e){onError(e instanceof Error?e.message:"Could not save")}finally{setBusy(false)}
  }
  const value=(form:FormData,name:string)=>{const v=form.get(name);return v===null||v===""?undefined:String(v)};
  const button=(m:Mode,label:string,primary=false)=><button type="button" onClick={()=>setMode(mode===m?null:m)} className={`px-3 py-2 text-xs font-semibold ${primary?"bg-[var(--color-action)] text-white":"border border-slate-300 text-slate-700"}`}>{label}</button>;
  const photoInput=<label className="font-medium text-slate-700">Photo (optional)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={async e=>{const f=e.target.files?.[0];try{setPhoto(f?await readPhoto(f):null)}catch(err){onError(err instanceof Error?err.message:"Photo not usable")}}} className="mt-1 block w-full text-sm font-normal"/></label>;
  const submit=(label:string,danger=false)=><div className="flex justify-end gap-2"><button type="button" onClick={()=>setMode(null)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Cancel</button><button disabled={busy} className={`px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 ${danger?"bg-[var(--color-danger)]":"bg-[var(--color-action)]"}`}>{busy?"Saving…":label}</button></div>;
  const open=!["cleared","dismissed"].includes(site.status);

  return <div className="space-y-3 border-y border-slate-100 py-4">
    <div className="flex flex-wrap gap-2">
      {site.status==="reported"&&button("verify","Record inspection",true)}
      {site.status==="verified"&&button("order","Order cleanup",true)}
      {site.status==="cleanup_reported"&&<>{button("confirm","Confirm clear",true)}{button("reject","Send back")}</>}
      {site.status==="cleanup_ordered"&&!site.cleanup_organization_id&&button("confirm","Confirm clear",true)}
      {["reported","verified"].includes(site.status)&&button("dismiss","Close as unfounded")}
      {open&&button("responsible",site.responsible_organization_id?"Change responsibility":"Hold a company responsible")}
      {site.responsible_organization_id&&<button type="button" onClick={onNotice} className="border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Send compliance notice</button>}
      {site.responsible_organization_id&&<button type="button" onClick={()=>onPenalty({organizationId:site.responsible_organization_id!,organizationName:site.responsible_organization_name!,scheduleCode:"DUMPING_ATTRIBUTED",dumpingSiteId:site.id,source:`Dumping site ${site.site_number}`,
        grounds:`Illegal dumping at ${site.landmark||site.site_number}${site.division_name?`, ${site.division_name}`:""}, first reported ${day(site.first_reported_at)}. Evidence: ${site.responsibility_basis}`})} className="border border-[var(--color-danger)] px-3 py-2 text-xs font-semibold text-[var(--color-danger)]">Issue penalty</button>}
      {site.overdue&&site.cleanup_organization_id&&<button type="button" onClick={()=>onPenalty({organizationId:site.cleanup_organization_id!,organizationName:site.cleanup_organization_name!,scheduleCode:"CLEANUP_NOT_DONE",dumpingSiteId:site.id,source:`Dumping site ${site.site_number}`,
        grounds:`KCCA ordered the cleanup of ${site.landmark||site.site_number} to be completed by ${day(site.cleanup_due_on)}. It had not been completed by that date.`})} className="border border-[var(--color-danger)] px-3 py-2 text-xs font-semibold text-[var(--color-danger)]">Penalty for missed cleanup</button>}
    </div>
    {site.status==="cleanup_ordered"&&site.cleanup_organization_id&&<p className="text-slate-600">Waiting for {site.cleanup_organization_name} to report the cleanup (due {day(site.cleanup_due_on)}).</p>}

    {mode==="verify"&&<form className="grid gap-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void send("verify",{divisionId:value(f,"divisionId"),size:value(f,"size"),wasteTypes:f.getAll("wasteTypes"),hazardous:f.get("hazardous")==="on",note:value(f,"note"),photo:photo||undefined},"Inspection recorded")}}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="font-medium text-slate-700">Division<select name="divisionId" defaultValue={site.division_id||""} required={!site.division_id} className={field}><option value="">Choose</option>{divisions.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="font-medium text-slate-700">Size<select name="size" required className={field}><option value="">Choose</option>{SIZES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      <fieldset><legend className="font-medium text-slate-700">Waste found</legend><div className="mt-1 grid grid-cols-2 gap-1">{WASTE_TYPES.map(([v,l])=><label key={v} className="flex items-center gap-2 font-normal"><input type="checkbox" name="wasteTypes" value={v} className="h-4 w-4"/>{l}</label>)}</div></fieldset>
      <label className="flex items-center gap-2 font-medium text-slate-700"><input type="checkbox" name="hazardous" className="h-4 w-4"/>Hazardous waste (shortest cleanup deadline)</label>
      <label className="font-medium text-slate-700">Inspection notes<textarea name="note" required minLength={5} rows={3} className={field}/></label>
      {photoInput}{submit("Record inspection")}
    </form>}

    {mode==="dismiss"&&<form className="grid gap-3" onSubmit={e=>{e.preventDefault();void send("dismiss",{reason:value(new FormData(e.currentTarget),"reason")},"Report closed")}}>
      <label className="font-medium text-slate-700">Why is there nothing to act on?<textarea name="reason" required minLength={5} rows={3} placeholder="Shown to the people who reported it." className={field}/></label>{submit("Close report",true)}
    </form>}

    {mode==="responsible"&&<form className="grid gap-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const org=value(f,"organizationId")||null;void send("responsibility",{organizationId:org,basis:org?value(f,"basis"):undefined},org?"Responsibility recorded":"Responsibility removed")}}>
      <label className="font-medium text-slate-700">Company<select name="organizationId" defaultValue={site.responsible_organization_id||""} className={field}><option value="">Nobody (remove)</option>{orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <label className="font-medium text-slate-700">Evidence<textarea name="basis" minLength={10} rows={3} placeholder="What links this company to the dumping: photo, vehicle registration, witness, GPS track." className={field}/></label>{submit("Save")}
    </form>}

    {mode==="order"&&<form className="grid gap-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void send("order-cleanup",{organizationId:value(f,"organizationId")||null,dueOn:value(f,"dueOn"),note:value(f,"note")},"Cleanup ordered")}}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="font-medium text-slate-700">Who cleans up<select name="organizationId" defaultValue={site.responsible_organization_id&&collectors.some(c=>c.id===site.responsible_organization_id)?site.responsible_organization_id:""} className={field}><option value="">KCCA crew</option>{collectors.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label className="font-medium text-slate-700">Deadline<input type="date" name="dueOn" min={todayIso()} max={plusDays(site.rules.cleanup_days)} defaultValue={plusDays(site.rules.cleanup_days)} className={field}/></label>
      </div>
      <p className="text-xs text-slate-500">A {site.hazardous?"hazardous":sizeLabel(site.size).toLowerCase()} site must be cleared within {site.rules.cleanup_days} days.</p>
      <label className="font-medium text-slate-700">Instructions (optional)<textarea name="note" rows={2} className={field}/></label>{submit("Order cleanup")}
    </form>}

    {mode==="confirm"&&<form className="grid gap-3" onSubmit={e=>{e.preventDefault();void send("confirm",{note:value(new FormData(e.currentTarget),"note"),photo:photo||undefined},"Site confirmed clear")}}>
      <label className="font-medium text-slate-700">What KCCA found<textarea name="note" required minLength={3} rows={2} className={field}/></label>{photoInput}{submit("Confirm clear")}
    </form>}

    {mode==="reject"&&<form className="grid gap-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void send("reject-cleanup",{reason:value(f,"reason"),dueOn:value(f,"dueOn")},"Cleanup sent back")}}>
      <label className="font-medium text-slate-700">What is still wrong<textarea name="reason" required minLength={5} rows={2} className={field}/></label>
      <label className="font-medium text-slate-700">New deadline (optional)<input type="date" name="dueOn" min={todayIso()} max={plusDays(site.rules.cleanup_days)} className={field}/></label>{submit("Send back",true)}
    </form>}
  </div>;
}
