"use client";
import {Fragment,useCallback,useEffect,useMemo,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {apiRequest} from "@/lib/api";
import {useHasRole} from "@/lib/session";

type Figures={locations:number;operators:number;stops_due:number;stops_completed:number;stops_missed:number;receipts:number;collected_kg:string;
  billed_ugx:string;settled_ugx:string;paid_ugx:string;overdue_ugx:string;households_overdue:number};
type Constituency=Figures&{id:string;code:string;name:string;division:string;areas:number;areas_unserved:number};
type Overview={constituencies:Constituency[];unassigned:(Figures&{division_id:string;division:string;unassigned_areas:number})[];noArea:Figures};
type Detail={constituency:{id:string;code:string;name:string;division:string};areas:(Figures&{id:string;name:string})[];
  operators:{id:string;name:string;locations:number;stops_due:number;stops_completed:number;stops_missed:number;receipts:number}[]};
type Assignments={constituencies:{id:string;name:string;division_id:string}[];areas:{id:string;name:string;division_id:string;division:string;constituency_id:string|null;locations:number}[]};

const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";
const n=(v:number|string)=>Number(v).toLocaleString("en-GB");
const ugx=(v:string|number)=>{const x=Number(v);return x>=1e6?`${(x/1e6).toLocaleString("en-GB",{maximumFractionDigits:1})}M`:x>=1e3?`${Math.round(x/1e3).toLocaleString("en-GB")}k`:n(x)};
const rate=(part:number,whole:number)=>whole>0?Math.round(part/whole*100):null;
const kampalaDay=(offset=0)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Kampala"}).format(new Date(Date.now()+offset*86400000));

function Pct({part,whole,low=85}:{part:number;whole:number;low?:number}){
  const value=rate(part,whole);
  return value===null?<span className="text-slate-400">—</span>:<span className={value<low?"font-semibold text-[var(--color-warning)]":""}>{value}%</span>;
}

export default function ConstituenciesPage(){
  const kcca=useHasRole("kcca_admin");
  const [from,setFrom]=useState(()=>kampalaDay(-29)),[to,setTo]=useState(()=>kampalaDay());
  const [data,setData]=useState<Overview|null>(null),[selected,setSelected]=useState<string|null>(null),[detail,setDetail]=useState<Detail|null>(null);
  const [assigning,setAssigning]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const load=useCallback(async()=>{
    try{setData((await apiRequest<{data:Overview}>(`/api/waste/constituencies?from=${from}&to=${to}`)).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load constituencies")}
  },[from,to]);
  const loadDetail=useCallback(async(code:string)=>{
    try{setDetail((await apiRequest<{data:Detail}>(`/api/waste/constituencies/${code}?from=${from}&to=${to}`)).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load the constituency")}
  },[from,to]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  useEffect(()=>{const timer=window.setTimeout(()=>{setDetail(null);if(selected)void loadDetail(selected)},0);return()=>window.clearTimeout(timer)},[selected,loadDetail]);

  const unassignedAreas=data?.unassigned.reduce((s,u)=>s+u.unassigned_areas,0)??0;
  const city=useMemo(()=>{
    if(!data)return null;
    const rows:Figures[]=[...data.constituencies,...data.unassigned,data.noArea];
    const sum=(k:keyof Figures)=>rows.reduce((s,r)=>s+Number(r[k]),0);
    return {locations:sum("locations"),due:sum("stops_due"),completed:sum("stops_completed"),missed:sum("stops_missed"),kg:sum("collected_kg"),billed:sum("billed_ugx"),settled:sum("settled_ugx"),paid:sum("paid_ugx"),overdue:sum("overdue_ugx")};
  },[data]);

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow="City oversight" title="Constituencies"
      description="Collection, receipts and billing in each of Kampala's nine constituencies, counted at the household's service location. Compare how each constituency is served, where collections are missed, and which operators serve it."
      action={kcca?<button onClick={()=>setAssigning(true)} className="border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800">Assign areas</button>:undefined}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}
    {unassignedAreas>0&&<div className="border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {unassignedAreas} areas in {data?.unassigned.filter(u=>u.unassigned_areas>0).length} divisions are not assigned to a constituency yet. Their households are counted under the division below until {kcca?"you assign them":"KCCA assigns them"}.
      {kcca&&<> <button onClick={()=>setAssigning(true)} className="min-h-0 px-0 py-0 font-semibold underline underline-offset-2">Assign areas</button></>}</div>}

    <div className="flex flex-wrap items-end gap-3 text-sm">
      <label className="font-medium text-slate-700">From<input type="date" value={from} max={to} onChange={e=>e.target.value&&setFrom(e.target.value)} className={`${field} w-44`}/></label>
      <label className="font-medium text-slate-700">To<input type="date" value={to} min={from} onChange={e=>e.target.value&&setTo(e.target.value)} className={`${field} w-44`}/></label>
    </div>

    {city&&<div className="grid grid-cols-2 rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white lg:grid-cols-4">
      <Tile label="Households served" value={n(city.locations)} note="service locations with an active operator"/>
      <Tile label="Collections done" value={rate(city.completed,city.due)===null?"—":`${rate(city.completed,city.due)}%`} note={`${n(city.completed)} of ${n(city.due)} due · ${n(city.missed)} missed`} border/>
      <Tile label="Bills paid" value={rate(city.settled,city.billed)===null?"—":`${rate(city.settled,city.billed)}%`} note={`of UGX ${ugx(city.billed)} billed in the period · UGX ${ugx(city.paid)} received`} border/>
      <Tile label="Overdue now" value={`UGX ${ugx(city.overdue)}`} note={`${(city.kg/1000).toLocaleString("en-GB",{maximumFractionDigits:1})} t on receipts in the period`} border/>
    </div>}

    {data&&<section>
      <div className="table-wrap"><table className="w-full min-w-[1180px] text-left">
        <thead><tr><th>Constituency</th><th className="text-right">Households</th><th className="text-right">Operators</th><th className="text-right">Collections done</th><th className="text-right">Missed</th>
          <th className="text-right">Receipts</th><th className="text-right">Bills paid</th><th className="text-right">Overdue (UGX)</th><th className="text-right">Areas served</th><th/></tr></thead>
        <tbody>
          {data.constituencies.map(c=><Fragment key={c.id}><tr className={selected===c.code?"bg-[var(--color-action-soft)]":""}>
            <td><p className="table-primary">{c.name}</p><p className="table-secondary">{c.division}</p></td>
            <Cells f={c}/>
            <td className="text-right tabular-nums">{c.areas?<span className={c.areas_unserved?"text-[var(--color-warning)]":""}>{c.areas-c.areas_unserved} of {c.areas}</span>:<span className="text-slate-400">no areas yet</span>}</td>
            <td className="text-right"><button onClick={()=>setSelected(selected===c.code?null:c.code)} className="border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">{selected===c.code?"Close":"Open"}</button></td>
          </tr>
          {selected===c.code&&<tr><td colSpan={10} className="bg-slate-50 p-4"><DetailView detail={detail}/></td></tr>}</Fragment>)}
          {data.unassigned.map(u=><tr key={u.division_id} className="text-slate-600">
            <td><p>{u.division}, areas not assigned</p><p className="table-secondary">{u.unassigned_areas} areas</p></td><Cells f={u}/><td/><td/></tr>)}
          {data.noArea.locations+data.noArea.stops_due+Number(data.noArea.billed_ugx)>0&&<tr className="text-slate-600">
            <td><p>No area recorded</p><p className="table-secondary">locations without an area</p></td><Cells f={data.noArea}/><td/><td/></tr>}
        </tbody>
      </table></div>
      <p className="mt-2 text-xs text-slate-500">Collections done: completed stops of those due in the period. Missed: skipped, or still open after their day. Bills paid: the share of bills issued in the period that has been paid. Areas served: areas with at least one household an operator serves.</p>
    </section>}

    {kcca&&<AssignDialog open={assigning} onClose={()=>setAssigning(false)} onChanged={async m=>{setNotice(m);setError("");await load();if(selected)await loadDetail(selected)}}/>}
  </div></AppShell>;
}

function Cells({f}:{f:Figures}){
  return <>
    <td className="text-right tabular-nums">{n(f.locations)}</td>
    <td className="text-right tabular-nums">{n(f.operators)}</td>
    <td className="text-right tabular-nums"><Pct part={f.stops_completed} whole={f.stops_due}/><p className="table-secondary">{n(f.stops_completed)} of {n(f.stops_due)}</p></td>
    <td className={`text-right tabular-nums ${f.stops_missed?"text-[var(--color-danger)]":""}`}>{n(f.stops_missed)}</td>
    <td className="text-right tabular-nums">{n(f.receipts)}<p className="table-secondary">{(Number(f.collected_kg)/1000).toLocaleString("en-GB",{maximumFractionDigits:1})} t</p></td>
    <td className="text-right tabular-nums"><Pct part={Number(f.settled_ugx)} whole={Number(f.billed_ugx)} low={70}/><p className="table-secondary">{ugx(f.billed_ugx)} billed</p></td>
    <td className="text-right tabular-nums">{ugx(f.overdue_ugx)}<p className="table-secondary">{f.households_overdue} households</p></td>
  </>;
}

function Tile({label,value,note,border=false}:{label:string;value:string;note:string;border?:boolean}){
  return <div className={`px-4 py-3 ${border?"border-l border-slate-200":""}`}><p className="text-xs font-medium text-slate-500">{label}</p>
    <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}</p><p className="text-xs text-slate-500">{note}</p></div>;
}

function DetailView({detail}:{detail:Detail|null}){
  if(!detail)return <p className="text-sm text-slate-500">Loading…</p>;
  const served=detail.areas.filter(a=>a.locations>0);
  return <div className="grid gap-5 xl:grid-cols-2">
    <div><h3 className="mb-2 font-semibold text-slate-900">Operators in {detail.constituency.name}</h3>
      {detail.operators.length?<div className="table-wrap bg-white"><table className="w-full text-left text-sm"><thead><tr><th>Operator</th><th className="text-right">Households</th><th className="text-right">Collections done</th><th className="text-right">Missed</th><th className="text-right">Receipts</th></tr></thead>
        <tbody>{detail.operators.map(o=><tr key={o.id}><td className="table-primary">{o.name}</td><td className="text-right tabular-nums">{n(o.locations)}</td>
          <td className="text-right tabular-nums"><Pct part={o.stops_completed} whole={o.stops_due}/> <span className="text-xs text-slate-500">{o.stops_completed}/{o.stops_due}</span></td>
          <td className={`text-right tabular-nums ${o.stops_missed?"text-[var(--color-danger)]":""}`}>{o.stops_missed}</td><td className="text-right tabular-nums">{n(o.receipts)}</td></tr>)}</tbody></table></div>
        :<EmptyState title="No operator serves households here" description="No household in this constituency has an active collection company."/>}
    </div>
    <div><h3 className="mb-2 font-semibold text-slate-900">Areas <span className="text-sm font-normal text-slate-500">· {served.length} of {detail.areas.length} served</span></h3>
      {detail.areas.length?<div className="table-wrap bg-white"><table className="w-full text-left text-sm"><thead><tr><th>Area</th><th className="text-right">Households</th><th className="text-right">Collections done</th><th className="text-right">Missed</th><th className="text-right">Overdue (UGX)</th></tr></thead>
        <tbody>{[...detail.areas].sort((a,b)=>b.locations-a.locations||a.name.localeCompare(b.name)).map(a=><tr key={a.id} className={a.locations?"":"text-slate-400"}><td>{a.name}{!a.locations&&" · not served"}</td>
          <td className="text-right tabular-nums">{n(a.locations)}</td><td className="text-right tabular-nums"><Pct part={a.stops_completed} whole={a.stops_due}/></td>
          <td className="text-right tabular-nums">{n(a.stops_missed)}</td><td className="text-right tabular-nums">{ugx(a.overdue_ugx)}</td></tr>)}</tbody></table></div>
        :<p className="text-sm text-slate-600">No areas are assigned to this constituency yet.</p>}
    </div>
  </div>;
}

function AssignDialog({open,onClose,onChanged}:{open:boolean;onClose:()=>void;onChanged:(m:string)=>Promise<void>}){
  const [data,setData]=useState<Assignments|null>(null),[onlyUnassigned,setOnlyUnassigned]=useState(true),[saving,setSaving]=useState<string|null>(null),[error,setError]=useState("");
  const load=useCallback(async()=>{try{setData((await apiRequest<{data:Assignments}>("/api/waste/constituencies/areas")).data)}catch(e){setError(e instanceof Error?e.message:"Could not load areas")}},[]);
  useEffect(()=>{const timer=window.setTimeout(()=>{if(open)void load()},0);return()=>window.clearTimeout(timer)},[open,load]);
  async function assign(areaId:string,constituencyId:string){
    setSaving(areaId);setError("");
    try{const r=await apiRequest<{message:string}>(`/api/waste/constituencies/areas/${areaId}`,{method:"PUT",body:JSON.stringify({constituencyId:constituencyId||null})});await load();await onChanged(r.message)}
    catch(e){setError(e instanceof Error?e.message:"Could not assign the area")}finally{setSaving(null)}
  }
  const areas=data?.areas.filter(a=>!onlyUnassigned||!a.constituency_id)??[];
  const divisions=[...new Set(areas.map(a=>a.division))];
  return <Modal open={open} title="Assign areas to constituencies" description="Each area of the catalogue belongs to one constituency of its division. Households in the area are counted there from then on, including past collections and bills. Changes are kept in the audit log." onClose={onClose}>
    <div className="grid gap-4 text-sm">
      <label className="flex items-center gap-2"><input type="checkbox" checked={onlyUnassigned} onChange={e=>setOnlyUnassigned(e.target.checked)}/>Show only areas not assigned yet</label>
      {error&&<p className="text-[var(--color-danger)]">{error}</p>}
      {!data?<p className="text-slate-500">Loading…</p>:areas.length?divisions.map(division=><div key={division}>
        <h3 className="mb-1.5 font-semibold text-slate-900">{division}</h3>
        <ul className="divide-y divide-slate-100 border border-slate-200">{areas.filter(a=>a.division===division).map(a=><li key={a.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
          <span>{a.name}{a.locations?<span className="text-xs text-slate-500"> · {a.locations} locations</span>:null}</span>
          <select disabled={saving===a.id} value={a.constituency_id??""} onChange={e=>void assign(a.id,e.target.value)} className="w-48 border border-slate-300 px-2 py-1.5 disabled:opacity-50">
            <option value="">Not assigned</option>{data.constituencies.filter(c=>c.division_id===a.division_id).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </li>)}</ul></div>)
        :<p className="text-slate-600">Every area is assigned.</p>}
    </div>
  </Modal>;
}
