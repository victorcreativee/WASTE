"use client";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {apiRequest} from "@/lib/api";
import {INVOICE_STATUS,Invoice,Plan,STATUS,SubscriptionData,day,limit,todayIso,ugx} from "@/lib/subscriptions";

const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";

function Usage({label,used,max}:{label:string;used:number;max:number|null}){
  const share=max?Math.min(100,Math.round(used/max*100)):0;
  return <div><div className="flex justify-between text-sm"><span className="text-slate-600">{label}</span><span className="tabular-nums text-slate-900">{used} of {limit(max)}</span></div>
    <div className="mt-1.5 h-1.5 bg-slate-100"><div className={`h-full ${share>=100?"bg-[var(--color-danger)]":share>=80?"bg-[var(--color-warning)]":"bg-[var(--color-action)]"}`} style={{width:`${max?share:4}%`}}/></div></div>;
}

export default function SubscriptionPage(){
  const [data,setData]=useState<SubscriptionData|null>(null),[cycle,setCycle]=useState<"monthly"|"annual">("monthly"),[paying,setPaying]=useState<Invoice|null>(null);
  const [error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState("");
  const load=useCallback(async()=>{try{const r=(await apiRequest<{data:SubscriptionData}>("/api/waste/subscription")).data;setData(r);if(r.subscription)setCycle(r.subscription.billing_cycle)}catch(e){setError(e instanceof Error?e.message:"Could not load your subscription")}},[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  async function act(key:string,path:string,method:string,body?:unknown){
    setBusy(key);setError("");setMessage("");
    try{const r=await apiRequest<{message:string}>(path,{method,body:body?JSON.stringify(body):undefined});setMessage(r.message);await load()}
    catch(e){setError(e instanceof Error?e.message:"Could not save")}finally{setBusy("")}
  }
  const s=data?.subscription,open=data?.invoices.filter(i=>i.status==="open")??[];

  return <AppShell><div className="mx-auto max-w-[1200px] space-y-6">
    <PageHeader eyebrow="Administration" title="Subscription" description="Your plan, what it includes, and your invoices. KCCA regulation (permit, returns, compliance) is free and never depends on the subscription."/>
    {error&&<Feedback tone="error">{error}</Feedback>}{message&&<Feedback tone="success">{message}</Feedback>}
    {data&&!s&&<EmptyState title="Your company has no subscription yet" description="Your account is managed directly by the platform team. Contact them to choose a plan."/>}
    {s?.status==="suspended"&&<Feedback tone="error">The subscription is suspended{s.status_reason?` (${s.status_reason})`:""}. Your records stay available to read and KCCA obligations can still be met; pay the overdue invoice below to make changes again.</Feedback>}
    {s?.status==="past_due"&&<Feedback tone="warning">An invoice is overdue. The subscription is suspended {data?.rules?.suspendAfterDays??14} days after its due date.</Feedback>}
    {s?.status==="cancelled"&&<Feedback tone="warning">The subscription has ended. Your records stay available to read. Contact the platform team to resume.</Feedback>}

    {s&&data&&<div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-medium text-slate-500">Current plan</p><h2 className="mt-1 text-2xl font-semibold text-slate-950">{s.plan_name}</h2></div><span className={STATUS[s.status].className}>{STATUS[s.status].label}</span></div>
        <p className="mt-3 text-sm text-slate-600">{s.status==="complimentary"?"Provided free of charge by the platform.":s.status==="trialing"?`Free trial: ${s.trial_days_left} day${s.trial_days_left===1?"":"s"} left, until ${day(s.trial_ends_at)}. Billing at ${ugx(s.price_ugx)} per ${s.billing_cycle==="annual"?"year":"month"} starts then.`
          :s.price_ugx>0?`${ugx(s.price_ugx)} per ${s.billing_cycle==="annual"?"year":"month"}. Current period ${day(s.period_start)} to ${day(s.period_end)}.`:"Free plan."}</p>
        {s.pending_plan_name&&<p className="mt-2 text-sm text-slate-600">Moves to <span className="font-medium text-slate-900">{s.pending_plan_name}</span> on {day(s.period_end)}.</p>}
        {s.pending_billing_cycle&&<p className="mt-2 text-sm text-slate-600">{s.pending_billing_cycle==="annual"?"Annual":"Monthly"} billing from {day(s.period_end)}.</p>}
        {s.cancel_at_period_end&&<p className="mt-2 text-sm font-medium text-[var(--color-warning)]">Ends on {day(s.period_end)}.</p>}
        <div className="mt-5 space-y-4"><Usage label="Vehicles" used={data.usage.vehicles} max={s.max_vehicles}/><Usage label="Active staff accounts" used={data.usage.users} max={s.max_users}/></div>
        {["trialing","active","past_due"].includes(s.status)&&<div className="mt-6 border-t border-slate-100 pt-4">{s.cancel_at_period_end
          ?<button onClick={()=>void act("resume","/api/waste/subscription/resume","POST")} disabled={busy==="resume"} className="border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Keep my subscription</button>
          :<button onClick={()=>{if(window.confirm(`End the subscription on ${day(s.period_end)}? Records stay available to read.`))void act("cancel","/api/waste/subscription/cancel","POST")}} disabled={busy==="cancel"} className="min-h-0 p-0 text-xs font-medium text-slate-500 hover:text-[var(--color-danger)] hover:underline">End subscription at the end of this period</button>}</div>}
      </section>

      <section className="card p-6"><h2 className="font-semibold">Invoices</h2>
        {data.invoices.length?<ul className="mt-3 divide-y divide-slate-100">{data.invoices.map(i=><li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div><p className="font-medium text-slate-900">{i.invoice_number} · {ugx(i.amount_ugx)}</p><p className="text-xs text-slate-500">{i.kind==="proration"?"Upgrade for the rest of the period":`${day(i.period_start)} to ${day(i.period_end)}`} · due {day(i.due_on)}</p></div>
          <div className="flex items-center gap-2"><span className={i.overdue?"status status-failed normal-case":INVOICE_STATUS[i.status].className}>{i.overdue?"Overdue":INVOICE_STATUS[i.status].label}</span>{i.status==="open"&&<button onClick={()=>setPaying(i)} className="bg-[var(--color-action)] px-3 py-1.5 text-xs font-semibold text-white">I have paid</button>}</div>
        </li>)}</ul>:<p className="mt-3 text-sm text-slate-500">No invoices yet.</p>}
        {open.length>0&&<p className="mt-3 text-xs text-slate-500">Pay by mobile money or bank transfer quoting the invoice number, then enter the transaction reference. The platform confirms it within one working day.</p>}
      </section>
    </div>}

    {s&&data&&!["suspended","cancelled"].includes(s.status)&&data.plans.length>1&&<section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Plans</h2>
        <div role="radiogroup" aria-label="Billing" className="inline-flex overflow-hidden rounded-[var(--ui-radius)] border border-slate-300 bg-white text-sm">{(["monthly","annual"] as const).map((value,i)=><button key={value} role="radio" aria-checked={cycle===value} onClick={()=>setCycle(value)} className={`min-h-0 rounded-none px-3 py-1.5 ${i?"border-l border-slate-300":""} ${cycle===value?"bg-slate-900 text-white":"text-slate-700 hover:bg-slate-50"}`}>{value==="monthly"?"Monthly":"Annual"}</button>)}</div></div>
      <div className="grid gap-4 md:grid-cols-3">{data.plans.map((p:Plan)=>{const current=p.code===s.plan_code,price=cycle==="annual"?p.annual_fee_ugx:p.monthly_fee_ugx,dearer=p.monthly_fee_ugx>s.monthly_fee_ugx;
        return <div key={p.code} className={`card flex flex-col p-5 ${current?"border-[var(--color-action)]":""}`}>
          <p className="font-semibold text-slate-950">{p.name}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{price>0?ugx(price):"Free"}<span className="text-sm font-normal text-slate-500">{price>0?(cycle==="annual"?" / year":" / month"):""}</span></p>
          <p className="mt-2 flex-1 text-sm text-slate-600">{p.description}</p>
          <p className="mt-3 text-xs text-slate-500">{limit(p.max_vehicles)} vehicles · {limit(p.max_users)} staff accounts</p>
          {current&&cycle===s.billing_cycle?<p className="mt-4 text-sm font-medium text-[var(--color-action)]">Your plan</p>
            :<button onClick={()=>void act(p.code,"/api/waste/subscription/plan","PATCH",{planCode:p.code,billingCycle:cycle})} disabled={busy===p.code} className={`mt-4 px-3 py-2 text-sm font-semibold disabled:opacity-50 ${dearer?"bg-[var(--color-action)] text-white":"border border-slate-300 text-slate-700"}`}>{current?`Switch to ${cycle} billing`:dearer?"Upgrade now":"Move to this plan"}</button>}
        </div>})}</div>
      <p className="text-xs text-slate-500">An upgrade applies at once; for a paid period you are invoiced for the difference for the days that remain. A cheaper plan or a change of billing starts at the end of the current period. During the trial, changes apply at once.</p>
    </section>}

    <PaymentDialog invoice={paying} onClose={()=>setPaying(null)} onDone={async text=>{setPaying(null);setMessage(text);await load()}}/>
  </div></AppShell>;
}

function PaymentDialog({invoice,onClose,onDone}:{invoice:Invoice|null;onClose:()=>void;onDone:(message:string)=>Promise<void>}){
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!invoice)return;const f=new FormData(e.currentTarget);setBusy(true);setError("");
    try{await apiRequest(`/api/waste/subscription/invoices/${invoice.id}/payment`,{method:"POST",body:JSON.stringify({reference:f.get("reference"),paidOn:f.get("paidOn")})});await onDone(`${invoice.invoice_number}: payment sent for confirmation.`)}
    catch(err){setError(err instanceof Error?err.message:"Could not send the payment")}finally{setBusy(false)}
  }
  return <Modal open={Boolean(invoice)} title={`Pay ${invoice?.invoice_number||"invoice"}`} description={invoice?`${ugx(invoice.amount_ugx)}, due ${day(invoice.due_on)}.`:undefined} onClose={onClose}>
    <form onSubmit={submit} className="grid gap-4 text-sm">
      {error&&<Feedback tone="error">{error}</Feedback>}
      <div className="grid gap-3 sm:grid-cols-2"><label className="font-medium text-slate-700">Transaction reference<input name="reference" required minLength={4} maxLength={100} placeholder="Mobile money or bank reference" className={field}/></label><label className="font-medium text-slate-700">Paid on<input name="paidOn" type="date" required max={todayIso()} defaultValue={todayIso()} className={field}/></label></div>
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="border border-slate-300 px-4 py-2.5 font-medium text-slate-700">Cancel</button><button disabled={busy} className="bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">{busy?"Sending…":"Send"}</button></div>
    </form>
  </Modal>;
}
