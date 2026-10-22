"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,PageHeader,SectionHeading} from "@/components/ui/System";
import {ComplianceNoticeDialog,type NoticeDraft} from "@/components/command-center/ComplianceNoticeDialog";
import {apiRequest,openAuthenticatedFile} from "@/lib/api";
import {useHasRole} from "@/lib/session";

type Flag={code:string;severity:"action"|"watch";message:string};
type Recycler={id:string;name:string;is_active:boolean;collected_kg:number;sold_kg:number;sorting_input_kg:number;sorted_kg:number;residue_kg:number;stock_kg:number;aged_stock_kg:number;last_activity:string|null;active_days:number;closed_days:number;permit:{status:string;valid_until:string|null}|null;permit_number:string|null;flags:Flag[];standing:"good"|"watch"|"action"};
type Category={category:string;collected_kg:number;sold_kg:number};
type Month={month:string;collected_kg:number;sold_kg:number};
type Industry={industry:string;kg:number;recyclers:number};
type Period={from:string;to:string;label:string};
type FactoryRow={id:string;name:string;permit_number:string|null;accepted_kg:number;rejected_kg:number;input_kg:number;output_kg:number;residue_kg:number;dispatched_kg:number;stock_kg:number;yield_rate:number|null};
type CustodyException={sale_id:string;sold_on:string;sold_kg:number;received_kg:number|null;received_on:string|null;seller_name:string;factory_name:string;material_type:string;state:"overdue"|"shortfall"};
type Factories={totals:Record<string,number|null>;factories:FactoryRow[];custody_exceptions:CustodyException[]};
type Overview={period:Period;today:string;totals:{collected_kg:number;sold_kg:number;sorted_kg:number;residue_kg:number;stock_kg:number;disposed_kg:number;recovery_rate:number|null;recyclers:number;active_recyclers:number;needing_action:number;on_watch:number};categories:Category[];monthly:Month[];industries:Industry[];recyclers:Recycler[];factories?:Factories};
type Detail={recycler:Recycler;categories:Category[];monthly:Month[];industries:Industry[];closures:Array<{operating_date:string;status:string;closed_at:string;reopen_reason:string|null}>;aged_stock:Array<{material_type:string;kg:number;oldest:string}>};

const tonnes=(kg:number)=>kg>=1000?`${(kg/1000).toLocaleString("en-GB",{maximumFractionDigits:1})} t`:`${Math.round(kg).toLocaleString("en-GB")} kg`;
const date=(v:string|null)=>v?new Date(`${v}T00:00:00`).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"—";
const monthLabel=(m:string)=>new Date(`${m}-01T00:00:00`).toLocaleDateString("en-GB",{month:"short"});
const STANDING={good:{label:"Good",className:"status status-active normal-case"},watch:{label:"Watch",className:"status status-pending normal-case"},action:{label:"Action required",className:"status status-failed normal-case"}};
const PRESETS:Array<[string,string]>=[["30d","Last 30 days"],["90d","Last 90 days"],["year","Year to date"]];
const CATEGORY_LABEL:Record<string,string>={plastic:"Plastic",paper:"Paper and cardboard",metal:"Metal",glass:"Glass",organic:"Organic",textile:"Textile",other:"Other"};

function Bar({value,max,tone="bg-[var(--color-action)]"}:{value:number;max:number;tone?:string}){
  return <div className="h-1.5 w-full bg-slate-100"><div className={`h-full ${tone}`} style={{width:`${max?Math.max(value/max*100,value?2:0):0}%`}}/></div>;
}

function Trend({months}:{months:Month[]}){
  const max=Math.max(1,...months.flatMap(m=>[m.collected_kg,m.sold_kg]));
  return <div>
    <div className="flex h-36 items-end gap-3" role="img" aria-label={`Monthly recyclables: ${months.map(m=>`${monthLabel(m.month)} collected ${tonnes(m.collected_kg)}, sold ${tonnes(m.sold_kg)}`).join("; ")}`}>
      {months.map(m=><div key={m.month} className="flex h-full flex-1 items-end justify-center gap-1" title={`${monthLabel(m.month)}: collected ${tonnes(m.collected_kg)}, sold ${tonnes(m.sold_kg)}`}>
        <div className="w-1/3 max-w-5 bg-[var(--color-action)]" style={{height:`${m.collected_kg/max*100}%`}}/>
        <div className="w-1/3 max-w-5 bg-slate-400" style={{height:`${m.sold_kg/max*100}%`}}/>
      </div>)}
    </div>
    <div className="mt-2 flex gap-3 border-t border-slate-200 pt-2 text-xs text-slate-500">{months.map(m=><span key={m.month} className="flex-1 text-center">{monthLabel(m.month)}</span>)}</div>
    <div className="mt-3 flex gap-4 text-xs text-slate-600"><span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-[var(--color-action)]"/>Collected</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-slate-400"/>Sold to industry</span></div>
  </div>;
}

function CategoryTable({categories}:{categories:Category[]}){
  const max=Math.max(1,...categories.map(c=>c.collected_kg));
  if(!categories.length)return <p className="text-sm text-slate-500">No material recorded in this period.</p>;
  return <table className="w-full text-left"><thead><tr><th>Material</th><th className="w-2/5">Collected</th><th className="text-right">Sold</th></tr></thead><tbody>
    {categories.map(c=><tr key={c.category}><td className="table-primary">{CATEGORY_LABEL[c.category]||c.category}</td><td><div className="flex items-center gap-3"><span className="w-16 shrink-0 tabular-nums">{tonnes(c.collected_kg)}</span><Bar value={c.collected_kg} max={max}/></div></td><td className="text-right tabular-nums">{tonnes(c.sold_kg)}</td></tr>)}
  </tbody></table>;
}

function noticeFor(recycler:Recycler,period:Period):NoticeDraft{
  const permitFlag=recycler.flags.find(f=>f.code.startsWith("permit")||f.code==="no_permit");
  const due=new Date(Date.now()+(permitFlag?3:7)*86400000).toISOString().slice(0,10);
  return {
    key:`${recycler.id}-${Date.now()}`,organizationId:recycler.id,organizationName:recycler.name,
    category:permitFlag?"permit":"recycling_operations",
    severity:recycler.standing==="action"?"warning":"advisory",
    title:permitFlag?`${recycler.name}: KCCA permit ${permitFlag.code==="no_permit"?"missing":"not in force"}`:`${recycler.name}: recycling records need attention`,
    details:[`KCCA recycling oversight, ${period.label} (${period.from} to ${period.to}):`,...recycler.flags.map(f=>`- ${f.message}.`),`- Collected ${tonnes(recycler.collected_kg)}, sold ${tonnes(recycler.sold_kg)}, sorting residue ${tonnes(recycler.residue_kg)}, stock held ${tonnes(recycler.stock_kg)}.`].join("\n"),
    requiredAction:permitFlag?"Apply for or renew the KCCA permit and confirm the date it will be in force.":"Correct the records or operations listed and confirm the actions taken, including how sorting residue is disposed of.",
    dueDate:due,
  };
}

export default function RecyclingOversightPage(){
  const [preset,setPreset]=useState("30d"),[custom,setCustom]=useState({from:"",to:""});
  const [data,setData]=useState<Overview|null>(null),[detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[loading,setLoading]=useState(true);
  const [filter,setFilter]=useState<"all"|"action"|"watch">("all"),[query,setQuery]=useState(""),[draft,setDraft]=useState<NoticeDraft|null>(null);
  const canIssue=useHasRole("kcca_admin");
  const qs=useMemo(()=>preset==="custom"&&custom.from&&custom.to?`from=${custom.from}&to=${custom.to}`:`period=${preset==="custom"?"30d":preset}`,[preset,custom]);

  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{setData((await apiRequest<{data:Overview}>(`/api/waste/recycling-oversight?${qs}`)).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load recycling oversight")}
    finally{setLoading(false)}
  },[qs]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);

  async function openRecycler(row:Recycler){
    setDetail({recycler:row,categories:[],monthly:[],industries:[],closures:[],aged_stock:[]});
    try{setDetail((await apiRequest<{data:Detail}>(`/api/waste/recycling-oversight/recyclers/${row.id}?${qs}`)).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load the recycler");setDetail(null)}
  }

  const rows=useMemo(()=>(data?.recyclers||[]).filter(r=>(filter==="all"||r.standing===filter)&&r.name.toLowerCase().includes(query.toLowerCase())),[data,filter,query]);
  const t=data?.totals;
  const kpis:Array<[string,string,string|undefined]>=t?[
    ["Recyclables collected",tonnes(t.collected_kg),`by ${t.active_recyclers} of ${t.recyclers} recyclers`],
    ["Sold to industry",tonnes(t.sold_kg),undefined],
    ["Sorting residue",tonnes(t.residue_kg),"needs licensed disposal"],
    ["Stock held now",tonnes(t.stock_kg),undefined],
    ["Recovery rate",t.recovery_rate===null?"—":`${t.recovery_rate}%`,`of ${tonnes(t.collected_kg+t.disposed_kg)} accounted for`],
  ]:[];

  return <AppShell><div className="mx-auto max-w-[1500px] space-y-8">
    <PageHeader eyebrow="City oversight" title="Recycling oversight" description="What licensed recyclers collect, sort and sell across Kampala, and who needs attention. Volumes only: prices, customers and cash stay with each company."
      action={<button onClick={()=>void openAuthenticatedFile(`/api/waste/recycling-oversight/export.csv?${qs}`,{download:`kcca-recycling-${data?.period.from||"period"}.csv`}).catch(e=>setError(e.message))} className="border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Export CSV</button>}/>

    <div className="flex flex-wrap items-end gap-3">
      <div role="radiogroup" aria-label="Reporting period" className="flex overflow-hidden rounded-[var(--ui-radius)] border border-slate-300 bg-white text-sm">
        {[...PRESETS,["custom","Custom"] as [string,string]].map(([key,label],i)=><button key={key} role="radio" aria-checked={preset===key} onClick={()=>setPreset(key)} className={`min-h-0 rounded-none px-3 py-2 ${i?"border-l border-slate-300":""} ${preset===key?"bg-slate-900 text-white":"text-slate-700 hover:bg-slate-50"}`}>{label}</button>)}
      </div>
      {preset==="custom"&&<div className="flex items-center gap-2 text-sm"><input type="date" aria-label="From" value={custom.from} max={custom.to||undefined} onChange={e=>setCustom(c=>({...c,from:e.target.value}))} className="border border-slate-300 px-2 py-1.5"/><span className="text-slate-400">to</span><input type="date" aria-label="To" value={custom.to} min={custom.from||undefined} onChange={e=>setCustom(c=>({...c,to:e.target.value}))} className="border border-slate-300 px-2 py-1.5"/></div>}
      {data&&<p className="pb-2 text-sm text-slate-500">{date(data.period.from)} – {date(data.period.to)}</p>}
    </div>

    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}

    <div className={`grid grid-cols-2 rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white md:grid-cols-5 ${loading?"opacity-60":""}`}>
      {(kpis.length?kpis:Array.from({length:5},()=>["","—",undefined] as [string,string,undefined])).map(([label,value,hint],i)=><div key={i} className={`px-4 py-4 ${i?"border-l border-slate-200":""} ${i>=2?"max-md:border-t":""}`}>
        <p className="text-xs font-medium text-slate-500">{label||" "}</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}</p>{hint&&<p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
      </div>)}
    </div>

    {data&&<>
      <div className="grid gap-8 lg:grid-cols-2">
        <section><SectionHeading title="Materials" description="Grouped by each company's own material catalogue."/><div className="table-wrap"><CategoryTable categories={data.categories}/></div></section>
        <section><SectionHeading title="Last six months" description="City-wide recyclables collected and sold, by month."/><div className="card p-5"><Trend months={data.monthly}/></div></section>
      </div>

      <section>
        <SectionHeading title="Recyclers" description={`${t!.needing_action} need action · ${t!.on_watch} on watch`}/>
        <div className="table-toolbar">
          <input className="table-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search recycler"/>
          <select value={filter} onChange={e=>setFilter(e.target.value as typeof filter)} className="border border-slate-300 px-3 py-2 text-sm"><option value="all">All standings</option><option value="action">Action required</option><option value="watch">Watch</option></select>
          <span className="table-count">{rows.length} recyclers</span>
        </div>
        <div className="table-wrap"><table className="w-full min-w-[1080px] text-left">
          <thead><tr><th>Recycler</th><th className="text-right">Collected</th><th className="text-right">Sold</th><th className="text-right">Residue</th><th className="text-right">Stock held</th><th>Daily closing</th><th>Last activity</th><th>Standing</th><th/></tr></thead>
          <tbody>{rows.map(r=><tr key={r.id}>
            <td><p className="table-primary">{r.name}</p><p className="table-secondary">{r.permit_number||"No permit on record"}</p></td>
            <td className="text-right tabular-nums">{tonnes(r.collected_kg)}</td>
            <td className="text-right tabular-nums">{tonnes(r.sold_kg)}</td>
            <td className="text-right tabular-nums">{r.sorting_input_kg?`${Math.round(r.residue_kg/r.sorting_input_kg*100)}%`:"—"}</td>
            <td className="text-right tabular-nums">{tonnes(r.stock_kg)}{r.aged_stock_kg>0&&<p className="table-secondary">{tonnes(r.aged_stock_kg)} over 90 days</p>}</td>
            <td className="tabular-nums">{r.active_days?`${r.closed_days} of ${r.active_days} days`:"—"}</td>
            <td>{date(r.last_activity)}</td>
            <td><span className={STANDING[r.standing].className}>{STANDING[r.standing].label}</span>{r.flags[0]&&<p className="table-secondary max-w-[220px]">{r.flags[0].message}{r.flags.length>1?` · +${r.flags.length-1} more`:""}</p>}</td>
            <td className="text-right"><button onClick={()=>void openRecycler(r)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Open</button></td>
          </tr>)}
          {!rows.length&&<tr><td colSpan={9} className="p-8 text-center text-sm text-slate-500">{data.recyclers.length?"No recyclers match this view.":"No recycling companies on the platform yet."}</td></tr>}</tbody>
        </table></div>
      </section>

      {data.factories&&<section>
        <SectionHeading title="Recycling factories" description={`${tonnes(data.factories.totals.accepted_kg||0)} accepted, ${tonnes(data.factories.totals.output_kg||0)} produced${data.factories.totals.yield_rate!==null?` (${data.factories.totals.yield_rate}% yield)`:""}, ${tonnes(data.factories.totals.residue_kg||0)} residue in the period`}/>
        {data.factories.factories.length?<div className="table-wrap"><table className="w-full min-w-[900px] text-left">
          <thead><tr><th>Factory</th><th className="text-right">Accepted</th><th className="text-right">Rejected</th><th className="text-right">Processed</th><th className="text-right">Output</th><th className="text-right">Yield</th><th className="text-right">Residue</th><th className="text-right">Dispatched</th><th className="text-right">Stock</th></tr></thead>
          <tbody>{data.factories.factories.map(f=><tr key={f.id}>
            <td><p className="table-primary">{f.name}</p><p className="table-secondary">{f.permit_number||"No permit on record"}</p></td>
            {(["accepted_kg","rejected_kg","input_kg","output_kg"] as const).map(k=><td key={k} className="text-right tabular-nums">{tonnes(f[k])}</td>)}
            <td className="text-right tabular-nums">{f.yield_rate===null?"—":`${f.yield_rate}%`}</td>
            {(["residue_kg","dispatched_kg","stock_kg"] as const).map(k=><td key={k} className="text-right tabular-nums">{tonnes(f[k])}</td>)}
          </tr>)}</tbody></table></div>:<EmptyState title="No recycling factories on the platform yet"/>}
        <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-900">Chain of custody</h3>
        {data.factories.custody_exceptions.length?<div className="table-wrap"><table className="w-full min-w-[760px] text-left">
          <thead><tr><th>Delivery</th><th>Material</th><th className="text-right">Sold</th><th className="text-right">Received</th><th>Issue</th></tr></thead>
          <tbody>{data.factories.custody_exceptions.map(c=><tr key={c.sale_id}>
            <td><p className="table-primary">{c.seller_name} → {c.factory_name}</p><p className="table-secondary">Sold {date(c.sold_on)}</p></td>
            <td>{c.material_type}</td><td className="text-right tabular-nums">{tonnes(c.sold_kg)}</td>
            <td className="text-right tabular-nums">{c.received_kg===null?"—":tonnes(c.received_kg)}</td>
            <td className="text-[var(--color-warning)]">{c.state==="overdue"?"Not received after 7 days":`${tonnes(c.sold_kg-(c.received_kg||0))} short`}</td>
          </tr>)}</tbody></table></div>:<p className="text-sm text-slate-500">Every delivery sold to a factory in this period was received in full (or is within its first 7 days).</p>}
      </section>}

      <section className="max-w-3xl"><SectionHeading title="Where material goes" description="Sold volume by the buyer industry recorded on each sale."/>
        {data.industries.length?<div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Industry</th><th className="text-right">Volume</th><th className="text-right">Recyclers selling</th></tr></thead><tbody>
          {data.industries.map(i=><tr key={i.industry}><td className="table-primary">{i.industry}</td><td className="text-right tabular-nums">{tonnes(i.kg)}</td><td className="text-right tabular-nums">{i.recyclers}</td></tr>)}
        </tbody></table></div>:<EmptyState title="No sales recorded in this period"/>}
      </section>
    </>}

    {detail&&<div className="anim-fade fixed inset-0 z-50 flex justify-end bg-slate-900/40" onMouseDown={e=>{if(e.target===e.currentTarget)setDetail(null)}}>
      <section className="h-full w-full max-w-2xl overflow-y-auto bg-white">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-slate-200 bg-white px-6 py-5">
          <div><p className="text-xs font-medium text-slate-500">{detail.recycler.permit_number||"No permit on record"}</p><h2 className="mt-1 text-xl font-semibold">{detail.recycler.name}</h2><div className="mt-2"><span className={STANDING[detail.recycler.standing].className}>{STANDING[detail.recycler.standing].label}</span></div></div>
          <button onClick={()=>setDetail(null)} className="text-sm font-medium text-slate-500 hover:text-slate-900">Close</button>
        </header>
        <div className="space-y-8 px-6 py-6">
          {detail.recycler.flags.length>0&&<div><h3 className="text-sm font-semibold">Why</h3><ul className="mt-2 space-y-1.5 text-sm">{detail.recycler.flags.map(f=><li key={f.code} className={f.severity==="action"?"text-[var(--color-danger)]":"text-[var(--color-warning)]"}>— {f.message}</li>)}</ul>
            <div className="mt-4 flex flex-wrap gap-2">
              {canIssue&&<button onClick={()=>setDraft(noticeFor(detail.recycler,data!.period))} className="bg-[var(--color-action)] px-3 py-2 text-sm font-semibold text-white">Issue compliance notice</button>}
              {detail.recycler.flags.some(f=>f.code.startsWith("permit")||f.code==="no_permit")&&<Link href="/dashboard/permits" className="border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Go to permits</Link>}
            </div>
          </div>}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
            {[["Collected",tonnes(detail.recycler.collected_kg)],["Sorted output",tonnes(detail.recycler.sorted_kg)],["Sorting residue",tonnes(detail.recycler.residue_kg)],["Sold",tonnes(detail.recycler.sold_kg)],["Stock held",tonnes(detail.recycler.stock_kg)],["Last activity",date(detail.recycler.last_activity)]].map(([a,b])=><div key={a}><dt className="text-xs font-medium text-slate-500">{a}</dt><dd className="mt-1 tabular-nums">{b}</dd></div>)}
          </dl>
          <div><h3 className="mb-2 text-sm font-semibold">Materials</h3><div className="table-wrap"><CategoryTable categories={detail.categories}/></div></div>
          {detail.monthly.length>0&&<div><h3 className="mb-3 text-sm font-semibold">Last six months</h3><Trend months={detail.monthly}/></div>}
          {detail.aged_stock.length>0&&<div><h3 className="mb-2 text-sm font-semibold">Stock held over 90 days</h3><div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Material</th><th className="text-right">Weight</th><th className="text-right">Oldest</th></tr></thead><tbody>{detail.aged_stock.map(a=><tr key={a.material_type}><td>{a.material_type}</td><td className="text-right tabular-nums">{tonnes(a.kg)}</td><td className="text-right">{date(a.oldest)}</td></tr>)}</tbody></table></div></div>}
          {detail.industries.length>0&&<div><h3 className="mb-2 text-sm font-semibold">Buyers by industry</h3><ul className="card divide-y divide-slate-100">{detail.industries.map(i=><li key={i.industry} className="flex justify-between px-4 py-2.5 text-sm"><span>{i.industry}</span><span className="tabular-nums">{tonnes(i.kg)}</span></li>)}</ul></div>}
          <div><h3 className="mb-2 text-sm font-semibold">Recent daily closings</h3>{detail.closures.length?<ul className="card divide-y divide-slate-100">{detail.closures.map(c=><li key={c.operating_date} className="flex justify-between px-4 py-2.5 text-sm"><span>{date(c.operating_date)}</span><span className={c.status==="closed"?"text-slate-600":"text-[var(--color-warning)]"}>{c.status==="closed"?"Closed":`Reopened${c.reopen_reason?`: ${c.reopen_reason}`:""}`}</span></li>)}</ul>:<p className="text-sm text-slate-500">No daily closings recorded.</p>}</div>
        </div>
      </section>
    </div>}

    <ComplianceNoticeDialog draft={draft} onClose={()=>setDraft(null)} onIssued={message=>{setDraft(null);setNotice(message)}}/>
  </div></AppShell>;
}
