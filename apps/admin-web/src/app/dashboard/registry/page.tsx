"use client";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {Pagination} from "@/components/ui/Pagination";
import {apiRequest} from "@/lib/api";
import {useHasRole} from "@/lib/session";
import {dateTime} from "@/lib/receipts";

type Status="all"|"unverified"|"verified"|"imprecise"|"tariff_mismatch"|"no_category"|"no_area"|"not_collected";
type Summary={points:number;verified:number;imprecise:number;tariff_mismatch:number;no_category:number;no_area:number;not_collected:number;estimated_kg_week:string;
  categories:{category:string;points:number;estimated_kg_week:string;verified:number}[];divisions:{division:string;points:number;verified:number;operators:number}[]};
type Point={id:string;point_number:string;point_category:string|null;estimated_kg_week:string|null;label:string|null;address:string;customer_name:string;customer_type:string;
  organization_name:string|null;division:string|null;area:string|null;constituency:string|null;tariff_band:string|null;plan_customer_type:string|null;expected_customer_type:string|null;
  tariff_mismatch:boolean;location_precise:boolean;verified_at:string|null;verified_by_name:string|null;last_collected_at:string|null;service_status:string};
type Detail={point:Point&{latitude:number|null;longitude:number|null;verification_accuracy_m:string|null;verification_moved_m:string|null;verification_note:string|null;customer_phone:string|null;plan_name:string|null;tariff_band_name:string|null};
  stops:{scheduled_date:string;status:string;completed_at:string|null;collected_weight_kg:string|null;exception_reason:string|null;organization:string}[];
  receipts:{serial_number:string;issued_at:string;collected_weight_kg:string|null;voided:boolean}[];
  billing:{bills:number;billed_ugx:string;open_ugx:string};service:{due:number;completed:number}};

const CATEGORY:Record<string,string>={household:"Household",shop:"Shop",market_stall:"Market stall",market:"Market",restaurant:"Restaurant",hotel:"Hotel",office:"Office",
  school:"School",health_facility:"Health facility",place_of_worship:"Place of worship",government:"Government",factory:"Factory",construction:"Construction",other:"Other",none:"Not set"};
const CUSTOMER_TYPE:Record<string,string>={residential:"residential",commercial:"commercial",office_business:"office and institution",industrial:"industrial"};
const STATUS:[Status,string][]=[["all","All points"],["unverified","Not verified"],["tariff_mismatch","Tariff does not fit"],["no_category","No category"],["no_area","No area"],["not_collected","Not collected in 30 days"],["verified","Verified"]];
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";
const n=(v:number|string)=>Number(v).toLocaleString("en-GB",{maximumFractionDigits:1});
const pct=(a:number,b:number)=>b?`${Math.round(a/b*100)}%`:"—";

export default function RegistryPage(){
  const kcca=useHasRole("kcca_admin"),systemAdmin=useHasRole("system_admin"),regulator=kcca||systemAdmin;
  const [summary,setSummary]=useState<Summary|null>(null),[list,setList]=useState<{rows:Point[];total:number}|null>(null);
  const [status,setStatus]=useState<Status>("all"),[category,setCategory]=useState(""),[search,setSearch]=useState(""),[query,setQuery]=useState("");
  const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(25),[open,setOpen]=useState<string|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const loadSummary=useCallback(async()=>{try{setSummary((await apiRequest<{data:Summary}>("/api/waste/registry/summary")).data)}catch(e){setError(e instanceof Error?e.message:"Could not load the registry")}},[]);
  const loadList=useCallback(async()=>{
    try{const q=new URLSearchParams({status,page:String(page),pageSize:String(pageSize),...(category?{category}:{}),...(query?{search:query}:{})});
      setList((await apiRequest<{data:{rows:Point[];total:number}}>(`/api/waste/registry/points?${q}`)).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load points")}
  },[status,category,query,page,pageSize]);
  useEffect(()=>{const timer=window.setTimeout(()=>void loadSummary(),0);return()=>window.clearTimeout(timer)},[loadSummary]);
  useEffect(()=>{const timer=window.setTimeout(()=>void loadList(),0);return()=>window.clearTimeout(timer)},[loadList]);
  useEffect(()=>{const timer=window.setTimeout(()=>{setQuery(search.trim());setPage(1)},350);return()=>window.clearTimeout(timer)},[search]);
  async function changed(message:string){setNotice(message);setError("");await Promise.all([loadSummary(),loadList()])}
  const s=summary,counts:Partial<Record<Status,number>>=s?{unverified:s.points-s.verified,tariff_mismatch:s.tariff_mismatch,no_category:s.no_category,no_area:s.no_area,not_collected:s.not_collected,verified:s.verified,all:s.points}:{};

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow={regulator?"City oversight":"Customers"} title="Waste point registry"
      description={regulator?"Every collection point in the city: households, businesses and institutions, with the operator serving each, where it is, what it is, and whether its position has been checked on site.":"Every collection point your company serves. Give each a category and an estimate of its waste, check its position on site with a phone, and fix tariffs that do not fit what the point is."}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}

    {s&&<>
      <div className="grid grid-cols-2 rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white lg:grid-cols-4">
        <Tile label="Points registered" value={n(s.points)} note={`${s.categories.filter(c=>c.category!=="none").length} kinds of point`}/>
        <Tile label="Verified on site" value={pct(s.verified,s.points)} note={`${n(s.verified)} of ${n(s.points)} · ${n(s.imprecise)} placed only roughly`} border warn={s.points>0&&s.verified/s.points<0.5}/>
        <Tile label="Estimated waste" value={`${n(Number(s.estimated_kg_week)/1000)} t a week`} note="from points with an estimate" border/>
        <Tile label="Need attention" value={n(s.tariff_mismatch+s.no_category+s.not_collected)} note={`${s.tariff_mismatch} tariff · ${s.no_category} no category · ${s.not_collected} not collected`} border warn={s.tariff_mismatch>0}/>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <section><h2 className="mb-2 text-lg font-semibold text-slate-950">By kind of point</h2>
          <ul className="grid gap-1.5 rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white p-4 text-sm">{s.categories.map(c=><li key={c.category}>
            <button onClick={()=>{setCategory(category===c.category?"":c.category);setPage(1)}} className="grid w-full grid-cols-[9rem_1fr_6rem] items-center gap-3 px-0 py-0.5 text-left">
              <span className={category===c.category?"font-semibold text-[var(--color-action)]":""}>{CATEGORY[c.category]??c.category}</span>
              <span className="h-2 bg-slate-100"><span className="block h-2 bg-slate-500" style={{width:pct(c.points,s.points)}}/></span>
              <span className="text-right tabular-nums text-slate-600">{n(c.points)}{Number(c.estimated_kg_week)?` · ${n(Number(c.estimated_kg_week)/1000)} t`:""}</span></button></li>)}</ul>
        </section>
        {regulator&&<section><h2 className="mb-2 text-lg font-semibold text-slate-950">By division</h2>
          <div className="table-wrap"><table className="w-full text-left text-sm"><thead><tr><th>Division</th><th className="text-right">Points</th><th className="text-right">Verified</th><th className="text-right">Operators</th></tr></thead>
            <tbody>{s.divisions.map(d=><tr key={d.division}><td>{d.division}</td><td className="text-right tabular-nums">{n(d.points)}</td><td className="text-right tabular-nums">{pct(d.verified,d.points)}</td><td className="text-right tabular-nums">{d.operators}</td></tr>)}</tbody></table></div>
        </section>}
      </div>
    </>}

    <section>
      <div className="mb-3 flex flex-wrap gap-2">{STATUS.map(([code,label])=><button key={code} onClick={()=>{setStatus(code);setPage(1)}}
        className={`border px-3 py-1.5 text-sm ${status===code?"border-[var(--color-action)] bg-[var(--color-action-soft)] font-semibold text-[var(--color-action)]":"border-slate-300 bg-white text-slate-700"}`}>
        {label}{counts[code]!==undefined&&<span className="ml-1.5 tabular-nums text-slate-500">{counts[code]}</span>}</button>)}</div>
      <div className="mb-3 flex flex-wrap items-end gap-3 text-sm">
        <label className="font-medium text-slate-700">Search<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Point number, name, address or area" className={`${field} w-72`}/></label>
        <label className="font-medium text-slate-700">Kind<select value={category} onChange={e=>{setCategory(e.target.value);setPage(1)}} className={`${field} w-48`}>
          <option value="">All kinds</option>{Object.entries(CATEGORY).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      </div>
      {list===null?<p className="py-6 text-sm text-slate-500">Loading…</p>:list.rows.length?<><div className="table-wrap"><table className="w-full min-w-[1100px] text-left">
        <thead><tr><th>Point</th><th>Kind</th>{regulator&&<th>Operator</th>}<th>Place</th><th>Tariff</th><th>Position</th><th>Last collected</th><th/></tr></thead>
        <tbody>{list.rows.map(p=><tr key={p.id}>
          <td><p className="table-primary font-mono text-[13px]">{p.point_number}</p><p className="table-secondary">{p.customer_name}{p.label?` · ${p.label}`:""}</p></td>
          <td>{p.point_category?CATEGORY[p.point_category]:<span className="text-[var(--color-warning)]">Not set</span>}{p.estimated_kg_week&&<p className="table-secondary">{n(p.estimated_kg_week)} kg a week</p>}</td>
          {regulator&&<td>{p.organization_name??"—"}</td>}
          <td><p>{p.area??<span className="text-slate-500">No area</span>}</p><p className="table-secondary">{p.constituency??p.division??""}</p></td>
          <td>{p.tariff_band??p.plan_customer_type??<span className="text-slate-500">No plan</span>}{p.tariff_mismatch&&<p className="text-xs font-semibold text-[var(--color-warning)]">Billed {CUSTOMER_TYPE[p.plan_customer_type??""]}, looks {CUSTOMER_TYPE[p.expected_customer_type??""]}</p>}</td>
          <td>{p.verified_at?<><p>Verified</p><p className="table-secondary">{dateTime(p.verified_at)}</p></>:<span className={p.location_precise?"text-slate-600":"text-[var(--color-warning)]"}>{p.location_precise?"Not verified":"Rough position"}</span>}</td>
          <td>{p.last_collected_at?dateTime(p.last_collected_at):<span className="text-slate-500">Never</span>}</td>
          <td className="text-right"><button onClick={()=>setOpen(p.id)} className="border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Open</button></td>
        </tr>)}</tbody></table></div>
        <Pagination page={page} pageSize={pageSize} total={list.total} totalPages={Math.max(1,Math.ceil(list.total/pageSize))} onPage={setPage} onPageSize={size=>{setPageSize(size);setPage(1)}}/></>
        :<EmptyState title="No points match" description="Try another filter or search."/>}
    </section>
    <PointDialog id={open} editable={!regulator} onClose={()=>setOpen(null)} onChanged={changed}/>
  </div></AppShell>;
}

function Tile({label,value,note,border=false,warn=false}:{label:string;value:string;note:string;border?:boolean;warn?:boolean}){
  return <div className={`px-4 py-3 ${border?"border-l border-slate-200":""}`}><p className="text-xs font-medium text-slate-500">{label}</p>
    <p className={`mt-1 text-xl font-semibold tabular-nums ${warn?"text-[var(--color-warning)]":"text-slate-900"}`}>{value}</p><p className="text-xs text-slate-500">{note}</p></div>;
}

type Fix={latitude:number;longitude:number;accuracy:number};
function PointDialog({id,editable,onClose,onChanged}:{id:string|null;editable:boolean;onClose:()=>void;onChanged:(m:string)=>Promise<void>}){
  const [d,setD]=useState<Detail|null>(null),[error,setError]=useState(""),[saving,setSaving]=useState(false);
  const [fix,setFix]=useState<Fix|null>(null),[locating,setLocating]=useState(false),[note,setNote]=useState("");
  const load=useCallback(async(pointId:string)=>{try{setD((await apiRequest<{data:Detail}>(`/api/waste/registry/points/${pointId}`)).data)}catch(e){setError(e instanceof Error?e.message:"Could not load the point")}},[]);
  useEffect(()=>{const timer=window.setTimeout(()=>{setD(null);setError("");setFix(null);setNote("");if(id)void load(id)},0);return()=>window.clearTimeout(timer)},[id,load]);
  async function save(body:object,path="",method="PATCH"){
    if(!id)return;setSaving(true);setError("");
    try{const r=await apiRequest<{message:string}>(`/api/waste/registry/points/${id}${path}`,{method,body:JSON.stringify(body)});setFix(null);setNote("");await load(id);await onChanged(r.message)}
    catch(e){setError(e instanceof Error?e.message:"Could not save")}finally{setSaving(false)}
  }
  function locate(){
    if(!navigator.geolocation){setError("This device cannot share its position");return}
    setLocating(true);setError("");
    navigator.geolocation.getCurrentPosition(p=>{setFix({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:Math.round(p.coords.accuracy*10)/10});setLocating(false)},
      e=>{setError(e.code===1?"Allow location for this site in the browser, then try again":"No position yet. Go outdoors and try again");setLocating(false)},{enableHighAccuracy:true,timeout:20000,maximumAge:0});
  }
  const p=d?.point;
  return <Modal open={Boolean(id)} title={p?p.point_number:"Collection point"} description={p?`${p.customer_name}${p.customer_phone?` · ${p.customer_phone}`:""} · ${p.address}`:""} onClose={()=>!saving&&onClose()}>
    {!d||!p?<p className="text-sm text-slate-500">{error||"Loading…"}</p>:<div className="grid gap-5 text-sm">
      {error&&<p className="text-[var(--color-danger)]">{error}</p>}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
        <div><dt className="text-xs text-slate-500">Operator</dt><dd>{p.organization_name??"—"}</dd></div>
        <div><dt className="text-xs text-slate-500">Place</dt><dd>{[p.area,p.constituency??p.division].filter(Boolean).join(", ")||"No area"}</dd></div>
        <div><dt className="text-xs text-slate-500">Plan and tariff</dt><dd>{p.plan_name??"No active plan"}{p.tariff_band_name?` · KCCA ${p.tariff_band_name}`:""}</dd>
          {p.tariff_mismatch&&<dd className="text-xs font-semibold text-[var(--color-warning)]">A {CATEGORY[p.point_category??""]?.toLowerCase()} is normally billed as {CUSTOMER_TYPE[p.expected_customer_type??""]}, not {CUSTOMER_TYPE[p.plan_customer_type??""]}.</dd>}</div>
        <div><dt className="text-xs text-slate-500">Collections due, last 30 shown</dt><dd>{d.service.completed} of {d.service.due} done</dd></div>
        <div><dt className="text-xs text-slate-500">Bills</dt><dd>{d.billing.bills} · UGX {n(d.billing.open_ugx)} open</dd></div>
        <div><dt className="text-xs text-slate-500">Position</dt><dd>{p.latitude!==null?`${Number(p.latitude).toFixed(5)}, ${Number(p.longitude).toFixed(5)}`:"Not placed"}</dd>
          <dd className="text-xs text-slate-500">{p.verified_at?`Verified ${dateTime(p.verified_at)} by ${p.verified_by_name}, ±${n(p.verification_accuracy_m??0)} m${p.verification_moved_m&&Number(p.verification_moved_m)>20?`, moved ${n(p.verification_moved_m)} m`:""}${p.verification_note?` · ${p.verification_note}`:""}`:p.location_precise?"Not verified on site":"Rough position, set from an address or area"}</dd></div>
      </dl>

      {editable&&<form key={`${p.id}-${p.point_category}-${p.estimated_kg_week}`} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const kg=String(f.get("kg")??"");
        void save({pointCategory:f.get("category"),estimatedKgWeek:kg===""?null:Number(kg)})}} className="grid gap-3 border border-slate-200 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="font-medium">Kind of point<select name="category" required defaultValue={p.point_category??""} className={field}><option value="" disabled>Choose</option>
          {Object.entries(CATEGORY).filter(([v])=>v!=="none").map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        <label className="font-medium">Waste a week (kg)<input name="kg" type="number" min={0} step="0.5" defaultValue={p.estimated_kg_week??""} className={field}/></label>
        <button disabled={saving} className="bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">Save</button>
      </form>}

      {editable&&<div className="grid gap-3 border border-slate-200 p-4">
        <div><p className="font-semibold text-slate-900">Verify on site</p><p className="text-slate-600">At the point&apos;s gate or bin, take a GPS fix with this phone. It must be accurate to 50 m; the fix becomes the point&apos;s position.</p></div>
        {!fix?<button type="button" disabled={locating} onClick={locate} className="w-fit border border-slate-300 px-4 py-2.5 font-semibold text-slate-800 disabled:opacity-50">{locating?"Finding position…":"Take GPS fix here"}</button>
          :<div className="grid gap-3">
            <p className={fix.accuracy>50?"font-semibold text-[var(--color-warning)]":"text-slate-800"}>{fix.latitude.toFixed(6)}, {fix.longitude.toFixed(6)} · accurate to {n(fix.accuracy)} m{fix.accuracy>50?" — too rough; move outdoors and take another":""}</p>
            <input value={note} onChange={e=>setNote(e.target.value)} maxLength={500} placeholder="Note (optional), e.g. blue gate opposite the church" className="border border-slate-300 px-3 py-2"/>
            <div className="flex gap-2">
              <button type="button" disabled={saving||fix.accuracy>50} onClick={()=>void save({latitude:fix.latitude,longitude:fix.longitude,accuracyM:fix.accuracy,...(note.trim()?{note:note.trim()}:{})},"/verify","POST")} className="bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">Use this position</button>
              <button type="button" onClick={locate} className="border border-slate-300 px-4 py-2.5 text-slate-700">Take again</button>
            </div></div>}
      </div>}

      <div><h3 className="mb-2 font-semibold text-slate-900">Service history</h3>
        {d.stops.length?<div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Day</th><th>Result</th><th className="text-right">Weight</th><th>Operator</th></tr></thead>
          <tbody>{d.stops.map((s,i)=><tr key={i}><td>{new Date(`${s.scheduled_date}T00:00:00`).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}</td>
            <td className={s.status==="skipped"?"text-[var(--color-danger)]":""}>{s.status==="completed"?"Collected":s.status==="skipped"?`Missed${s.exception_reason?`: ${s.exception_reason.replace(/_/g," ")}`:""}`:s.status}</td>
            <td className="text-right tabular-nums">{s.collected_weight_kg?`${n(s.collected_weight_kg)} kg`:"—"}</td><td>{s.organization}</td></tr>)}</tbody></table></div>
          :<p className="text-slate-600">No collections scheduled yet.</p>}
        {d.receipts.length>0&&<p className="mt-2 text-xs text-slate-500">Latest receipts: {d.receipts.map(r=>`${r.serial_number}${r.voided?" (voided)":""}`).join(", ")}</p>}
      </div>
    </div>}
  </Modal>;
}
