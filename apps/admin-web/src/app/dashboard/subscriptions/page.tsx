"use client";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {Pagination} from "@/components/ui/Pagination";
import {apiRequest} from "@/lib/api";
import {useServerList} from "@/lib/factory";
import {INVOICE_STATUS,Invoice,Plan,STATUS,SubStatus,Subscription,SubscriptionData,day,limit,todayIso,ugx} from "@/lib/subscriptions";

type Overview={counts:Partial<Record<SubStatus,number>>;mrr_ugx:number;trials_ending_7d:number;invoices:{to_confirm:number;outstanding_ugx:number;overdue_ugx:number;collected_this_month_ugx:number}};
type Row={organization_id:string;organization_name:string;organization_type:string;plan_name:string;billing_cycle:string;status:SubStatus;trial_ends_at:string|null;period_end:string;cancel_at_period_end:boolean;outstanding_ugx:number};
type Detail=SubscriptionData&{subscription:Subscription;events:Array<{action:string;note:string|null;created_at:string;actor_name:string|null}>};
type Company={id:string;name:string;type:string;plan_code:string|null};
type Tab="subscriptions"|"invoices"|"plans"|"start";
const TYPE:Record<string,string>={waste_collection_company:"Collector",recycling_company:"Recycler",processing_plant:"Factory"};
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";

export default function SubscriptionsAdminPage(){
  const [tab,setTab]=useState<Tab>("subscriptions"),[status,setStatus]=useState(""),[invoiceStatus,setInvoiceStatus]=useState("payment_submitted");
  const [overview,setOverview]=useState<Overview|null>(null),[detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState(""),[message,setMessage]=useState("");
  const subs=useServerList<Row>(`/api/waste/saas/subscriptions${status?`?status=${status}`:""}`);
  const invoices=useServerList<Invoice>(`/api/waste/saas/invoices?status=${invoiceStatus}`);
  const load=useCallback(async()=>{try{setOverview((await apiRequest<{data:Overview}>("/api/waste/saas/overview")).data)}catch(e){setError(e instanceof Error?e.message:"Could not load subscriptions")}},[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  async function open(id:string){try{setDetail((await apiRequest<{data:Detail}>(`/api/waste/saas/subscriptions/${id}`)).data)}catch(e){setError(e instanceof Error?e.message:"Could not open the subscription")}}
  async function refresh(text:string){setMessage(text);setError("");await Promise.all([load(),subs.reload(),invoices.reload()]);if(detail)await open(detail.subscription.organization_id);}
  const o=overview,c=o?.counts??{};

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow="Platform" title="Subscriptions" description="Companies on the Waste Management SaaS: plans, trials, invoices and payments. Payments are made by mobile money or bank transfer and confirmed here."/>
    {error&&<Feedback tone="error">{error}</Feedback>}{message&&<Feedback tone="success">{message}</Feedback>}

    {o&&<div className="grid grid-cols-2 border border-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-6 rounded-[var(--ui-radius-lg)]">
      {([["Monthly recurring revenue",ugx(o.mrr_ugx),`${(c.active??0)+(c.past_due??0)} paying companies`],["In trial",c.trialing??0,`${o.trials_ending_7d} ending within 7 days`],["Payment overdue",c.past_due??0,ugx(o.invoices.overdue_ugx)],["Suspended",c.suspended??0,`${c.cancelled??0} ended`],["Payments to confirm",o.invoices.to_confirm,`${ugx(o.invoices.outstanding_ugx)} outstanding`],["Collected this month",ugx(o.invoices.collected_this_month_ugx),`${c.complimentary??0} complimentary`]] as const).map(([label,value,hint],i)=>
        <div key={label} className={`px-4 py-3 ${i?"border-l border-slate-200":""}`}><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{value}</p><p className="text-xs text-slate-500">{hint}</p></div>)}
    </div>}

    <div role="tablist" className="flex gap-6 border-b border-slate-200 text-sm">{([["subscriptions","Subscriptions"],["invoices",`Invoices${o?.invoices.to_confirm?` (${o.invoices.to_confirm} to confirm)`:""}`],["plans","Plans and prices"],["start","Start a subscription"]] as const).map(([value,label])=>
      <button key={value} role="tab" aria-selected={tab===value} onClick={()=>setTab(value)} className={`-mb-px min-h-0 border-b-2 px-0 pb-2.5 ${tab===value?"border-[var(--color-action)] font-semibold text-slate-950":"border-transparent text-slate-600 hover:text-slate-900"}`}>{label}</button>)}</div>

    {tab==="subscriptions"&&<section className="space-y-3">
      <select aria-label="Status" value={status} onChange={e=>{setStatus(e.target.value);subs.setPage(1)}} className="border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">All statuses</option>{(Object.keys(STATUS) as SubStatus[]).map(s=><option key={s} value={s}>{STATUS[s].label}</option>)}</select>
      {subs.rows.length?<div className="table-wrap"><table className="w-full min-w-[900px] text-left">
        <thead><tr><th>Company</th><th>Plan</th><th>Status</th><th>Renews or ends</th><th className="text-right">Outstanding</th><th/></tr></thead>
        <tbody>{subs.rows.map(r=><tr key={r.organization_id}>
          <td><p className="table-primary">{r.organization_name}</p><p className="table-secondary">{TYPE[r.organization_type]}</p></td>
          <td>{r.plan_name}<p className="table-secondary capitalize">{r.billing_cycle}</p></td>
          <td><span className={STATUS[r.status].className}>{STATUS[r.status].label}</span>{r.cancel_at_period_end&&<p className="table-secondary">Ending</p>}</td>
          <td>{r.status==="trialing"?`Trial ends ${day(r.trial_ends_at)}`:day(r.period_end)}</td>
          <td className={`text-right tabular-nums ${r.outstanding_ugx?"font-medium":""}`}>{r.outstanding_ugx?ugx(r.outstanding_ugx):"—"}</td>
          <td className="text-right"><button onClick={()=>void open(r.organization_id)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Open</button></td>
        </tr>)}</tbody>
      </table></div>:!subs.loading&&<EmptyState title="No subscriptions in this view"/>}
      <Pagination page={subs.page} pageSize={subs.pageSize} total={subs.total} totalPages={subs.totalPages} onPage={subs.setPage} onPageSize={subs.setPageSize}/>
    </section>}

    {tab==="invoices"&&<section className="space-y-3">
      <select aria-label="Invoice status" value={invoiceStatus} onChange={e=>{setInvoiceStatus(e.target.value);invoices.setPage(1)}} className="border border-slate-300 bg-white px-3 py-2 text-sm"><option value="payment_submitted">Payments to confirm</option><option value="overdue">Overdue</option><option value="open">Unpaid</option><option value="paid">Paid</option><option value="void">Void</option></select>
      {invoices.rows.length?<div className="table-wrap"><table className="w-full min-w-[900px] text-left">
        <thead><tr><th>Invoice</th><th>Company</th><th className="text-right">Amount</th><th>Due</th><th>Status</th><th/></tr></thead>
        <tbody>{invoices.rows.map(i=><tr key={i.id}>
          <td><p className="table-primary">{i.invoice_number}</p><p className="table-secondary">{i.plan_name} · {i.kind==="proration"?"upgrade":`${day(i.period_start)} to ${day(i.period_end)}`}</p></td>
          <td>{i.organization_name}</td><td className="text-right tabular-nums">{ugx(i.amount_ugx)}</td>
          <td className={i.overdue?"font-medium text-[var(--color-danger)]":""}>{day(i.due_on)}</td>
          <td><span className={INVOICE_STATUS[i.status].className}>{INVOICE_STATUS[i.status].label}</span>{i.payment_reference&&<p className="table-secondary">{i.payment_reference}</p>}</td>
          <td className="whitespace-nowrap text-right"><InvoiceActions invoice={i} onDone={refresh} onError={setError}/></td>
        </tr>)}</tbody>
      </table></div>:!invoices.loading&&<EmptyState title="No invoices in this view"/>}
      <Pagination page={invoices.page} pageSize={invoices.pageSize} total={invoices.total} totalPages={invoices.totalPages} onPage={invoices.setPage} onPageSize={invoices.setPageSize}/>
    </section>}

    {tab==="plans"&&<PlansEditor onSaved={text=>void refresh(text)} onError={setError}/>}
    {tab==="start"&&<StartSubscription onDone={text=>void refresh(text)} onError={setError}/>}

    {detail&&<SubscriptionPanel detail={detail} onClose={()=>setDetail(null)} onDone={refresh} onError={setError}/>}
  </div></AppShell>;
}

function InvoiceActions({invoice,onDone,onError}:{invoice:Invoice;onDone:(message:string)=>Promise<void>;onError:(message:string)=>void}){
  const [mode,setMode]=useState<null|"record"|"reject"|"void">(null),[busy,setBusy]=useState(false);
  async function send(path:string,body:unknown,text:string){setBusy(true);try{await apiRequest(`/api/waste/saas/invoices/${invoice.id}/${path}`,{method:"PATCH",body:JSON.stringify(body)});setMode(null);await onDone(text)}catch(e){onError(e instanceof Error?e.message:"Could not save")}finally{setBusy(false)}}
  if(invoice.status==="paid"||invoice.status==="void")return null;
  return <>
    {invoice.status==="payment_submitted"?<><button disabled={busy} onClick={()=>void send("confirm",{},`${invoice.invoice_number}: payment confirmed.`)} className="mr-2 bg-[var(--color-action)] px-3 py-2 text-xs font-semibold text-white">Confirm</button><button onClick={()=>setMode("reject")} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Not found</button></>
      :<><button onClick={()=>setMode("record")} className="mr-2 border border-slate-300 px-3 py-2 text-xs text-slate-700">Record payment</button><button onClick={()=>setMode("void")} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Void</button></>}
    <Modal open={mode!==null} title={mode==="record"?`Record payment for ${invoice.invoice_number}`:mode==="reject"?"Payment not found":`Void ${invoice.invoice_number}`} description={`${invoice.organization_name} · ${ugx(invoice.amount_ugx)}`} onClose={()=>setMode(null)}>
      <form className="grid gap-4 text-left text-sm" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);
        if(mode==="record")void send("confirm",{reference:f.get("reference"),paidOn:f.get("paidOn")},`${invoice.invoice_number}: payment recorded.`);
        else void send(mode==="reject"?"reject-payment":"void",{reason:f.get("reason")},mode==="reject"?"Payment rejected.":"Invoice voided.")}}>
        {mode==="record"?<div className="grid gap-3 sm:grid-cols-2"><label className="font-medium text-slate-700">Reference<input name="reference" required minLength={4} className={field}/></label><label className="font-medium text-slate-700">Paid on<input name="paidOn" type="date" required max={todayIso()} defaultValue={todayIso()} className={field}/></label></div>
          :<label className="font-medium text-slate-700">Reason (shown to the company)<textarea name="reason" required minLength={5} rows={3} className={field}/></label>}
        <div className="flex justify-end gap-2"><button type="button" onClick={()=>setMode(null)} className="border border-slate-300 px-4 py-2.5 font-medium text-slate-700">Cancel</button><button disabled={busy} className="bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">Save</button></div>
      </form>
    </Modal>
  </>;
}

function PlansEditor({onSaved,onError}:{onSaved:(message:string)=>void;onError:(message:string)=>void}){
  const [plans,setPlans]=useState<Plan[]>([]);
  useEffect(()=>{apiRequest<{data:Plan[]}>("/api/waste/saas/plans").then(r=>setPlans(r.data)).catch(e=>onError(e.message))},[onError]);
  async function save(p:Plan,e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget),n=(k:string)=>{const v=String(f.get(k)??"").trim();return v===""?null:Number(v)};
    try{await apiRequest(`/api/waste/saas/plans/${p.code}`,{method:"PUT",body:JSON.stringify({monthlyFeeUgx:n("monthly")??0,annualFeeUgx:n("annual")??0,maxVehicles:n("vehicles"),maxUsers:n("users"),trialDays:n("trial")??0,isPublic:f.get("public")==="on"})});onSaved(`${p.name}: saved.`)}
    catch(err){onError(err instanceof Error?err.message:"Could not save")}
  }
  const input="mt-1 block w-28 border border-slate-300 px-2 py-1.5 text-sm";
  return <section className="space-y-3"><p className="text-sm text-slate-600">Prices are placeholders until the business sets them. Leave a limit empty for unlimited. A price change applies from each company&rsquo;s next invoice.</p>
    {plans.map(p=><form key={p.code} onSubmit={e=>void save(p,e)} className="card flex flex-wrap items-end gap-3 p-4">
      <div className="min-w-48 flex-1"><p className="font-semibold text-slate-900">{p.name}</p><p className="text-xs text-slate-500">{TYPE[p.organization_type]} · {p.code}</p></div>
      <label className="text-xs text-slate-500">Monthly (UGX)<input name="monthly" type="number" min={0} step={1000} defaultValue={p.monthly_fee_ugx} className={input}/></label>
      <label className="text-xs text-slate-500">Annual (UGX)<input name="annual" type="number" min={0} step={1000} defaultValue={p.annual_fee_ugx} className={input}/></label>
      <label className="text-xs text-slate-500">Vehicles<input name="vehicles" type="number" min={1} defaultValue={p.max_vehicles??""} placeholder="Unlimited" className={input}/></label>
      <label className="text-xs text-slate-500">Staff<input name="users" type="number" min={1} defaultValue={p.max_users??""} placeholder="Unlimited" className={input}/></label>
      <label className="text-xs text-slate-500">Trial days<input name="trial" type="number" min={0} max={90} defaultValue={p.trial_days} className={input}/></label>
      <label className="flex items-center gap-1 pb-2 text-xs text-slate-600"><input name="public" type="checkbox" defaultChecked={p.is_public} className="h-4 w-4"/>Offered</label>
      <button className="bg-[var(--color-action)] px-3 py-2 text-xs font-semibold text-white">Save</button>
    </form>)}
  </section>;
}

function StartSubscription({onDone,onError}:{onDone:(message:string)=>void;onError:(message:string)=>void}){
  const [companies,setCompanies]=useState<Company[]>([]),[plans,setPlans]=useState<Plan[]>([]),[company,setCompany]=useState("");
  const loadCompanies=useCallback(()=>apiRequest<{data:Company[]}>("/api/waste/saas/unsubscribed").then(r=>setCompanies(r.data)).catch(e=>onError(e.message)),[onError]);
  useEffect(()=>{void loadCompanies();apiRequest<{data:Plan[]}>("/api/waste/saas/plans").then(r=>setPlans(r.data)).catch(()=>undefined)},[loadCompanies]);
  const chosen=companies.find(x=>x.id===company);
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);
    try{await apiRequest("/api/waste/saas/subscriptions",{method:"POST",body:JSON.stringify({organizationId:company,planCode:f.get("plan"),mode:f.get("mode")})});setCompany("");await loadCompanies();onDone(`${chosen?.name}: subscription started.`)}
    catch(err){onError(err instanceof Error?err.message:"Could not start the subscription")}
  }
  if(!companies.length)return <EmptyState title="Every active company has a subscription" description="Companies approved through account applications start their trial automatically."/>;
  return <form onSubmit={submit} className="card grid max-w-2xl gap-4 p-6 text-sm">
    <label className="font-medium text-slate-700">Company<select value={company} onChange={e=>setCompany(e.target.value)} required className={field}><option value="">Choose</option>{companies.map(x=><option key={x.id} value={x.id}>{x.name} ({TYPE[x.type]})</option>)}</select></label>
    {chosen&&<label className="font-medium text-slate-700">Plan<select name="plan" required defaultValue={chosen.plan_code??""} className={field}>{plans.filter(p=>p.organization_type===chosen.type).map(p=><option key={p.code} value={p.code}>{p.name} · {p.monthly_fee_ugx?`${ugx(p.monthly_fee_ugx)}/month`:"free"}</option>)}</select></label>}
    <fieldset className="flex gap-6"><label className="flex items-center gap-2"><input type="radio" name="mode" value="trial" defaultChecked/>Free trial, then billing</label><label className="flex items-center gap-2"><input type="radio" name="mode" value="complimentary"/>Complimentary (no billing, no limits)</label></fieldset>
    <div><button disabled={!company} className="bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">Start subscription</button></div>
  </form>;
}

function SubscriptionPanel({detail,onClose,onDone,onError}:{detail:Detail;onClose:()=>void;onDone:(message:string)=>Promise<void>;onError:(message:string)=>void}){
  const s=detail.subscription,[mode,setMode]=useState<null|"extend_trial"|"suspend"|"reactivate"|"make_complimentary"|"start_billing">(null),[busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!mode)return;const f=new FormData(e.currentTarget);setBusy(true);
    try{await apiRequest(`/api/waste/saas/subscriptions/${s.organization_id}`,{method:"PATCH",body:JSON.stringify({action:mode,days:mode==="extend_trial"?Number(f.get("days")):undefined,reason:String(f.get("reason")??"")||undefined})});setMode(null);await onDone(`${s.organization_name}: subscription updated.`)}
    catch(err){onError(err instanceof Error?err.message:"Could not update")}finally{setBusy(false)}
  }
  const button=(m:NonNullable<typeof mode>,label:string)=><button onClick={()=>setMode(mode===m?null:m)} className="border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">{label}</button>;
  return <div className="anim-fade fixed inset-0 z-[1500] flex justify-end bg-slate-900/40" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section className="h-full w-full max-w-2xl overflow-y-auto bg-white">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-slate-200 bg-white px-6 py-5">
        <div><p className="text-xs font-medium text-slate-500">{TYPE[s.organization_type]} · {s.plan_name} · {s.billing_cycle}</p><h2 className="mt-1 text-xl font-semibold">{s.organization_name}</h2><div className="mt-2"><span className={STATUS[s.status].className}>{STATUS[s.status].label}</span></div></div>
        <button onClick={onClose} className="text-sm font-medium text-slate-500 hover:text-slate-900">Close</button>
      </header>
      <div className="space-y-6 px-6 py-6 text-sm">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          <div><dt className="text-xs text-slate-500">{s.status==="trialing"?"Trial ends":"Current period"}</dt><dd>{s.status==="trialing"?day(s.trial_ends_at):`${day(s.period_start)} to ${day(s.period_end)}`}</dd></div>
          <div><dt className="text-xs text-slate-500">Price</dt><dd>{s.price_ugx?`${ugx(s.price_ugx)} / ${s.billing_cycle==="annual"?"year":"month"}`:"Free"}</dd></div>
          <div><dt className="text-xs text-slate-500">Vehicles</dt><dd>{detail.usage.vehicles} of {limit(s.max_vehicles)}</dd></div>
          <div><dt className="text-xs text-slate-500">Active staff</dt><dd>{detail.usage.users} of {limit(s.max_users)}</dd></div>
          {s.status_reason&&<div className="col-span-2"><dt className="text-xs text-slate-500">Reason</dt><dd>{s.status_reason}</dd></div>}
        </dl>
        <div className="space-y-3 border-y border-slate-100 py-4">
          <div className="flex flex-wrap gap-2">
            {s.status==="trialing"&&button("extend_trial","Extend trial")}
            {["trialing","active","past_due","complimentary"].includes(s.status)&&button("suspend","Suspend")}
            {["suspended","cancelled"].includes(s.status)&&button("reactivate","Reactivate")}
            {s.status!=="complimentary"&&button("make_complimentary","Make complimentary")}
            {s.status==="complimentary"&&button("start_billing","Start billing")}
          </div>
          {mode&&<form onSubmit={submit} className="grid gap-3">
            {mode==="extend_trial"&&<label className="font-medium text-slate-700">Extra days<input name="days" type="number" required min={1} max={60} defaultValue={14} className={field}/></label>}
            {mode!=="start_billing"&&<label className="font-medium text-slate-700">Reason{["suspend","make_complimentary"].includes(mode)?"":" (optional)"}<textarea name="reason" required={["suspend","make_complimentary"].includes(mode)} minLength={["suspend","make_complimentary"].includes(mode)?5:undefined} rows={2} className={field}/></label>}
            {mode==="start_billing"&&<p className="text-slate-600">A new period starts today and the first invoice ({s.price_ugx?ugx(s.price_ugx):"none, free plan"}) is issued.</p>}
            <div className="flex justify-end gap-2"><button type="button" onClick={()=>setMode(null)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Cancel</button><button disabled={busy} className="bg-[var(--color-action)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Save</button></div>
          </form>}
        </div>
        <div><h3 className="font-semibold">Invoices</h3>{detail.invoices.length?<ul className="mt-2 divide-y divide-slate-100">{detail.invoices.map(i=><li key={i.id} className="flex justify-between gap-3 py-2"><span>{i.invoice_number} · {ugx(i.amount_ugx)} · due {day(i.due_on)}</span><span className={i.overdue?"status status-failed normal-case":INVOICE_STATUS[i.status].className}>{i.overdue?"Overdue":INVOICE_STATUS[i.status].label}</span></li>)}</ul>:<p className="mt-2 text-slate-500">None yet.</p>}</div>
        <div><h3 className="font-semibold">History</h3><ol className="mt-3 space-y-2 border-l border-slate-200 pl-4">{detail.events.map((e,i)=><li key={i}><p className="text-xs text-slate-500">{new Date(e.created_at).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"})}{e.actor_name?` · ${e.actor_name}`:" · automatic"}</p><p className="font-medium capitalize text-slate-800">{e.action.replaceAll("_"," ")}</p>{e.note&&<p className="text-slate-600">{e.note}</p>}</li>)}</ol></div>
      </div>
    </section>
  </div>;
}
