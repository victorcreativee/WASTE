"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,PageHeader} from "@/components/ui/System";
import {ComplianceNoticeDialog,type NoticeDraft} from "@/components/command-center/ComplianceNoticeDialog";
import {IssuePenaltyDialog,type PenaltyDraft} from "@/components/penalties/IssuePenaltyDialog";
import {apiRequest,openAuthenticatedFile} from "@/lib/api";
import {useHasRole} from "@/lib/session";
import {FIELD_LABEL,MATERIAL_CATEGORIES,RETURN_STATE,monthName,organizationTypeLabel,shortDate} from "@/lib/returns";

type Row={organization_id:string;name:string;type:string;return_id:string|null;return_number:string|null;status:string|null;version:number|null;submitted_at:string|null;submitted_late:boolean|null;variance_count:number;state:string};
type Register={period:string;due_on:string;today:string;companies:Row[];totals:{required:number;submitted:number;queried:number;accepted:number;due:number;overdue:number;late:number;with_variances:number}};
type Variance={field:string;declared:number;recorded:number;difference:number};
type Detail={id:string;return_number:string;organization_id:string;organization_name:string;organization_type:string;period:string;due_on:string;status:string;version:number;figures:Record<string,unknown>;platform_figures:Record<string,number>;variances:Variance[];declarant_name:string;declarant_title:string;submitted_at:string;first_submitted_at:string;submitted_late:boolean;review_notes:string|null;history:Array<{version:number;action:string;notes:string|null;created_at:string;actor:string}>};

const fmt=(n:unknown)=>n===undefined||n===null?"—":Number(n).toLocaleString("en-GB");
const lastMonth=()=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`};

/** Declared figures as comparable numbers, matching the server's flattening. */
function declaredNumbers(detail:Detail):Record<string,number>{
  const f=detail.figures,out:Record<string,number>={};
  for(const [key,value] of Object.entries(f))if(typeof value==="number")out[key]=value;
  if(Array.isArray(f.materials))for(const m of f.materials as Array<{category:string;collectedKg:number;soldKg:number}>){out[`${m.category}_collected_kg`]=m.collectedKg;out[`${m.category}_sold_kg`]=m.soldKg;}
  return out;
}

export default function ReturnsRegisterPage(){
  const [period,setPeriod]=useState(lastMonth),[data,setData]=useState<Register|null>(null),[detail,setDetail]=useState<Detail|null>(null);
  const [filter,setFilter]=useState("all"),[error,setError]=useState(""),[notice,setNotice]=useState(""),[saving,setSaving]=useState(false),[draft,setDraft]=useState<NoticeDraft|null>(null),[penalty,setPenalty]=useState<PenaltyDraft|null>(null);
  const canReview=useHasRole("kcca_admin");

  const load=useCallback(async()=>{
    setError("");
    try{setData((await apiRequest<{data:Register}>(`/api/waste/regulatory/returns-register?period=${period}`)).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load the returns register")}
  },[period]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);

  async function open(row:Row){
    if(!row.return_id)return;
    try{setDetail((await apiRequest<{data:Detail}>(`/api/waste/regulatory/returns-register/${row.return_id}`)).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not open the return")}
  }

  async function review(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!detail)return;
    const action=((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null)?.value==="query"?"query":"accept";
    setSaving(true);setError("");
    try{
      const r=await apiRequest<{message:string}>(`/api/waste/regulatory/returns-register/${detail.id}`,{method:"PATCH",body:JSON.stringify({action,notes:new FormData(e.currentTarget).get("notes")})});
      setDetail(null);setNotice(`${detail.organization_name}: ${r.message}.`);await load();
    }catch(e){setError(e instanceof Error?e.message:"Could not record the decision")}finally{setSaving(false)}
  }

  function chase(row:Row){
    setDraft({key:`${row.organization_id}-${period}`,organizationId:row.organization_id,organizationName:row.name,category:"statutory_returns",severity:"advisory",
      title:`Monthly return for ${monthName(period)} not received`,
      details:`The ${monthName(period)} return was due on ${shortDate(data!.due_on)} and had not been submitted on ${shortDate(data!.today)}.`,
      requiredAction:"Submit the outstanding return in the KCCA regulatory portal (KCCA regulation → Monthly returns).",
      dueDate:new Date(Date.parse(`${data!.today}T00:00:00Z`)+7*86400000).toISOString().slice(0,10)});
  }

  const rows=useMemo(()=>(data?.companies||[]).filter(r=>filter==="all"||(filter==="variances"?r.variance_count>0:filter==="late"?r.submitted_late:r.state===filter)),[data,filter]);
  const t=data?.totals;
  const comparison=detail?Array.from(new Set([...Object.keys(declaredNumbers(detail)),...Object.keys(detail.platform_figures)])):[];

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow="KCCA regulation" title="Monthly returns" description="Every licensed company reports its month by the 15th of the next. See who has filed, who is late, and where declared figures differ from what the platform recorded."
      action={<button onClick={()=>void openAuthenticatedFile(`/api/waste/regulatory/returns-register/export.csv?period=${period}`,{download:`kcca-returns-${period}.csv`}).catch(e=>setError(e.message))} className="border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Export CSV</button>}/>

    <div className="flex flex-wrap items-end gap-4">
      <label className="text-sm font-medium text-slate-700">Reporting month<input type="month" value={period} max={lastMonth()} onChange={e=>e.target.value&&setPeriod(e.target.value)} className="mt-1 block border border-slate-300 px-3 py-2 text-sm font-normal"/></label>
      {data&&<p className="pb-2 text-sm text-slate-500">Due {shortDate(data.due_on)}</p>}
    </div>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}

    {t&&<div className="grid grid-cols-2 rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-6">
      {([["Required",t.required,"all"],["Waiting for review",t.submitted,"submitted"],["Accepted",t.accepted,"accepted"],["Queried",t.queried,"queried"],[t.overdue?"Overdue":"Not yet filed",t.overdue||t.due,t.overdue?"overdue":"due"],["Differ from records",t.with_variances,"variances"]] as const).map(([label,value,key],i)=>
        <button key={label} onClick={()=>setFilter(key)} className={`min-h-0 rounded-none px-4 py-3 text-left hover:bg-slate-50 ${i?"border-l border-slate-200":""} ${filter===key?"bg-slate-50":""}`}>
          <p className="text-xs font-medium text-slate-500">{label}</p><p className={`mt-1 text-xl font-semibold tabular-nums ${key==="overdue"&&value?"text-[var(--color-danger)]":"text-slate-900"}`}>{value}</p>
        </button>)}
    </div>}

    {data&&(rows.length?<div className="table-wrap"><table className="w-full min-w-[860px] text-left">
      <thead><tr><th>Company</th><th>Status</th><th>Submitted</th><th>Differences</th><th/></tr></thead>
      <tbody>{rows.map(r=><tr key={r.organization_id}>
        <td><p className="table-primary">{r.name}</p><p className="table-secondary">{organizationTypeLabel(r.type)}{r.return_number?` · ${r.return_number}`:""}</p></td>
        <td><span className={RETURN_STATE[r.state].className}>{RETURN_STATE[r.state].label}</span>{r.version&&r.version>1?<p className="table-secondary">Version {r.version}</p>:null}</td>
        <td>{r.submitted_at?<>{shortDate(r.submitted_at)}{r.submitted_late&&<p className="table-secondary text-[var(--color-warning)]">After due date</p>}</>:"—"}</td>
        <td className="tabular-nums">{r.return_id?(r.variance_count?<span className="text-[var(--color-warning)]">{r.variance_count} figure{r.variance_count===1?"":"s"}</span>:"None"):"—"}</td>
        <td className="text-right">{r.return_id?<button onClick={()=>void open(r)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">{r.state==="submitted"&&canReview?"Review":"View"}</button>
          :r.state==="overdue"&&canReview&&<span className="inline-flex gap-2"><button onClick={()=>chase(r)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Send notice</button><button onClick={()=>setPenalty({organizationId:r.organization_id,organizationName:r.name,scheduleCode:"RETURN_LATE",returnPeriod:period,source:`Monthly return ${monthName(period)}`,grounds:`The monthly return for ${monthName(period)} was due on ${shortDate(data!.due_on)} and had not been filed on ${shortDate(data!.today)}.`})} className="border border-[var(--color-danger)] px-3 py-2 text-xs text-[var(--color-danger)]">Issue penalty</button></span>}</td>
      </tr>)}</tbody>
    </table></div>:<EmptyState title="No companies match this view"/>)}

    {detail&&<div className="anim-fade fixed inset-0 z-50 flex justify-end bg-slate-900/40" onMouseDown={e=>{if(e.target===e.currentTarget)setDetail(null)}}>
      <section className="h-full w-full max-w-2xl overflow-y-auto bg-white">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-slate-200 bg-white px-6 py-5">
          <div><p className="text-xs font-medium text-slate-500">{detail.return_number} · version {detail.version}</p><h2 className="mt-1 text-xl font-semibold">{detail.organization_name}</h2><p className="mt-1 text-sm text-slate-500">{monthName(detail.period)} · <span className={RETURN_STATE[detail.status].className}>{RETURN_STATE[detail.status].label}</span></p></div>
          <button onClick={()=>setDetail(null)} className="text-sm font-medium text-slate-500 hover:text-slate-900">Close</button>
        </header>
        <div className="space-y-6 px-6 py-6 text-sm">
          <p className="text-slate-600">Declared by <span className="font-medium text-slate-900">{detail.declarant_name}</span>, {detail.declarant_title}, on {shortDate(detail.submitted_at)}{detail.submitted_late?` — after the ${shortDate(detail.due_on)} due date`:""}.</p>
          <div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Figure</th><th className="text-right">Declared</th><th className="text-right">Platform recorded</th></tr></thead><tbody>
            {comparison.map(key=>{const v=detail.variances.find(x=>x.field===key);return <tr key={key}><td>{FIELD_LABEL[key]||key}</td><td className={`text-right tabular-nums ${v?"font-semibold text-[var(--color-warning)]":""}`}>{fmt(declaredNumbers(detail)[key]??0)}</td><td className="text-right tabular-nums text-slate-500">{detail.platform_figures[key]?fmt(detail.platform_figures[key]):"Not recorded"}</td></tr>})}
          </tbody></table></div>
          {detail.variances.length>0&&<p className="text-[var(--color-warning)]">Highlighted figures differ from platform records by more than 10%.</p>}
          {["disposal_site","residue_disposal","notes"].filter(k=>detail.figures[k]).map(k=><div key={k}><p className="text-xs text-slate-500">{k==="disposal_site"?"Disposal site":k==="residue_disposal"?"Residue disposal":"Company notes"}</p><p className="mt-0.5 text-slate-800">{String(detail.figures[k])}</p></div>)}
          {Array.isArray(detail.figures.materials)&&(detail.figures.materials as unknown[]).length===0&&<p className="text-slate-500">No materials declared. Categories: {MATERIAL_CATEGORIES.map(([,l])=>l).join(", ")}.</p>}

          {detail.status==="submitted"&&canReview&&<form onSubmit={review} className="grid gap-3 border-t border-slate-100 pt-5">
            <h3 className="font-semibold">Decision</h3>
            <textarea name="notes" required minLength={3} rows={3} placeholder="Reason (shown to the company). For a query, say exactly what to check or correct." className="border border-slate-300 px-3 py-2.5"/>
            <div className="flex gap-2"><button value="accept" disabled={saving} className="bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">Accept return</button><button value="query" disabled={saving} className="border border-slate-300 bg-white px-4 py-2.5 font-semibold text-slate-700 disabled:opacity-50">Query</button></div>
          </form>}

          <div><h3 className="font-semibold">History</h3><ol className="mt-3 space-y-3 border-l border-slate-200 pl-4">{detail.history.map((h,i)=><li key={i}><p className="text-xs text-slate-500">{new Date(h.created_at).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"})} · {h.actor}</p><p className="font-medium capitalize text-slate-800">{h.action} (version {h.version})</p>{h.notes&&<p className="text-slate-600">{h.notes}</p>}</li>)}</ol></div>
        </div>
      </section>
    </div>}

    <ComplianceNoticeDialog draft={draft} onClose={()=>setDraft(null)} onIssued={message=>{setDraft(null);setNotice(message)}}/>
    <IssuePenaltyDialog draft={penalty} onClose={()=>setPenalty(null)} onIssued={message=>{setPenalty(null);setNotice(message)}}/>
  </div></AppShell>;
}
