"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {apiRequest,openAuthenticatedFile} from "@/lib/api";
import {useHasRole} from "@/lib/session";
import {dateTime} from "@/lib/receipts";

type Sums={landfilled_t:string;diverted_t:string;measured_t:string;weighed_t:string;landfilled_co2e_t:string;avoided_co2e_t:string};
type Overview={totals:Sums;months:(Sums&{month:string})[];streams:(Sums&{code:string;name:string})[];operators:(Sums&{id:string;name:string;type:string})[];
  refreshed:{refreshed_at:string;factor_version:number;trigger_source:string}|null;certificates:{issued:number;revoked:number}};
type Stream={code:string;name:string;doc:string;default_share_pct:string};
type FactorSet={version:number;methodology:string;docf:string;mcf:string;methane_fraction:string;oxidation:string;gwp_ch4:string;change_summary:string|null;published_by_name:string|null;published_at:string};
type Factors={streams:Stream[];current:FactorSet;versions:FactorSet[]};
type Load={id:string;ticket_number:string;operation_date:string;registration:string;status:string;net_kg:string|null;facility_name:string;facility_kind:string;
  organization_name:string;composition_method:string|null;shares:Record<string,number>|null;sample_kg:string|null;composition_notes:string|null;
  certificate_id:string|null;certificate_number:string|null;verification_code:string|null;revoked_at:string|null};

const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";
const t=(v:string|number)=>Number(v).toLocaleString("en-GB",{maximumFractionDigits:1});
const pct=(part:number,whole:number)=>whole>0?`${Math.round(part/whole*100)}%`:"—";
const monthLabel=(m:string)=>new Date(`${m}-01T00:00:00`).toLocaleDateString("en-GB",{month:"short",year:"numeric"});
const kampalaMonth=(offset=0)=>{const d=new Date(new Date().toLocaleString("en-US",{timeZone:"Africa/Kampala"}));d.setDate(1);d.setMonth(d.getMonth()+offset);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`};
const lastDay=(m:string)=>{const [y,mo]=m.split("-").map(Number);return `${m}-${String(new Date(y,mo,0).getDate()).padStart(2,"0")}`};
const KIND:Record<string,string>={landfill:"Landfill",transfer_station:"Transfer station",composting:"Composting",materials_recovery:"Materials recovery"};

export default function LandfillPage(){
  const kcca=useHasRole("kcca_admin"),systemAdmin=useHasRole("system_admin"),operator=useHasRole("weighbridge_operator"),companyAdmin=useHasRole("company_admin");
  const cityWide=kcca||systemAdmin||operator,canCompose=kcca||operator;
  const [from,setFrom]=useState(()=>kampalaMonth(-5)),[to,setTo]=useState(()=>kampalaMonth());
  const [loadMonth,setLoadMonth]=useState(()=>kampalaMonth()),[filter,setFilter]=useState<"all"|"missing"|"recorded">("all");
  const [overview,setOverview]=useState<Overview|null>(null),[factors,setFactors]=useState<Factors|null>(null),[loads,setLoads]=useState<Load[]|null>(null);
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[composing,setComposing]=useState<Load|null>(null),[publishing,setPublishing]=useState(false),[busy,setBusy]=useState(false);

  const load=useCallback(async()=>{
    try{
      const [o,f]=await Promise.all([apiRequest<{data:Overview}>(`/api/waste/landfill/overview?from=${from}&to=${to}`),apiRequest<{data:Factors}>("/api/waste/landfill/streams")]);
      setOverview(o.data);setFactors(f.data);
    }catch(e){setError(e instanceof Error?e.message:"Could not load the landfill data")}
  },[from,to]);
  const loadLoads=useCallback(async()=>{
    try{setLoads((await apiRequest<{data:Load[]}>(`/api/waste/landfill/loads?from=${loadMonth}-01&to=${lastDay(loadMonth)}&composition=${filter}`)).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load the weighbridge loads")}
  },[loadMonth,filter]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  useEffect(()=>{const timer=window.setTimeout(()=>void loadLoads(),0);return()=>window.clearTimeout(timer)},[loadLoads]);

  async function done(message:string){setComposing(null);setPublishing(false);setNotice(message);setError("");await Promise.all([load(),loadLoads()])}
  async function recalculate(){
    setBusy(true);setError("");
    try{await done((await apiRequest<{message:string}>("/api/waste/landfill/baseline/refresh",{method:"POST"})).message)}
    catch(e){setError(e instanceof Error?e.message:"Could not recalculate")}finally{setBusy(false)}
  }
  async function file(path:string,download?:string){
    try{await openAuthenticatedFile(path,download?{download}:{})}catch(e){setError(e instanceof Error?e.message:"Could not open the file")}
  }

  const total=overview?.totals,landfilled=Number(total?.landfilled_t??0),diverted=Number(total?.diverted_t??0),weighed=Number(total?.weighed_t??0);
  const streamName=useMemo(()=>Object.fromEntries((factors?.streams??[]).map(s=>[s.code,s.name])),[factors]);

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow={cityWide?"City oversight":"KCCA regulation"} title="Landfill and carbon"
      description="Load certificates and the monthly landfill and methane baseline."
      action={(kcca||systemAdmin||companyAdmin)?<button onClick={()=>void file(`/api/waste/landfill/baseline/export?from=${from}&to=${to}`,`kwms-carbon-baseline-${from}-to-${to}.csv`)} className="border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800">Download baseline (CSV)</button>:undefined}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}

    <div className="flex flex-wrap items-end gap-3 text-sm">
      <label className="font-medium text-slate-700">From<input type="month" value={from} max={to} onChange={e=>e.target.value&&setFrom(e.target.value)} className={`${field} w-44`}/></label>
      <label className="font-medium text-slate-700">To<input type="month" value={to} min={from} onChange={e=>e.target.value&&setTo(e.target.value)} className={`${field} w-44`}/></label>
      {overview?.refreshed&&<p className="pb-2.5 text-xs text-slate-500">Calculated {dateTime(overview.refreshed.refreshed_at)} with factors version {overview.refreshed.factor_version}
        {kcca&&<> · <button disabled={busy} onClick={()=>void recalculate()} className="min-h-0 px-0 py-0 text-xs text-[var(--color-action)] disabled:opacity-50">{busy?"Recalculating…":"Recalculate now"}</button></>}</p>}
    </div>

    {overview&&total&&<>
      <div className="grid grid-cols-2 rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white lg:grid-cols-4">
        <Tile label="Landfilled" value={`${t(landfilled)} t`} note={`${overview.certificates.issued} load certificates${overview.certificates.revoked?`, ${overview.certificates.revoked} revoked`:""}`}/>
        <Tile label="Diverted from landfill" value={`${t(diverted)} t`} note={`${pct(diverted,diverted+landfilled)} diversion rate · composting, recovery and recyclers`} border/>
        <Tile label="Composition measured" value={pct(Number(total.measured_t),weighed)} note={`of ${t(weighed)} t weighed; the rest uses KCCA's assumed mix`} border warn={weighed>0&&Number(total.measured_t)/weighed<0.5}/>
        <Tile label="Methane potential landfilled" value={`${t(total.landfilled_co2e_t)} tCO₂e`} note={`${t(total.avoided_co2e_t)} tCO₂e avoided by diversion`} border/>
      </div>

      <section className="grid gap-6 xl:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-semibold text-slate-950">By month</h2>
          {overview.months.length?<div className="table-wrap"><table className="w-full min-w-[560px] text-left">
            <thead><tr><th>Month</th><th className="text-right">Landfilled (t)</th><th className="text-right">Diverted (t)</th><th className="text-right">Diversion</th><th className="text-right">tCO₂e potential</th></tr></thead>
            <tbody>{overview.months.map(m=><tr key={m.month}><td className="table-primary">{monthLabel(m.month)}</td><td className="text-right tabular-nums">{t(m.landfilled_t)}</td>
              <td className="text-right tabular-nums">{t(m.diverted_t)}</td><td className="text-right tabular-nums">{pct(Number(m.diverted_t),Number(m.diverted_t)+Number(m.landfilled_t))}</td>
              <td className="text-right tabular-nums">{t(m.landfilled_co2e_t)}</td></tr>)}</tbody>
          </table></div>:<EmptyState title="Nothing weighed in these months" description="Weighed loads appear after the daily run."/>}
        </div>
        <div>
          <h2 className="mb-3 text-lg font-semibold text-slate-950">By waste stream</h2>
          {overview.streams.length?<div className="table-wrap"><table className="w-full min-w-[560px] text-left">
            <thead><tr><th>Stream</th><th className="text-right">Landfilled (t)</th><th className="text-right">Diverted (t)</th><th className="text-right">Share landfilled</th><th className="text-right">tCO₂e potential</th></tr></thead>
            <tbody>{overview.streams.map(s=><tr key={s.code}><td className="table-primary">{s.name}</td><td className="text-right tabular-nums">{t(s.landfilled_t)}</td>
              <td className="text-right tabular-nums">{t(s.diverted_t)}</td><td className="text-right tabular-nums">{pct(Number(s.landfilled_t),landfilled)}</td>
              <td className="text-right tabular-nums">{t(s.landfilled_co2e_t)}</td></tr>)}</tbody>
          </table></div>:<EmptyState title="No streams yet" description="Streams come from recorded compositions and KCCA's assumed mix."/>}
        </div>
      </section>

      {cityWide&&<section>
        <h2 className="mb-3 text-lg font-semibold text-slate-950">By operator</h2>
        {overview.operators.length?<div className="table-wrap"><table className="w-full min-w-[760px] text-left">
          <thead><tr><th>Operator</th><th className="text-right">Landfilled (t)</th><th className="text-right">Diverted (t)</th><th className="text-right">Diversion</th><th className="text-right">Composition measured</th><th className="text-right">tCO₂e potential</th></tr></thead>
          <tbody>{overview.operators.map(o=><tr key={o.id}><td><p className="table-primary">{o.name}</p><p className="table-secondary">{o.type==="recycling_company"?"Recycler (weighed purchases)":"Waste collector"}</p></td>
            <td className="text-right tabular-nums">{t(o.landfilled_t)}</td><td className="text-right tabular-nums">{t(o.diverted_t)}</td>
            <td className="text-right tabular-nums">{pct(Number(o.diverted_t),Number(o.diverted_t)+Number(o.landfilled_t))}</td>
            <td className="text-right tabular-nums">{o.type==="recycling_company"?"—":pct(Number(o.measured_t),Number(o.weighed_t))}</td>
            <td className="text-right tabular-nums">{t(o.landfilled_co2e_t)}</td></tr>)}</tbody>
        </table></div>:<EmptyState title="No operator data in these months" description="Operators appear once their loads are weighed."/>}
      </section>}
    </>}

    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-slate-950">Loads and certificates</h2>
          <p className="text-sm text-slate-600">{canCompose?"Record what each load contained: a visual estimate at the tipping face, or a sorted sample for a better figure.":"Each completed ticket has a load certificate that anyone can check with its code."}</p></div>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="font-medium text-slate-700">Month<input type="month" value={loadMonth} onChange={e=>e.target.value&&setLoadMonth(e.target.value)} className={`${field} w-44`}/></label>
          <label className="font-medium text-slate-700">Composition<select value={filter} onChange={e=>setFilter(e.target.value as typeof filter)} className={`${field} w-44`}>
            <option value="all">All loads</option><option value="missing">Not recorded</option><option value="recorded">Recorded</option></select></label>
        </div>
      </div>
      {loads===null?<p className="py-6 text-sm text-slate-500">Loading loads…</p>:loads.length?<div className="table-wrap"><table className="w-full min-w-[1080px] text-left">
        <thead><tr><th>Date / ticket</th>{cityWide&&<th>Operator</th>}<th>Facility</th><th className="text-right">Net</th><th>Composition</th><th>Certificate</th>{canCompose&&<th/>}</tr></thead>
        <tbody>{loads.map(l=><tr key={l.id} className={l.status==="voided"?"text-slate-400":""}>
          <td><p className="table-primary">{l.ticket_number}</p><p className="table-secondary">{new Date(`${l.operation_date}T00:00:00`).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})} · {l.registration}</p></td>
          {cityWide&&<td>{l.organization_name}</td>}
          <td><p>{l.facility_name}</p><p className="table-secondary">{KIND[l.facility_kind]??l.facility_kind}</p></td>
          <td className="text-right tabular-nums">{l.net_kg?`${Number(l.net_kg).toLocaleString("en-GB")} kg`:"—"}</td>
          <td className="max-w-72">{l.shares?<><p className="text-sm">{Object.entries(l.shares).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${streamName[k]??k} ${v}%`).join(" · ")}{Object.keys(l.shares).length>3?" · …":""}</p>
            <p className="table-secondary">{l.composition_method==="sample_sort"?`Sorted sample of ${t(l.sample_kg??0)} kg`:"Visual estimate"}</p></>
            :<span className={l.status==="voided"?"":"text-[var(--color-warning)]"}>{l.status==="voided"?"Ticket voided":"Not recorded"}</span>}</td>
          <td>{l.certificate_id?<><button onClick={()=>void file(`/api/waste/landfill/certificates/${l.certificate_id}/pdf`)} className="min-h-0 px-0 py-0 text-sm font-medium text-[var(--color-action)]">{l.certificate_number}</button>
            <p className="table-secondary">{l.revoked_at?<span className="text-[var(--color-danger)]">Revoked</span>:<a href={`/l/${l.verification_code}`} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">Check code {l.verification_code}</a>}</p></>:"—"}</td>
          {canCompose&&<td className="text-right">{l.status==="completed"&&<button onClick={()=>setComposing(l)} className="border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">{l.shares?"Change":"Record composition"}</button>}</td>}
        </tr>)}</tbody>
      </table></div>:<EmptyState title={filter==="missing"?"Every load this month has a composition":"No loads this month"} description="Loads appear when the weighbridge completes a ticket."/>}
    </section>

    {factors&&<section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-slate-950">Methane factors · version {factors.current.version}</h2>
          <p className="max-w-3xl text-sm text-slate-600">Methane per tonne = DOC × DOCf × MCF × F × 16/12 × (1 − OX) × methane GWP. Planning estimates, not verified reductions.</p></div>
        {kcca&&<button onClick={()=>setPublishing(true)} className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white">Publish new version</button>}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white p-4 text-sm">
          {[["DOCf, carbon that decomposes",factors.current.docf],["MCF, methane correction",factors.current.mcf],["F, methane share of gas",factors.current.methane_fraction],["OX, oxidised in cover",factors.current.oxidation],["GWP of methane",factors.current.gwp_ch4]].map(([label,value])=>
            <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="font-semibold tabular-nums text-slate-900">{Number(value)}</dd></div>)}
          <div className="col-span-2"><dt className="text-xs text-slate-500">Methodology</dt><dd className="text-slate-700">{factors.current.methodology}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-slate-500">Published</dt><dd className="text-slate-700">{dateTime(factors.current.published_at)}{factors.current.published_by_name?` by ${factors.current.published_by_name}`:""}{factors.current.change_summary?` — ${factors.current.change_summary}`:""}</dd></div>
        </dl>
        <div className="table-wrap"><table className="w-full min-w-[420px] text-left">
          <thead><tr><th>Stream</th><th className="text-right">DOC</th><th className="text-right">Assumed share</th></tr></thead>
          <tbody>{factors.streams.map(s=><tr key={s.code}><td>{s.name}</td><td className="text-right tabular-nums">{Number(s.doc)}</td><td className="text-right tabular-nums">{Number(s.default_share_pct)}%</td></tr>)}</tbody>
        </table></div>
      </div>
      {factors.versions.length>1&&<p className="mt-3 text-xs text-slate-500">Earlier versions: {factors.versions.slice(1).map(v=>`${v.version} (${dateTime(v.published_at)})`).join(", ")}. The whole baseline is recalculated with the current version.</p>}
    </section>}

    {factors&&<CompositionDialog load={composing} streams={factors.streams} onClose={()=>setComposing(null)} onDone={done}/>}
    {factors&&kcca&&<FactorsDialog open={publishing} factors={factors} onClose={()=>setPublishing(false)} onDone={done}/>}
  </div></AppShell>;
}

function Tile({label,value,note,border=false,warn=false}:{label:string;value:string;note:string;border?:boolean;warn?:boolean}){
  return <div className={`px-4 py-3 ${border?"border-l border-slate-200":""}`}><p className="text-xs font-medium text-slate-500">{label}</p>
    <p className={`mt-1 text-xl font-semibold tabular-nums ${warn?"text-[var(--color-warning)]":"text-slate-900"}`}>{value}</p><p className="text-xs text-slate-500">{note}</p></div>;
}

function CompositionDialog({load,streams,onClose,onDone}:{load:Load|null;streams:Stream[];onClose:()=>void;onDone:(m:string)=>Promise<void>}){
  const [shares,setShares]=useState<Record<string,string>>({}),[method,setMethod]=useState("visual_estimate"),[sampleKg,setSampleKg]=useState(""),[notes,setNotes]=useState("");
  const [error,setError]=useState(""),[saving,setSaving]=useState(false);
  useEffect(()=>{const timer=window.setTimeout(()=>{
    setShares(Object.fromEntries(Object.entries(load?.shares??{}).map(([k,v])=>[k,String(v)])));
    setMethod(load?.composition_method??"visual_estimate");setSampleKg(load?.sample_kg?String(Number(load.sample_kg)):"");setNotes(load?.composition_notes??"");setError("");
  },0);return()=>window.clearTimeout(timer)},[load]);
  const sum=Object.values(shares).reduce((n,v)=>n+(Number(v)||0),0),balanced=Math.abs(sum-100)<=0.05;
  async function save(){
    if(!load)return;setSaving(true);setError("");
    const body={method,shares:Object.fromEntries(Object.entries(shares).filter(([,v])=>Number(v)>0).map(([k,v])=>[k,Number(v)])),
      ...(method==="sample_sort"?{sampleKg:Number(sampleKg)}:{}),...(notes.trim()?{notes:notes.trim()}:{})};
    try{await onDone((await apiRequest<{message:string}>(`/api/waste/landfill/loads/${load.id}/composition`,{method:"PUT",body:JSON.stringify(body)})).message)}
    catch(e){setError(e instanceof Error?e.message:"Could not save the composition")}finally{setSaving(false)}
  }
  return <Modal open={Boolean(load)} title="Load composition" description={load?`${load.ticket_number} · ${load.organization_name} · ${Number(load.net_kg).toLocaleString("en-GB")} kg net`:""} onClose={()=>!saving&&onClose()}>
    <form onSubmit={e=>{e.preventDefault();void save()}} className="grid gap-4 text-sm">
      <div className="grid grid-cols-2 border border-slate-300">
        {[["visual_estimate","Visual estimate"],["sample_sort","Sorted sample"]].map(([value,label])=><label key={value} className={`p-3 ${method===value?"bg-[var(--color-action-soft)] font-semibold text-[var(--color-action)]":""}`}>
          <input type="radio" className="mr-2" checked={method===value} onChange={()=>setMethod(value)}/>{label}</label>)}
      </div>
      {method==="sample_sort"&&<label className="font-medium">Sample weight (kg)<input required type="number" min="0.1" step="0.1" value={sampleKg} onChange={e=>setSampleKg(e.target.value)} className={field}/></label>}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {streams.map(s=><label key={s.code} className="flex items-center justify-between gap-3 border-b border-slate-100 py-1">{s.name}
          <span className="flex items-center gap-1"><input type="number" min="0" max="100" step="0.5" value={shares[s.code]??""} onChange={e=>setShares({...shares,[s.code]:e.target.value})} className="w-20 border border-slate-300 px-2 py-1.5 text-right tabular-nums"/>%</span></label>)}
      </div>
      <p className={`font-semibold tabular-nums ${balanced?"text-slate-900":"text-[var(--color-warning)]"}`}>Total {Math.round(sum*100)/100}%{balanced?"":" — must be 100%"}</p>
      <label className="font-medium">Notes (optional)<textarea maxLength={500} value={notes} onChange={e=>setNotes(e.target.value)} className={`${field} min-h-16`}/></label>
      {error&&<p className="text-[var(--color-danger)]">{error}</p>}
      <button disabled={saving||!balanced} className="bg-[var(--color-action)] px-4 py-3 font-semibold text-white disabled:opacity-50">{saving?"Saving…":"Save composition"}</button>
    </form>
  </Modal>;
}

function FactorsDialog({open,factors,onClose,onDone}:{open:boolean;factors:Factors;onClose:()=>void;onDone:(m:string)=>Promise<void>}){
  const c=factors.current;
  const [error,setError]=useState(""),[saving,setSaving]=useState(false);
  async function submit(form:FormData){
    setSaving(true);setError("");
    const num=(k:string)=>Number(form.get(k));
    const streams=Object.fromEntries(factors.streams.map(s=>[s.code,{doc:num(`doc_${s.code}`),defaultSharePct:num(`share_${s.code}`)}]));
    const body={methodology:form.get("methodology"),docf:num("docf"),mcf:num("mcf"),methaneFraction:num("methaneFraction"),oxidation:num("oxidation"),gwpCh4:num("gwpCh4"),changeSummary:form.get("changeSummary"),streams};
    try{await onDone((await apiRequest<{message:string}>("/api/waste/landfill/factors",{method:"POST",body:JSON.stringify(body)})).message)}
    catch(e){setError(e instanceof Error?e.message:"Could not publish the factors")}finally{setSaving(false)}
  }
  return <Modal open={open} title={`Publish methane factors version ${c.version+1}`} description="Publishing recalculates the whole baseline." onClose={()=>!saving&&onClose()}>
    <form key={`${open}-${c.version}`} onSubmit={e=>{e.preventDefault();void submit(new FormData(e.currentTarget))}} className="grid gap-4 text-sm">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[["docf","DOCf",c.docf],["mcf","MCF",c.mcf],["methaneFraction","F",c.methane_fraction],["oxidation","OX",c.oxidation],["gwpCh4","GWP of methane",c.gwp_ch4]].map(([name,label,value])=>
          <label key={name} className="font-medium">{label}<input name={name} required type="number" step="0.001" min="0" defaultValue={Number(value)} className={field}/></label>)}
      </div>
      <div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Stream</th><th className="text-right">DOC</th><th className="text-right">Assumed share %</th></tr></thead>
        <tbody>{factors.streams.map(s=><tr key={s.code}><td>{s.name}</td>
          <td className="text-right"><input name={`doc_${s.code}`} required type="number" step="0.001" min="0" max="1" defaultValue={Number(s.doc)} className="w-24 border border-slate-300 px-2 py-1.5 text-right"/></td>
          <td className="text-right"><input name={`share_${s.code}`} required type="number" step="0.1" min="0" max="100" defaultValue={Number(s.default_share_pct)} className="w-24 border border-slate-300 px-2 py-1.5 text-right"/></td></tr>)}</tbody></table></div>
      <label className="font-medium">Methodology<textarea name="methodology" required minLength={5} maxLength={2000} defaultValue={c.methodology} className={`${field} min-h-20`}/></label>
      <label className="font-medium">What changed and why<input name="changeSummary" required minLength={5} maxLength={300} className={field} placeholder="For example: MCF 1.0 for Buyala, an engineered sanitary landfill"/></label>
      {error&&<p className="text-[var(--color-danger)]">{error}</p>}
      <button disabled={saving} className="bg-[var(--color-action)] px-4 py-3 font-semibold text-white disabled:opacity-50">{saving?"Publishing…":"Publish and recalculate"}</button>
    </form>
  </Modal>;
}
