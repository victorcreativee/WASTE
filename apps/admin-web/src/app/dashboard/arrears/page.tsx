"use client";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {Pagination} from "@/components/ui/Pagination";
import {apiRequest,openAuthenticatedFile} from "@/lib/api";
import {dateTime} from "@/lib/receipts";

type Bucket="all"|"1_30"|"31_60"|"61_90"|"over_90";
type Summary={households:number;overdue_ugx:string;days_1_30_ugx:string;days_31_60_ugx:string;days_61_90_ugx:string;days_over_90_ugx:string;not_yet_due_ugx:string;
  billed_ugx:string;collected_ugx:string;promises:{open:number;due_this_week:number;kept:number;broken:number};plans:{on_track:number;behind:number;completed:number}};
type Row={customer_id:string;full_name:string;phone:string|null;location:string|null;overdue_ugx:string;open_ugx:string;days_late:number;oldest_due_on:string;overdue_bills:number;
  last_paid_at:string|null;last_outcome:string|null;last_follow_up_at:string|null;promised_on:string|null;promise_state:string|null;plan_progress:string|null};
type Plan={id:string;total_ugx:string;instalments:number;frequency:string;first_due_on:string;last_due_on:string;note:string|null;status:string;created_by_name:string|null;created_at:string;
  cancelled_by_name:string|null;cancelled_at:string|null;cancel_reason:string|null;paid_ugx:string;due_ugx:string;progress:"on_track"|"behind"|"completed"|"cancelled"};
type Detail={customer:{id:string;full_name:string;phone:string|null;customer_type:string;service_status:string;location:string|null;overdue_ugx:string|null;open_ugx:string|null;days_late:number|null};
  bills:{id:string;invoice_number:string;amount_ugx:string;balance_ugx:string;issued_on:string;due_on:string;days_late:number}[];
  payments:{amount_ugx:string;provider:string;paid_at:string}[];
  followUps:{id:string;channel:string;outcome:string;note:string|null;promised_amount_ugx:string|null;promised_on:string|null;balance_at_follow_up_ugx:string;created_by_name:string|null;created_at:string;promise_state:string|null}[];
  plans:Plan[]};

const ugx=(v:string|number|null|undefined)=>`UGX ${Number(v??0).toLocaleString("en-GB")}`;
const day=(v:string|null)=>v?new Date(`${v.slice(0,10)}T00:00:00`).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"—";
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";
const OUTCOME:Record<string,string>={promise_to_pay:"Promised to pay",paid_elsewhere:"Says already paid",disputed:"Disputes the bill",no_answer:"No answer",refused:"Refused to pay",moved_away:"Moved away",other:"Other"};
const CHANNEL:Record<string,string>={call:"Call",visit:"Visit",sms:"SMS",letter:"Letter",other:"Other"};
const PROMISE:Record<string,[string,string]>={open:["open","text-slate-600"],kept:["kept","text-emerald-700"],broken:["broken","text-[var(--color-danger)]"]};
const PROGRESS:Record<string,[string,string]>={on_track:["On track","text-emerald-700"],behind:["Behind","text-[var(--color-danger)]"],completed:["Completed","text-slate-600"],cancelled:["Cancelled","text-slate-500"]};
const BUCKETS:[Bucket,string,keyof Summary][]=[["1_30","1–30 days","days_1_30_ugx"],["31_60","31–60 days","days_31_60_ugx"],["61_90","61–90 days","days_61_90_ugx"],["over_90","Over 90 days","days_over_90_ugx"]];
const kampalaDay=(offset=0)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Kampala"}).format(new Date(Date.now()+offset*86400000));

export default function ArrearsPage(){
  const [summary,setSummary]=useState<Summary|null>(null),[list,setList]=useState<{rows:Row[];total:number}|null>(null);
  const [bucket,setBucket]=useState<Bucket>("all"),[search,setSearch]=useState(""),[query,setQuery]=useState(""),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(25);
  const [open,setOpen]=useState<string|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const loadSummary=useCallback(async()=>{
    try{setSummary((await apiRequest<{data:Summary}>("/api/waste/billing/arrears/summary")).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load arrears")}
  },[]);
  const loadList=useCallback(async()=>{
    try{const q=new URLSearchParams({bucket,page:String(page),pageSize:String(pageSize),...(query?{search:query}:{})});
      setList((await apiRequest<{data:{rows:Row[];total:number}}>(`/api/waste/billing/arrears?${q}`)).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load households in arrears")}
  },[bucket,page,pageSize,query]);
  useEffect(()=>{const timer=window.setTimeout(()=>void loadSummary(),0);return()=>window.clearTimeout(timer)},[loadSummary]);
  useEffect(()=>{const timer=window.setTimeout(()=>void loadList(),0);return()=>window.clearTimeout(timer)},[loadList]);
  useEffect(()=>{const timer=window.setTimeout(()=>{setQuery(search.trim());setPage(1)},350);return()=>window.clearTimeout(timer)},[search]);
  async function changed(message:string){setNotice(message);setError("");await Promise.all([loadSummary(),loadList()])}

  const s=summary,overdue=Number(s?.overdue_ugx??0),billed=Number(s?.billed_ugx??0);
  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow="Income & billing" title="Arrears"
      description="Overdue households, follow-ups and payment plans."
      action={<button onClick={()=>void openAuthenticatedFile("/api/waste/billing/arrears/export",{download:"arrears.csv"}).catch(e=>setError(e instanceof Error?e.message:"Could not download"))} className="border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800">Download (CSV)</button>}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}

    {s&&<>
      <div className="grid grid-cols-2 rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white lg:grid-cols-4">
        <Tile label="Overdue" value={ugx(overdue)} note={`${s.households} household${s.households===1?"":"s"} · ${ugx(s.not_yet_due_ugx)} not yet due`}/>
        <Tile label="Collected, last 90 days" value={billed?`${Math.round(Number(s.collected_ugx)/billed*100)}%`:"—"} note={`${ugx(s.collected_ugx)} of ${ugx(billed)} that fell due`} border/>
        <Tile label="Promises to pay" value={String(s.promises.open)} note={`${s.promises.due_this_week} due this week · ${s.promises.kept} kept, ${s.promises.broken} broken (90 days)`} border warn={s.promises.broken>s.promises.kept}/>
        <Tile label="Payment plans" value={String(s.plans.on_track+s.plans.behind)} note={`${s.plans.on_track} on track · ${s.plans.behind} behind`} border warn={s.plans.behind>0}/>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {BUCKETS.map(([code,label,key])=>{const amount=Number(s[key]);return <button key={code} onClick={()=>{setBucket(bucket===code?"all":code);setPage(1)}}
          className={`border px-3 py-2.5 text-left ${bucket===code?"border-[var(--color-action)] bg-[var(--color-action-soft)]":"border-slate-200 bg-white"}`}>
          <span className="block text-xs text-slate-500">{label} late</span>
          <span className={`block font-semibold tabular-nums ${code==="over_90"&&amount?"text-[var(--color-danger)]":"text-slate-900"}`}>{ugx(amount)}</span>
          <span className="mt-1 block h-1 bg-slate-100"><span className="block h-1 bg-slate-500" style={{width:`${overdue?Math.round(amount/overdue*100):0}%`}}/></span>
        </button>})}
      </div>
    </>}

    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-950">Households{bucket!=="all"&&<span className="text-sm font-normal text-slate-500"> · {BUCKETS.find(b=>b[0]===bucket)?.[1]} late <button onClick={()=>setBucket("all")} className="min-h-0 px-1 py-0 text-sm text-[var(--color-action)]">show all</button></span>}</h2>
        <label className="text-sm font-medium text-slate-700">Search<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name, phone or place" className={`${field} w-64`}/></label>
      </div>
      {list===null?<p className="py-6 text-sm text-slate-500">Loading…</p>:list.rows.length?<><div className="table-wrap"><table className="w-full min-w-[1000px] text-left">
        <thead><tr><th>Household</th><th className="text-right">Overdue</th><th className="text-right">Days late</th><th>Last paid</th><th>Last follow-up</th><th>Plan</th><th/></tr></thead>
        <tbody>{list.rows.map(r=><tr key={r.customer_id}>
          <td><p className="table-primary">{r.full_name}</p><p className="table-secondary">{[r.phone,r.location].filter(Boolean).join(" · ")||"No contact"}</p></td>
          <td className="text-right"><p className="font-semibold tabular-nums">{ugx(r.overdue_ugx)}</p><p className="table-secondary">{r.overdue_bills} bill{r.overdue_bills===1?"":"s"}</p></td>
          <td className={`text-right tabular-nums ${r.days_late>90?"text-[var(--color-danger)]":""}`}>{r.days_late}<p className="table-secondary">since {day(r.oldest_due_on)}</p></td>
          <td>{r.last_paid_at?dateTime(r.last_paid_at):<span className="text-slate-500">Never</span>}</td>
          <td>{r.last_outcome?<><p>{OUTCOME[r.last_outcome]}{r.promise_state&&<span className={PROMISE[r.promise_state][1]}> · {PROMISE[r.promise_state][0]}</span>}</p>
            <p className="table-secondary">{r.promised_on?`by ${day(r.promised_on)}`:dateTime(r.last_follow_up_at)}</p></>:<span className="text-slate-500">None yet</span>}</td>
          <td>{r.plan_progress?<span className={PROGRESS[r.plan_progress][1]}>{PROGRESS[r.plan_progress][0]}</span>:<span className="text-slate-500">—</span>}</td>
          <td className="text-right"><button onClick={()=>setOpen(r.customer_id)} className="border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Open</button></td>
        </tr>)}</tbody>
      </table></div>
      <Pagination page={page} pageSize={pageSize} total={list.total} totalPages={Math.max(1,Math.ceil(list.total/pageSize))} onPage={setPage} onPageSize={size=>{setPageSize(size);setPage(1)}}/></>
      :<EmptyState title={query||bucket!=="all"?"No household matches":"No household is behind"} description={query||bucket!=="all"?"Try another search or age.":"Every bill past its due date has been paid."}/>}
    </section>

    <HouseholdDialog customerId={open} onClose={()=>setOpen(null)} onChanged={changed}/>
  </div></AppShell>;
}

function Tile({label,value,note,border=false,warn=false}:{label:string;value:string;note:string;border?:boolean;warn?:boolean}){
  return <div className={`px-4 py-3 ${border?"border-l border-slate-200":""}`}><p className="text-xs font-medium text-slate-500">{label}</p>
    <p className={`mt-1 text-xl font-semibold tabular-nums ${warn?"text-[var(--color-warning)]":"text-slate-900"}`}>{value}</p><p className="text-xs text-slate-500">{note}</p></div>;
}

function HouseholdDialog({customerId,onClose,onChanged}:{customerId:string|null;onClose:()=>void;onChanged:(m:string)=>Promise<void>}){
  const [d,setD]=useState<Detail|null>(null),[mode,setMode]=useState<"view"|"follow"|"plan">("view"),[cancelling,setCancelling]=useState<Plan|null>(null);
  const [outcome,setOutcome]=useState("promise_to_pay"),[error,setError]=useState(""),[saving,setSaving]=useState(false);
  const load=useCallback(async(id:string)=>{
    try{setD((await apiRequest<{data:Detail}>(`/api/waste/billing/arrears/customers/${id}`)).data)}catch(e){setError(e instanceof Error?e.message:"Could not load the household")}
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>{setD(null);setMode("view");setError("");setCancelling(null);if(customerId)void load(customerId)},0);return()=>window.clearTimeout(timer)},[customerId,load]);
  async function send(path:string,body:object,message?:string){
    if(!customerId)return;setSaving(true);setError("");
    try{const r=await apiRequest<{message:string}>(path,{method:"POST",body:JSON.stringify(body)});setMode("view");setCancelling(null);await load(customerId);await onChanged(message??r.message)}
    catch(e){setError(e instanceof Error?e.message:"Could not save")}finally{setSaving(false)}
  }
  const c=d?.customer,active=d?.plans.find(p=>p.status==="active");
  return <Modal open={Boolean(customerId)} title={c?.full_name??"Household"} description={c?`${[c.phone,c.location].filter(Boolean).join(" · ")} · owes ${ugx(c.open_ugx)}, of which ${ugx(c.overdue_ugx)} overdue`:""} onClose={()=>!saving&&onClose()}>
    {!d?<p className="text-sm text-slate-500">{error||"Loading…"}</p>:<div className="grid gap-5 text-sm">
      {error&&<p className="text-[var(--color-danger)]">{error}</p>}
      {mode==="view"&&<div className="flex flex-wrap gap-2">
        <button onClick={()=>setMode("follow")} className="bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white">Record follow-up</button>
        {!active&&<button onClick={()=>setMode("plan")} className="border border-slate-300 px-4 py-2.5 text-slate-700">Agree payment plan</button>}
      </div>}

      {mode==="follow"&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const promise=outcome==="promise_to_pay";
        void send(`/api/waste/billing/arrears/customers/${customerId}/follow-ups`,{channel:f.get("channel"),outcome,...(f.get("note")?{note:f.get("note")}:{}),
          ...(promise?{promisedAmountUgx:Number(f.get("amount")),promisedOn:f.get("promisedOn")}:{})})}} className="grid gap-3 border border-slate-200 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="font-medium">How<select name="channel" className={field}>{Object.entries(CHANNEL).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
          <label className="font-medium">Outcome<select value={outcome} onChange={e=>setOutcome(e.target.value)} className={field}>{Object.entries(OUTCOME).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        </div>
        {outcome==="promise_to_pay"&&<div className="grid gap-3 sm:grid-cols-2">
          <label className="font-medium">Amount promised (UGX)<input name="amount" type="number" required min={1} max={Number(c?.open_ugx??0)} defaultValue={Number(c?.overdue_ugx??0)||undefined} className={field}/></label>
          <label className="font-medium">By<input name="promisedOn" type="date" required min={kampalaDay()} defaultValue={kampalaDay(7)} className={field}/></label>
        </div>}
        <label className="font-medium">Note{["disputed","other"].includes(outcome)?"":" (optional)"}<textarea name="note" required={["disputed","other"].includes(outcome)} maxLength={1000} className={`${field} min-h-16`}/></label>
        <div className="flex gap-2"><button disabled={saving} className="bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">{saving?"Saving…":"Save follow-up"}</button>
          <button type="button" onClick={()=>setMode("view")} className="px-3 text-slate-600">Cancel</button></div>
      </form>}

      {mode==="plan"&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);
        void send(`/api/waste/billing/arrears/customers/${customerId}/plans`,{totalUgx:Number(f.get("total")),instalments:Number(f.get("instalments")),frequency:f.get("frequency"),firstDueOn:f.get("firstDueOn"),...(f.get("note")?{note:f.get("note")}:{})})}} className="grid gap-3 border border-slate-200 p-4">
        <p className="text-slate-600">To change a plan, cancel it and agree a new one.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="font-medium">Amount to clear (UGX)<input name="total" type="number" required min={2000} max={Number(c?.open_ugx??0)} defaultValue={Number(c?.overdue_ugx??0)||undefined} className={field}/></label>
          <label className="font-medium">Instalments<input name="instalments" type="number" required min={2} max={24} defaultValue={3} className={field}/></label>
          <label className="font-medium">Every<select name="frequency" defaultValue="monthly" className={field}><option value="monthly">Month</option><option value="weekly">Week</option></select></label>
          <label className="font-medium">First instalment<input name="firstDueOn" type="date" required min={kampalaDay()} defaultValue={kampalaDay(7)} className={field}/></label>
        </div>
        <label className="font-medium">Note (optional)<textarea name="note" maxLength={1000} className={`${field} min-h-16`}/></label>
        <div className="flex gap-2"><button disabled={saving} className="bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">{saving?"Saving…":"Agree plan"}</button>
          <button type="button" onClick={()=>setMode("view")} className="px-3 text-slate-600">Cancel</button></div>
      </form>}

      {d.plans.length>0&&<div><h3 className="mb-2 font-semibold text-slate-900">Payment plans</h3>
        <ul className="grid gap-2">{d.plans.map(p=><li key={p.id} className="border border-slate-200 px-3 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">{ugx(p.total_ugx)} in {p.instalments} {p.frequency==="weekly"?"weekly":"monthly"} instalments, {day(p.first_due_on)} to {day(p.last_due_on)}</p>
            <span className={`font-semibold ${PROGRESS[p.progress][1]}`}>{PROGRESS[p.progress][0]}</span></div>
          {p.status==="active"&&<div className="mt-1.5"><div className="h-1.5 bg-slate-100"><div className="h-1.5 bg-slate-600" style={{width:`${Math.min(100,Math.round(Number(p.paid_ugx)/Number(p.total_ugx)*100))}%`}}/></div>
            <p className="mt-1 text-xs text-slate-500">Paid {ugx(p.paid_ugx)} · due by today {ugx(p.due_ugx)}</p></div>}
          <p className="mt-1 text-xs text-slate-500">Agreed {dateTime(p.created_at)}{p.created_by_name?` by ${p.created_by_name}`:""}{p.note?` · ${p.note}`:""}{p.cancelled_at?` · cancelled ${dateTime(p.cancelled_at)} by ${p.cancelled_by_name}: ${p.cancel_reason}`:""}</p>
          {p.status==="active"&&(cancelling?.id===p.id?<form onSubmit={e=>{e.preventDefault();void send(`/api/waste/billing/arrears/plans/${p.id}/cancel`,{reason:new FormData(e.currentTarget).get("reason")})}} className="mt-2 flex flex-wrap gap-2">
              <input name="reason" required minLength={5} maxLength={300} placeholder="Why the plan is cancelled" className="min-w-56 flex-1 border border-slate-300 px-3 py-2"/>
              <button disabled={saving} className="bg-red-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Cancel plan</button>
              <button type="button" onClick={()=>setCancelling(null)} className="px-2 text-xs text-slate-600">Keep</button></form>
            :<button onClick={()=>setCancelling(p)} className="mt-1 min-h-0 px-0 py-0 text-xs text-[var(--color-danger)]">Cancel plan</button>)}
        </li>)}</ul></div>}

      <div><h3 className="mb-2 font-semibold text-slate-900">Unpaid bills</h3>
        {d.bills.length?<div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Bill</th><th>Due</th><th className="text-right">Days late</th><th className="text-right">Balance</th></tr></thead>
          <tbody>{d.bills.map(b=><tr key={b.id}><td>{b.invoice_number}</td><td>{day(b.due_on)}</td><td className={`text-right tabular-nums ${b.days_late>90?"text-[var(--color-danger)]":""}`}>{b.days_late||"—"}</td>
            <td className="text-right tabular-nums">{ugx(b.balance_ugx)}<span className="text-xs text-slate-500"> of {Number(b.amount_ugx).toLocaleString("en-GB")}</span></td></tr>)}</tbody></table></div>
          :<p className="text-slate-600">Nothing unpaid.</p>}</div>

      <div><h3 className="mb-2 font-semibold text-slate-900">Follow-ups</h3>
        {d.followUps.length?<ul className="grid gap-2">{d.followUps.map(f=><li key={f.id} className="border-l-2 border-slate-300 pl-3">
          <p><span className="font-medium">{CHANNEL[f.channel]}: {OUTCOME[f.outcome]}</span>{f.promised_amount_ugx&&<> · {ugx(f.promised_amount_ugx)} by {day(f.promised_on)}{f.promise_state&&<span className={`font-semibold ${PROMISE[f.promise_state][1]}`}> · {PROMISE[f.promise_state][0]}</span>}</>}</p>
          {f.note&&<p className="text-slate-700">{f.note}</p>}
          <p className="text-xs text-slate-500">{dateTime(f.created_at)}{f.created_by_name?` · ${f.created_by_name}`:""} · owed {ugx(f.balance_at_follow_up_ugx)} then</p></li>)}</ul>
          :<p className="text-slate-600">No follow-up recorded yet.</p>}</div>

      <div><h3 className="mb-2 font-semibold text-slate-900">Recent payments</h3>
        {d.payments.length?<ul className="grid gap-1">{d.payments.map((p,i)=><li key={i} className="flex justify-between"><span>{dateTime(p.paid_at)} · {p.provider.replace(/_/g," ")}</span><span className="tabular-nums">{ugx(p.amount_ugx)}</span></li>)}</ul>
          :<p className="text-slate-600">No payment recorded.</p>}</div>
    </div>}
  </Modal>;
}
