"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {Feedback,Modal} from "@/components/ui/System";
import {apiRequest,openAuthenticatedFile} from "@/lib/api";
import {useHasRole} from "@/lib/session";
import {monthName} from "@/lib/returns";

type Kpis=Record<string,number|null>;
type Insight={id:string;tone:"risk"|"attention"|"positive";title:string;detail:string};
type Collector={id:string;name:string;permit_number:string|null;jobs:number;completed_jobs:number;missed_jobs:number;completion_rate:number|null;completed_trips:number;verification_rate:number|null;disposed_kg:number;open_issues:number;overdue_issues:number;open_compliance_cases:number;compliance_state:string;service_score:number|null;band:string};
type Report={
  period:{key:string;type:string;from:string;to:string;label:string;complete:boolean;previous:{key:string;label:string}};
  generated_at:string;standards:Record<string,number>;
  headline:{current:Kpis;previous:Kpis;change:Record<string,number|null>};
  insights:Insight[];
  licensing:Record<string,number>&{no_permit_on_record:Array<{name:string;type:string}>};
  collection:{by_division:Array<{division:string;scheduled:number;completed:number;missed:number;completion_rate:number|null}>};
  issues:{by_category:Array<{category:string;standard_hours:number;received:number;resolved:number;within_standard:number;within_standard_rate:number|null;median_hours:number|null}>};
  recycling:{totals:Record<string,number|null>;categories:Array<{category:string;collected_kg:number;sold_kg:number}>;industries:Array<{industry:string;kg:number}>};
  accountability:{cases:Array<{category:string;opened:number;closed:number;open_at_end:number}>;returns:{months:Array<{period:string;due_on:string;required:number;filed:number;late:number;accepted:number;outstanding:number}>;required:number;filed:number;on_time:number;filing_rate:number|null}};
  collectors:Collector[];
  trend:Array<{month:string;completion_rate:number|null;disposed_kg:number;issues:number;recyclables_kg:number}>;
};
type Issued={id:string;report_number:string;period_key:string;title:string;status:string;issued_at:string;issued_by_name:string;superseded_reason:string|null;superseded_by_number:string|null};
type IssuedDetail={id:string;report_number:string;status:string;issued_at:string;issued_by_name:string;commentary:string|null;data:Report;superseded_by_number:string|null};

const n=(v:number|null|undefined)=>v===null||v===undefined?"—":Number(v).toLocaleString("en-GB");
const tonnes=(kg:number|null|undefined)=>kg===null||kg===undefined?"—":kg>=1000?`${(kg/1000).toLocaleString("en-GB",{maximumFractionDigits:1})} t`:`${Math.round(kg).toLocaleString("en-GB")} kg`;
const pct=(v:number|null|undefined)=>v===null||v===undefined?"—":`${v}%`;
const label=(s:string)=>s.replaceAll("_"," ").replace(/^\w/,c=>c.toUpperCase());
const BAND:Record<string,string>={good:"Good",watch:"Watch",action_required:"Action required",no_activity:"No activity"};
const TONE={risk:{mark:"bg-[var(--color-danger)]",label:"Risk"},attention:{mark:"bg-[var(--color-warning)]",label:"Attention"},positive:{mark:"bg-[var(--color-success)]",label:"Positive"}};

const HEADLINE:Array<[string,string,(v:number|null)=>string,"higher"|"lower"]>=[
  ["completion_rate","Collection completion",pct,"higher"],["jobs_missed","Missed collections",n,"lower"],["disposed_kg","Delivered for disposal",tonnes,"higher"],
  ["verification_rate","Trips weighbridge-verified",pct,"higher"],["within_standard_rate","Issues resolved within standard",pct,"higher"],["issues_received","Resident issues received",n,"lower"],
  ["recovery_rate","Recycling recovery rate",pct,"higher"],["returns_filing_rate","Monthly returns filed",pct,"higher"],
];

function Change({k,report,better}:{k:string;report:Report;better:"higher"|"lower"}){
  const c=report.headline.current[k],p=report.headline.previous[k];
  if(c===null||p===null||c===undefined||p===undefined)return <span className="text-slate-400">no comparison</span>;
  const isRate=k.endsWith("_rate"),diff=isRate?Math.round((c-p)*10)/10:report.headline.change[k];
  if(diff===null||diff===0)return <span className="text-slate-500">no change</span>;
  const good=better==="higher"?diff>0:diff<0;
  return <span className={good?"text-[var(--color-success)]":"text-[var(--color-danger)]"}>{diff>0?"▲":"▼"} {Math.abs(diff)}{isRate?" pts":"%"}</span>;
}

function Section({n:num,title,children}:{n?:number;title:string;children:React.ReactNode}){
  return <section className="report-section"><h2 className="mb-3 flex items-baseline gap-2 border-b border-slate-200 pb-2 text-base font-semibold text-slate-900">{num!==undefined&&<span className="text-slate-400 tabular-nums">{num}.</span>}{title}</h2>{children}</section>;
}

function ReportDocument({report,issued}:{report:Report;issued:IssuedDetail|null}){
  const maxDisposal=Math.max(1,...report.trend.map(m=>m.disposed_kg));
  return <article className="report-document card mx-auto max-w-[960px] space-y-8 bg-white px-6 py-8 sm:px-10">
    <header className="border-b-2 border-slate-900 pb-5">
      <p className="text-xs font-semibold uppercase tracking-[.08em] text-slate-500">Kampala Capital City Authority</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Kampala waste services report</h1>
      <p className="mt-1 text-lg text-slate-700">{report.period.label}</p>
      <p className="mt-3 text-sm text-slate-500">{issued
        ?<>Official report <span className="font-medium text-slate-800">{issued.report_number}</span> · issued {new Date(issued.issued_at).toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"})} by {issued.issued_by_name}{issued.status==="superseded"?` · superseded by ${issued.superseded_by_number}`:""}</>
        :<>Draft prepared {new Date(report.generated_at).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"})} · {report.period.complete?"figures may change until the report is issued":"period still in progress"}</>}
        {" "}· compared with {report.period.previous.label}</p>
    </header>

    {issued?.commentary&&<Section title="KCCA commentary"><p className="whitespace-pre-line text-sm leading-6 text-slate-700">{issued.commentary}</p></Section>}

    <Section n={1} title="Key findings">
      {report.insights.length?<ul className="space-y-3">{report.insights.map(i=><li key={i.id} className="flex gap-3 text-sm"><span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 ${TONE[i.tone].mark}`}/><div><p className="font-medium text-slate-900"><span className="sr-only">{TONE[i.tone].label}: </span>{i.title}</p><p className="text-slate-600">{i.detail}</p></div></li>)}</ul>
        :<p className="text-sm text-slate-600">No exceptions: the figures are within KCCA&rsquo;s targets and steady against the previous period.</p>}
    </Section>

    <Section n={2} title="Headline figures">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--ui-radius)] border border-slate-200 bg-slate-200 md:grid-cols-4">
        {HEADLINE.map(([k,name,format,better])=><div key={k} className="bg-white px-4 py-3"><dt className="text-xs text-slate-500">{name}</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{format(report.headline.current[k])}</dd><dd className="mt-0.5 text-xs"><Change k={k} report={report} better={better}/></dd></div>)}
      </dl>
    </Section>

    <Section n={3} title="Collection service">
      <p className="mb-3 text-sm text-slate-600">{n(report.headline.current.jobs_completed)} of {n(report.headline.current.jobs_scheduled)} scheduled collections completed; {n(report.headline.current.trips_completed)} trips completed, {n(report.headline.current.trips_verified)} with a verified weighbridge weight.</p>
      <div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Division</th><th className="text-right">Scheduled</th><th className="text-right">Completed</th><th className="text-right">Missed</th><th className="text-right">Completion</th></tr></thead><tbody>
        {report.collection.by_division.length?report.collection.by_division.map(d=><tr key={d.division}><td className="table-primary">{d.division}</td><td className="text-right tabular-nums">{n(d.scheduled)}</td><td className="text-right tabular-nums">{n(d.completed)}</td><td className="text-right tabular-nums">{n(d.missed)}</td><td className="text-right tabular-nums">{pct(d.completion_rate)}</td></tr>)
          :<tr><td colSpan={5} className="text-center text-slate-500">No collections scheduled in this period.</td></tr>}
      </tbody></table></div>
    </Section>

    <Section n={4} title="Resident issues">
      <div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Category</th><th className="text-right">Standard</th><th className="text-right">Received</th><th className="text-right">Resolved</th><th className="text-right">Within standard</th><th className="text-right">Median time</th></tr></thead><tbody>
        {report.issues.by_category.length?report.issues.by_category.map(c=><tr key={c.category}><td className="table-primary">{label(c.category)}</td><td className="text-right tabular-nums">{c.standard_hours} h</td><td className="text-right tabular-nums">{n(c.received)}</td><td className="text-right tabular-nums">{n(c.resolved)}</td><td className="text-right tabular-nums">{pct(c.within_standard_rate)}</td><td className="text-right tabular-nums">{c.median_hours===null?"—":`${c.median_hours} h`}</td></tr>)
          :<tr><td colSpan={6} className="text-center text-slate-500">No resident issues in this period.</td></tr>}
      </tbody></table></div>
    </Section>

    <Section n={5} title="Recycling">
      <p className="mb-3 text-sm text-slate-600">Recyclers collected {tonnes(report.recycling.totals.collected_kg)} and sold {tonnes(report.recycling.totals.sold_kg)} to industry, with {tonnes(report.recycling.totals.residue_kg)} of sorting residue. Recovery rate {pct(report.recycling.totals.recovery_rate)} of {tonnes((report.recycling.totals.collected_kg||0)+(report.recycling.totals.disposed_kg||0))} accounted for.</p>
      {report.recycling.categories.length>0&&<div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Material</th><th className="text-right">Collected</th><th className="text-right">Sold</th></tr></thead><tbody>{report.recycling.categories.map(c=><tr key={c.category}><td>{label(c.category)}</td><td className="text-right tabular-nums">{tonnes(c.collected_kg)}</td><td className="text-right tabular-nums">{tonnes(c.sold_kg)}</td></tr>)}</tbody></table></div>}
    </Section>

    <Section n={6} title="Licensing">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        {([["Permits in force at period end","in_force_at_end"],["New permits issued","issued"],["Renewed","renewed"],["Suspended","suspended"],["Expired","expired"],["Renewal requests received","renewal_requests"],["Expiring within 60 days","expiring_within_60_days"]] as const).map(([name,key])=><div key={key}><dt className="text-xs text-slate-500">{name}</dt><dd className="tabular-nums font-medium">{n(report.licensing[key])}</dd></div>)}
        <div><dt className="text-xs text-slate-500">No permit on record</dt><dd className="tabular-nums font-medium">{report.licensing.no_permit_on_record.length}</dd></div>
      </dl>
      {report.licensing.no_permit_on_record.length>0&&<p className="mt-3 text-sm text-slate-600">Operating without a permit on record: {report.licensing.no_permit_on_record.map(o=>o.name).join(", ")}.</p>}
    </Section>

    <Section n={7} title="Accountability">
      <div className="space-y-6">
        <div><h3 className="mb-2 text-sm font-medium text-slate-700">Compliance cases</h3><div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Category</th><th className="text-right">Opened</th><th className="text-right">Closed</th><th className="text-right">Open at end</th></tr></thead><tbody>
          {report.accountability.cases.length?report.accountability.cases.map(c=><tr key={c.category}><td>{label(c.category)}</td><td className="text-right tabular-nums">{c.opened}</td><td className="text-right tabular-nums">{c.closed}</td><td className="text-right tabular-nums">{c.open_at_end}</td></tr>):<tr><td colSpan={4} className="text-center text-slate-500">None</td></tr>}
        </tbody></table></div></div>
        <div><h3 className="mb-2 text-sm font-medium text-slate-700">Monthly returns</h3><div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Month</th><th className="text-right">Required</th><th className="text-right">Filed</th><th className="text-right">Late</th><th className="text-right">Outstanding</th></tr></thead><tbody>
          {report.accountability.returns.months.length?report.accountability.returns.months.map(m=><tr key={m.period}><td>{monthName(m.period)}</td><td className="text-right tabular-nums">{m.required}</td><td className="text-right tabular-nums">{m.filed}</td><td className="text-right tabular-nums">{m.late}</td><td className="text-right tabular-nums">{m.outstanding}</td></tr>):<tr><td colSpan={5} className="text-center text-slate-500">No returns were due in this period.</td></tr>}
        </tbody></table></div></div>
      </div>
    </Section>

    <Section n={8} title="Collector performance">
      <div className="table-wrap"><table className="w-full min-w-[760px] text-left print:min-w-0"><thead><tr><th>Collector</th><th className="text-right">Collections</th><th className="text-right">Completion</th><th className="text-right">Verified trips</th><th className="text-right">Disposed</th><th className="text-right">Issues beyond standard</th><th className="text-right">Score</th><th>Standing</th></tr></thead><tbody>
        {report.collectors.length?report.collectors.map(c=><tr key={c.id}><td><p className="table-primary">{c.name}</p><p className="table-secondary">{c.permit_number||"No permit on record"}</p></td><td className="text-right tabular-nums">{n(c.jobs)}</td><td className="text-right tabular-nums">{pct(c.completion_rate)}</td><td className="text-right tabular-nums">{pct(c.verification_rate)}</td><td className="text-right tabular-nums">{tonnes(c.disposed_kg)}</td><td className="text-right tabular-nums">{c.overdue_issues} of {c.open_issues}</td><td className="text-right font-semibold tabular-nums">{c.service_score??"—"}</td><td>{BAND[c.band]}</td></tr>)
          :<tr><td colSpan={8} className="text-center text-slate-500">No collectors active in this period.</td></tr>}
      </tbody></table></div>
    </Section>

    <Section n={9} title="Six-month trend">
      <div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Month</th><th className="text-right">Completion</th><th className="w-2/5">Delivered for disposal</th><th className="text-right">Resident issues</th><th className="text-right">Recyclables</th></tr></thead><tbody>
        {report.trend.map(m=><tr key={m.month}><td>{monthName(m.month)}</td><td className="text-right tabular-nums">{pct(m.completion_rate)}</td><td><div className="flex items-center gap-3"><span className="w-16 shrink-0 tabular-nums">{tonnes(m.disposed_kg)}</span><div className="h-1.5 w-full bg-slate-100"><div className="h-full bg-[var(--color-action)]" style={{width:`${m.disposed_kg/maxDisposal*100}%`}}/></div></div></td><td className="text-right tabular-nums">{n(m.issues)}</td><td className="text-right tabular-nums">{tonnes(m.recyclables_kg)}</td></tr>)}
      </tbody></table></div>
    </Section>

    <Section n={10} title="How these figures are produced">
      <ul className="space-y-1.5 text-xs leading-5 text-slate-600">
        <li>Scheduled collections exclude cancelled jobs. Completion = completed ÷ scheduled. Divisions come from each job&rsquo;s collection zone.</li>
        <li>Delivered for disposal = net weight of completed weighbridge tickets. Verified trips = completed trips with a weighbridge-verified weight.</li>
        <li>Resident issues are measured from report to resolution against KCCA&rsquo;s response standards: {Object.entries(report.standards).map(([k,v])=>`${label(k).toLowerCase()} ${v} h`).join(", ")}.</li>
        <li>Recovery rate = recyclables purchased by licensed recyclers ÷ (recyclables + weighbridge disposal). Recycling volumes only; no prices.</li>
        <li>Collector service score (0–100): completion 50, weighbridge verification 20, issues within standard 15, regulatory standing 15. Good ≥ 85, Watch ≥ 65.</li>
        <li>Licensing counts come from the permit history; monthly returns are counted for months that had fallen due when the report was prepared.</li>
      </ul>
    </Section>
  </article>;
}

function quarterOf(month:string){const [y,m]=month.split("-").map(Number);return `${y}-Q${Math.ceil(m/3)}`}

export default function CityReportPage(){
  const [periodType,setPeriodType]=useState<"month"|"quarter">("month");
  const [month,setMonth]=useState(()=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`});
  const [report,setReport]=useState<Report|null>(null),[issued,setIssued]=useState<Issued[]>([]),[viewing,setViewing]=useState<IssuedDetail|null>(null);
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[loading,setLoading]=useState(false),[issuing,setIssuing]=useState(false),[saving,setSaving]=useState(false);
  const canIssue=useHasRole("kcca_admin");
  const period=periodType==="month"?month:quarterOf(month);

  const loadIssued=useCallback(async()=>{try{setIssued((await apiRequest<{data:Issued[]}>("/api/waste/city-reports")).data)}catch{/* list is secondary */}},[]);
  const load=useCallback(async()=>{
    setLoading(true);setError("");setViewing(null);
    try{setReport((await apiRequest<{data:Report}>(`/api/waste/city-reports/live?period=${period}`)).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not prepare the report")}finally{setLoading(false)}
  },[period]);
  useEffect(()=>{const timer=window.setTimeout(()=>{void load();void loadIssued()},0);return()=>window.clearTimeout(timer)},[load,loadIssued]);

  const existing=useMemo(()=>issued.find(r=>r.period_key===period&&r.status==="issued"),[issued,period]);

  async function openIssued(id:string){
    try{setViewing((await apiRequest<{data:IssuedDetail}>(`/api/waste/city-reports/${id}`)).data);window.scrollTo({top:0})}
    catch(e){setError(e instanceof Error?e.message:"Could not open the issued report")}
  }

  async function issue(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);
    setSaving(true);setError("");
    try{
      const r=await apiRequest<{message:string;data:{id:string}}>("/api/waste/city-reports",{method:"POST",body:JSON.stringify({period,commentary:String(f.get("commentary")||"")||undefined,replaceReason:existing?String(f.get("replaceReason")||""):undefined})});
      setIssuing(false);setNotice(r.message);await loadIssued();await openIssued(r.data.id);
    }catch(e){setError(e instanceof Error?e.message:"Could not issue the report")}finally{setSaving(false)}
  }

  const shown=viewing?.data||report;

  return <AppShell><div className="mx-auto max-w-[1200px] space-y-6">
    <div className="no-print space-y-5">
      <header className="page-header"><div><p className="page-eyebrow">City oversight</p><h1>City reports</h1><p className="page-description">KCCA&rsquo;s monthly or quarterly report on waste services in Kampala. Review the draft, then issue it as the official, numbered record.</p></div></header>
      <div className="flex flex-wrap items-end gap-3">
        <div role="radiogroup" aria-label="Report period" className="flex overflow-hidden rounded-[var(--ui-radius)] border border-slate-300 bg-white text-sm">
          {(["month","quarter"] as const).map((t,i)=><button key={t} role="radio" aria-checked={periodType===t} onClick={()=>setPeriodType(t)} className={`min-h-0 rounded-none px-3 py-2 ${i?"border-l border-slate-300":""} ${periodType===t?"bg-slate-900 text-white":"text-slate-700 hover:bg-slate-50"}`}>{t==="month"?"Month":"Quarter"}</button>)}
        </div>
        <label className="text-sm text-slate-600"><span className="sr-only">Month</span><input type="month" value={month} onChange={e=>e.target.value&&setMonth(e.target.value)} className="border border-slate-300 px-3 py-1.5 text-sm"/></label>
        {periodType==="quarter"&&<span className="pb-2 text-sm text-slate-500">{period}</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={()=>window.print()} disabled={!shown} className="border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Print or save as PDF</button>
          <button onClick={()=>void openAuthenticatedFile(viewing?`/api/waste/city-reports/${viewing.id}/export.csv`:`/api/waste/city-reports/live/export.csv?period=${period}`,{download:viewing?`${viewing.report_number}-collectors.csv`:`kcca-collectors-${period}-draft.csv`}).catch(e=>setError(e.message))} className="border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Collectors CSV</button>
          {canIssue&&!viewing&&<button onClick={()=>setIssuing(true)} disabled={!report?.period.complete} title={report&&!report.period.complete?"A period can be issued once it has ended":undefined} className="bg-[var(--color-action)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{existing?"Issue replacement":"Issue report"}</button>}
        </div>
      </div>
      {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}
      {viewing?<Feedback tone="info"><span className="font-normal">Viewing official report {viewing.report_number}. <button onClick={()=>setViewing(null)} className="min-h-0 p-0 font-semibold underline">Back to the live draft</button></span></Feedback>
        :existing&&<Feedback tone="info"><span className="font-normal">{existing.report_number} has been issued for this period. <button onClick={()=>void openIssued(existing.id)} className="min-h-0 p-0 font-semibold underline">Open the official report</button></span></Feedback>}
    </div>

    {loading&&!shown?<p className="text-sm text-slate-500">Preparing the report…</p>:shown&&<div className={loading?"opacity-60":""}><ReportDocument report={shown} issued={viewing}/></div>}

    {issued.length>0&&<section className="no-print">
      <h2 className="mb-3 text-base font-semibold text-slate-900">Issued reports</h2>
      <div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Report</th><th>Period</th><th>Issued</th><th>Status</th><th/></tr></thead><tbody>
        {issued.map(r=><tr key={r.id}><td className="table-primary">{r.report_number}</td><td>{r.period_key}</td><td>{new Date(r.issued_at).toLocaleDateString("en-GB")}<p className="table-secondary">{r.issued_by_name}</p></td>
          <td>{r.status==="issued"?<span className="status status-active normal-case">Official</span>:<><span className="status normal-case">Superseded</span><p className="table-secondary">by {r.superseded_by_number}: {r.superseded_reason}</p></>}</td>
          <td className="text-right"><button onClick={()=>void openIssued(r.id)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Open</button></td></tr>)}
      </tbody></table></div>
    </section>}

    <Modal open={issuing} onClose={()=>setIssuing(false)} title={`Issue report for ${report?.period.label||""}`} description="Issuing freezes these figures as KCCA's official record with a report number. Later corrections need a replacement report.">
      <form onSubmit={issue} className="grid gap-4 text-sm">
        {existing&&<label className="font-medium text-slate-700">Why is {existing.report_number} being replaced?<input name="replaceReason" required minLength={5} className="mt-1 block w-full border border-slate-300 px-3 py-2.5 font-normal"/></label>}
        <label className="font-medium text-slate-700">KCCA commentary <span className="font-normal text-slate-500">(optional, printed at the top of the report)</span><textarea name="commentary" rows={5} maxLength={5000} placeholder="Context, actions KCCA is taking, notes on the figures" className="mt-1 block w-full border border-slate-300 px-3 py-2.5 font-normal"/></label>
        <button disabled={saving} className="justify-self-start bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">{saving?"Issuing…":"Issue official report"}</button>
      </form>
    </Modal>
  </div></AppShell>;
}
