"use client";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {apiRequest} from "@/lib/api";
import {day,todayIso} from "@/lib/factory";
import {useHasRole} from "@/lib/session";

type Band={id:string;code:string;name:string;customer_type:string;description:string|null;is_active:boolean;sort_order:number;current_fee_ugx:string|null;current_from:string|null;next_fee_ugx:string|null;next_from:string|null;active_plans:number;operators:number};
type Rate={id:string;monthly_fee_ugx:string;effective_from:string;notice_reference:string|null;created_by_name:string|null;created_at:string;scheduled:boolean;invoices:number};

const TYPES:Array<[string,string]>=[["residential","Residential"],["commercial","Commercial"],["office_business","Office / business"],["industrial","Industrial"]];
const typeLabel=(v:string)=>TYPES.find(([k])=>k===v)?.[1]||v;
const ugx=(v:string|number|null)=>v===null?"—":`UGX ${Number(v).toLocaleString("en-GB")}`;
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";

export default function TariffsPage(){
  const canEdit=useHasRole("kcca_admin");
  const [bands,setBands]=useState<Band[]|null>(null),[open,setOpen]=useState<Band|null>(null),[rates,setRates]=useState<Rate[]>([]);
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[creating,setCreating]=useState(false),[editing,setEditing]=useState<Band|null>(null),[publishing,setPublishing]=useState(false);

  const load=useCallback(async()=>{
    try{setBands((await apiRequest<{data:Band[]}>("/api/waste/tariffs")).data)}catch(e){setError(e instanceof Error?e.message:"Could not load tariffs")}
  },[]);
  const loadRates=useCallback(async(band:Band)=>{
    try{setRates((await apiRequest<{data:Rate[]}>(`/api/waste/tariffs/${band.id}/rates`)).data)}catch(e){setError(e instanceof Error?e.message:"Could not load rates")}
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  useEffect(()=>{if(!open)return;const timer=window.setTimeout(()=>void loadRates(open),0);return()=>window.clearTimeout(timer)},[open,loadRates]);

  async function done(message:string){setCreating(false);setEditing(null);setPublishing(false);setNotice(message);setError("");await load();if(open)await loadRates(open);}
  async function withdraw(rate:Rate){
    if(!open||!window.confirm(`Withdraw the ${ugx(rate.monthly_fee_ugx)} rate due to start ${day(rate.effective_from)}?`))return;
    try{await apiRequest(`/api/waste/tariffs/${open.id}/rates/${rate.id}`,{method:"DELETE"});await done("Scheduled rate withdrawn.")}
    catch(e){setError(e instanceof Error?e.message:"Could not withdraw the rate")}
  }

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow="Regulation" title="Waste collection tariffs" description="KCCA's monthly collection fees by band. Collection companies link their packages to a band; their bills then follow the rate in force for each billing period. A rate in force can never be changed: publish a new rate with a later start date."
      action={canEdit&&<button onClick={()=>setCreating(true)} className="bg-[var(--color-action)] px-4 py-2 text-sm font-semibold text-white">New band</button>}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}

    {bands?.length?<div className="table-wrap"><table className="w-full min-w-[720px] text-left">
      <thead><tr><th>Band</th><th>Customers</th><th className="text-right">Monthly fee now</th><th>Next change</th><th className="text-right">Packages using it</th><th/></tr></thead>
      <tbody>{bands.map(b=><tr key={b.id} className={open?.id===b.id?"bg-slate-50":""}>
        <td><p className="table-primary">{b.name}{!b.is_active&&<span className="status ml-2 normal-case">Retired</span>}</p><p className="table-secondary font-mono">{b.code}</p></td>
        <td>{typeLabel(b.customer_type)}</td>
        <td className="text-right tabular-nums">{b.current_fee_ugx===null?<span className="text-[var(--color-danger)]">No rate yet</span>:ugx(b.current_fee_ugx)}{b.current_from&&<p className="table-secondary">since {day(b.current_from)}</p>}</td>
        <td>{b.next_from?<>{ugx(b.next_fee_ugx)}<p className="table-secondary">from {day(b.next_from)}</p></>:"—"}</td>
        <td className="text-right tabular-nums">{b.active_plans}<p className="table-secondary">{b.operators} operator{b.operators===1?"":"s"}</p></td>
        <td className="whitespace-nowrap text-right"><button onClick={()=>setOpen(open?.id===b.id?null:b)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">{open?.id===b.id?"Close":"Rates"}</button>{canEdit&&<> <button onClick={()=>setEditing(b)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Edit</button></>}</td>
      </tr>)}</tbody>
    </table></div>:bands&&<EmptyState title="No tariff bands yet" description={canEdit?"Create a band for each KCCA tariff category, then publish its monthly fee.":"KCCA has not published tariff bands yet."}/>}

    {open&&<section className="rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div><h2 className="font-semibold text-slate-900">{open.name} rates</h2><p className="text-sm text-slate-500">{open.description||`${typeLabel(open.customer_type)} customers`}</p></div>
        {canEdit&&open.is_active&&<button onClick={()=>setPublishing(true)} className="bg-slate-900 px-4 py-2 text-sm text-white">Publish a rate</button>}
      </div>
      {rates.length?<table className="w-full text-left text-sm">
        <thead><tr><th className="px-5 py-2">From</th><th className="text-right">Monthly fee</th><th>KCCA notice</th><th>Published</th><th className="text-right">Bills issued</th><th/></tr></thead>
        <tbody>{rates.map(r=><tr key={r.id} className="border-t border-slate-100">
          <td className="px-5 py-2">{day(r.effective_from)}{r.scheduled&&<span className="status status-pending ml-2 normal-case">Scheduled</span>}</td>
          <td className="text-right tabular-nums">{ugx(r.monthly_fee_ugx)}</td>
          <td>{r.notice_reference||"—"}</td>
          <td>{r.created_by_name||"—"}<p className="table-secondary">{day(r.created_at)}</p></td>
          <td className="text-right tabular-nums">{r.invoices}</td>
          <td className="px-5 text-right">{canEdit&&r.scheduled&&r.invoices===0&&<button onClick={()=>void withdraw(r)} className="border border-slate-300 px-3 py-1.5 text-xs text-slate-700">Withdraw</button>}</td>
        </tr>)}</tbody>
      </table>:<p className="px-5 py-6 text-sm text-slate-500">No rates published for this band yet.</p>}
    </section>}

    <BandDialog open={creating||Boolean(editing)} band={editing} onClose={()=>{setCreating(false);setEditing(null)}} onDone={done}/>
    {open&&<RateDialog open={publishing} band={open} onClose={()=>setPublishing(false)} onDone={done}/>}
  </div></AppShell>;
}

function BandDialog({open,band,onClose,onDone}:{open:boolean;band:Band|null;onClose:()=>void;onDone:(message:string)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError("");
    const common={name:f.get("name"),description:String(f.get("description")||"")||undefined,sortOrder:Number(f.get("sortOrder")||0)};
    try{
      if(band)await apiRequest(`/api/waste/tariffs/${band.id}`,{method:"PUT",body:JSON.stringify({...common,isActive:f.get("isActive")==="on"})});
      else await apiRequest("/api/waste/tariffs",{method:"POST",body:JSON.stringify({...common,code:f.get("code"),customerType:f.get("customerType")})});
      onDone(band?"Band saved.":"Band created. Publish its monthly fee next.");
    }catch(err){setError(err instanceof Error?err.message:"Could not save the band")}finally{setBusy(false)}
  }
  return <Modal open={open} title={band?`Edit ${band.name}`:"New tariff band"} description={band?"The code and customer type stay as they are, because packages and bills already refer to them.":"A KCCA tariff category, such as standard residential collection."} onClose={onClose}>
    <form key={band?.id||"new"} onSubmit={submit} className="grid gap-4 text-sm sm:grid-cols-2">
      {error&&<div className="sm:col-span-2"><Feedback tone="error">{error}</Feedback></div>}
      <label className="font-medium text-slate-700 sm:col-span-2">Name<input name="name" required minLength={2} maxLength={120} defaultValue={band?.name} className={field}/></label>
      {!band&&<label className="font-medium text-slate-700">Code<input name="code" required pattern="[A-Za-z0-9_]{2,30}" placeholder="RES_STANDARD" className={`${field} font-mono uppercase`}/></label>}
      {!band&&<label className="font-medium text-slate-700">Customers<select name="customerType" className={field}>{TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>}
      <label className="font-medium text-slate-700 sm:col-span-2">Description<textarea name="description" rows={2} maxLength={1000} defaultValue={band?.description||""} className={field}/></label>
      <label className="font-medium text-slate-700">Display order<input name="sortOrder" type="number" min={0} max={1000} defaultValue={band?.sort_order??0} className={field}/></label>
      {band&&<label className="flex items-center gap-2 self-end pb-3 font-medium text-slate-700"><input name="isActive" type="checkbox" defaultChecked={band.is_active}/>Offered to companies</label>}
      <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={onClose} className="border border-slate-300 px-4 py-2 text-slate-700">Cancel</button><button disabled={busy} className="bg-[var(--color-action)] px-4 py-2 font-semibold text-white disabled:opacity-60">{busy?"Saving…":"Save band"}</button></div>
    </form>
  </Modal>;
}

function RateDialog({open,band,onClose,onDone}:{open:boolean;band:Band;onClose:()=>void;onDone:(message:string)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError("");
    try{await apiRequest(`/api/waste/tariffs/${band.id}/rates`,{method:"POST",body:JSON.stringify({monthlyFeeUgx:Number(f.get("fee")),effectiveFrom:f.get("from"),noticeReference:String(f.get("notice")||"")||undefined})});onDone(`New ${band.name} rate published.`)}
    catch(err){setError(err instanceof Error?err.message:"Could not publish the rate")}finally{setBusy(false)}
  }
  return <Modal open={open} title={`Publish a ${band.name} rate`} description={`Bills for periods starting on or after this date use the new fee. ${band.active_plans} package${band.active_plans===1?"":"s"} from ${band.operators} operator${band.operators===1?"":"s"} follow this band. A rate cannot be changed once it is in force.`} onClose={onClose}>
    <form onSubmit={submit} className="grid gap-4 text-sm sm:grid-cols-2">
      {error&&<div className="sm:col-span-2"><Feedback tone="error">{error}</Feedback></div>}
      <label className="font-medium text-slate-700">Monthly fee (UGX)<input name="fee" type="number" required min={0} step={500} defaultValue={band.current_fee_ugx||""} className={field}/></label>
      <label className="font-medium text-slate-700">In force from<input name="from" type="date" required min={todayIso()} defaultValue={todayIso()} className={field}/></label>
      <label className="font-medium text-slate-700 sm:col-span-2">KCCA notice or circular (optional)<input name="notice" maxLength={120} placeholder="e.g. KCCA/DPHE/2026/014" className={field}/></label>
      <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={onClose} className="border border-slate-300 px-4 py-2 text-slate-700">Cancel</button><button disabled={busy} className="bg-[var(--color-action)] px-4 py-2 font-semibold text-white disabled:opacity-60">{busy?"Publishing…":"Publish rate"}</button></div>
    </form>
  </Modal>;
}
