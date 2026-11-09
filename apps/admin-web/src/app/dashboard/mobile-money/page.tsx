"use client";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {apiRequest,openAuthenticatedFile} from "@/lib/api";
import { Pager, usePagination } from "@/components/ui/Pagination";
import {day,todayIso} from "@/lib/factory";
import {useHasRole} from "@/lib/session";

type Provider="mtn_momo"|"airtel_money";
type Account={provider:Provider;status:"active"|"disabled"|"not_connected";environment?:"sandbox"|"production";credentials_hint?:string;last_verified_at?:string|null;last_error?:string|null;updated_at?:string};
type Accounts={accounts:Account[];simulator:boolean;callback_url:string|null};
type Day={day:string;provider:Provider;requests:number;confirmed:number;confirmed_ugx:string;failed:number;waiting:number;exceptions:number};
type Open={id:string;amount_ugx:string;provider:Provider;payer_phone:string|null;status:string;provider_status:string|null;provider_message:string|null;provider_amount_ugx:string|null;review_reason:string|null;provider_request_id:string;provider_reference:string|null;created_at:string;last_checked_at:string|null;invoice_number:string;customer_name:string};
type Reconciliation={totals:{requests:number;confirmed:number;confirmed_ugx:string;exceptions:number;manual_waiting:number;exception_rate:number|null};days:Day[];open:Open[]};

const NAME:Record<Provider,string>={mtn_momo:"MTN MoMo",airtel_money:"Airtel Money"};
const ugx=(v:string|number|null)=>v===null?"—":`UGX ${Number(v).toLocaleString("en-GB")}`;
const when=(iso:string|null|undefined)=>iso?new Date(iso).toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):"—";
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";
const monthStart=()=>`${todayIso().slice(0,8)}01`;

export default function MobileMoneyPage(){
  const isAdmin=useHasRole("company_admin");
  const [accounts,setAccounts]=useState<Accounts|null>(null),[rec,setRec]=useState<Reconciliation|null>(null);
  const [range,setRange]=useState({from:monthStart(),to:todayIso()}),[connecting,setConnecting]=useState<Provider|null>(null),[resolving,setResolving]=useState<Open|null>(null);
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState("");

  const loadAccounts=useCallback(async()=>{if(!isAdmin)return;try{setAccounts((await apiRequest<{data:Accounts}>("/api/waste/billing/mobile-money/accounts")).data)}catch(e){setError(e instanceof Error?e.message:"Could not load accounts")}},[isAdmin]);
  const loadRec=useCallback(async()=>{try{setRec((await apiRequest<{data:Reconciliation}>(`/api/waste/billing/mobile-money/reconciliation?from=${range.from}&to=${range.to}`)).data)}catch(e){setError(e instanceof Error?e.message:"Could not load reconciliation")}},[range]);
  useEffect(()=>{const timer=window.setTimeout(()=>void loadAccounts(),0);return()=>window.clearTimeout(timer)},[loadAccounts]);
  useEffect(()=>{const timer=window.setTimeout(()=>void loadRec(),0);return()=>window.clearTimeout(timer)},[loadRec]);

  async function act(key:string,work:()=>Promise<{message:string}>){
    setBusy(key);setError("");setNotice("");
    try{setNotice((await work()).message);await Promise.all([loadAccounts(),loadRec()])}catch(e){setError(e instanceof Error?e.message:"Something went wrong")}finally{setBusy("")}
  }
  const post=(path:string,body?:unknown,method="POST")=>apiRequest<{message:string}>(path,{method,body:body===undefined?undefined:JSON.stringify(body)});
  async function statement(){try{await openAuthenticatedFile(`/api/waste/billing/mobile-money/statement?from=${range.from}&to=${range.to}`,{download:`mobile-money-${range.from}-to-${range.to}.csv`})}catch(e){setError(e instanceof Error?e.message:"Could not download the statement")}}
  const t=rec?.totals;
  const openPage=usePagination(rec?.open??[]),daysPage=usePagination(rec?.days??[]);

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow="Commercial" title="Mobile money" description="MTN and Airtel payments into your accounts."/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}
    {accounts?.simulator&&<Feedback tone="warning">Simulated payments are on for this server: providers you have not connected take test payments that are approved after a few seconds (numbers ending in 0 decline). No money moves.</Feedback>}

    {isAdmin&&accounts&&<section className="grid gap-4 md:grid-cols-2">{accounts.accounts.map(a=><div key={a.provider} className="rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="font-semibold text-slate-900">{NAME[a.provider]}</h2>
          <p className="mt-0.5 text-sm text-slate-500">{a.status==="not_connected"?"Not connected: households' payments wait for you to confirm them by hand.":`${a.environment==="production"?"Live":"Sandbox (test)"} account ${a.credentials_hint}`}</p></div>
        <span className={a.status==="active"?(a.last_error?"status status-failed normal-case":"status status-active normal-case"):a.status==="disabled"?"status normal-case":"status status-pending normal-case"}>{a.status==="active"?(a.last_error?"Check failed":"Taking payments"):a.status==="disabled"?"Switched off":"Not connected"}</span>
      </div>
      {a.last_error&&<p className="mt-3 text-sm text-[var(--color-danger)]">{a.last_error}</p>}
      {a.last_verified_at&&<p className="mt-3 text-xs text-slate-500">Credentials last accepted {when(a.last_verified_at)}</p>}
      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <button onClick={()=>setConnecting(a.provider)} className="border border-slate-300 px-3 py-2 text-slate-700">{a.status==="not_connected"?"Connect":"Replace credentials"}</button>
        {a.status!=="not_connected"&&<button disabled={busy===`test-${a.provider}`} onClick={()=>void act(`test-${a.provider}`,()=>post(`/api/waste/billing/mobile-money/accounts/${a.provider}/test`))} className="border border-slate-300 px-3 py-2 text-slate-700 disabled:opacity-60">{busy===`test-${a.provider}`?"Checking…":"Check connection"}</button>}
        {a.status!=="not_connected"&&<button onClick={()=>void act(`status-${a.provider}`,()=>post(`/api/waste/billing/mobile-money/accounts/${a.provider}/status`,{status:a.status==="active"?"disabled":"active"},"PATCH"))} className="border border-slate-300 px-3 py-2 text-slate-700">{a.status==="active"?"Switch off":"Switch on"}</button>}
      </div>
    </div>)}</section>}

    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-slate-900">Reconciliation</h2><p className="text-sm text-slate-600">Match against your MTN and Airtel statements.</p></div>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label className="text-xs font-medium text-slate-600">From<input type="date" value={range.from} onChange={e=>setRange({...range,from:e.target.value})} className="mt-1 block border border-slate-300 px-3 py-2"/></label>
          <label className="text-xs font-medium text-slate-600">To<input type="date" value={range.to} onChange={e=>setRange({...range,to:e.target.value})} className="mt-1 block border border-slate-300 px-3 py-2"/></label>
          <button onClick={()=>void statement()} className="border border-slate-300 bg-white px-3 py-2 text-slate-700">Download statement</button>
        </div>
      </div>

      {t&&<div className="grid grid-cols-2 rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white sm:grid-cols-4">
        {([["Received",ugx(t.confirmed_ugx),`${t.confirmed} of ${t.requests} requests`],["Exceptions",t.exceptions,t.exception_rate===null?"no requests":`${t.exception_rate}% of requests (target under 2%)`],["Waiting on a phone",rec.open.filter(o=>!o.review_reason).length,"checked automatically"],["Recorded by hand",t.manual_waiting,"waiting for you to confirm on Income & billing"]] as const).map(([label,value,hint],i)=>
          <div key={label} className={`px-4 py-3 ${i?"border-l border-slate-200":""}`}><p className="text-xs font-medium text-slate-500">{label}</p><p className={`mt-1 text-xl font-semibold tabular-nums ${label==="Exceptions"&&Number(value)>0?"text-[var(--color-danger)]":"text-slate-900"}`}>{value}</p><p className="text-xs text-slate-500">{hint}</p></div>)}
      </div>}

      {rec&&rec.open.length>0&&<div className="table-wrap"><table className="w-full min-w-[960px] text-left">
        <thead><tr><th>Payment</th><th>Household</th><th className="text-right">Amount</th><th>Provider says</th><th/></tr></thead>
        <tbody>{openPage.paged.map(o=><tr key={o.id}>
          <td><p className="table-primary">{NAME[o.provider]} · {o.invoice_number}</p><p className="table-secondary">{when(o.created_at)} · {o.payer_phone}</p><p className="table-secondary font-mono text-[11px]">{o.provider_request_id}</p></td>
          <td>{o.customer_name}</td>
          <td className="text-right tabular-nums">{ugx(o.amount_ugx)}{o.provider_amount_ugx&&o.provider_amount_ugx!==o.amount_ugx&&<p className="table-secondary text-[var(--color-danger)]">provider: {ugx(o.provider_amount_ugx)}</p>}</td>
          <td>{o.review_reason?<span className="status status-failed normal-case">Needs review</span>:<span className="status status-pending normal-case">Waiting</span>}
            <p className="table-secondary max-w-[360px]">{o.review_reason||o.provider_message||o.provider_status||"No answer yet"}{o.last_checked_at?` · checked ${when(o.last_checked_at)}`:""}</p></td>
          <td className="whitespace-nowrap text-right">{o.review_reason
            ?<button onClick={()=>setResolving(o)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Settle</button>
            :<button disabled={busy===o.id} onClick={()=>void act(o.id,()=>post(`/api/waste/billing/payments/${o.id}/check`))} className="border border-slate-300 px-3 py-2 text-xs text-slate-700 disabled:opacity-60">{busy===o.id?"Checking…":"Check now"}</button>}</td>
        </tr>)}</tbody>
      </table><Pager of={openPage}/></div>}

      {rec&&(rec.days.length?<div className="table-wrap"><table className="w-full min-w-[820px] text-left">
        <thead><tr><th>Day</th><th>Provider</th><th className="text-right">Requests</th><th className="text-right">Confirmed</th><th className="text-right">Received</th><th className="text-right">Declined</th><th className="text-right">Waiting</th><th className="text-right">Exceptions</th></tr></thead>
        <tbody>{daysPage.paged.map(d=><tr key={`${d.day}-${d.provider}`}>
          <td>{day(d.day)}</td><td>{NAME[d.provider]}</td><td className="text-right tabular-nums">{d.requests}</td><td className="text-right tabular-nums">{d.confirmed}</td>
          <td className="text-right tabular-nums">{ugx(d.confirmed_ugx)}</td><td className="text-right tabular-nums">{d.failed}</td><td className="text-right tabular-nums">{d.waiting}</td>
          <td className={`text-right tabular-nums ${d.exceptions?"font-semibold text-[var(--color-danger)]":""}`}>{d.exceptions}</td>
        </tr>)}</tbody>
      </table><Pager of={daysPage}/></div>:<EmptyState title="No mobile money payments in this period"/>)}
    </section>

    {connecting&&<ConnectDialog provider={connecting} callbackUrl={accounts?.callback_url??null} onClose={()=>setConnecting(null)} onDone={async message=>{setConnecting(null);setNotice(message);await loadAccounts()}}/>}
    <ResolveDialog payment={resolving} onClose={()=>setResolving(null)} onDone={async message=>{setResolving(null);setNotice(message);await loadRec()}}/>
  </div></AppShell>;
}

function ConnectDialog({provider,callbackUrl,onClose,onDone}:{provider:Provider;callbackUrl:string|null;onClose:()=>void;onDone:(message:string)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError("");
    const credentials=provider==="mtn_momo"?{apiUser:f.get("apiUser"),apiKey:f.get("apiKey"),subscriptionKey:f.get("subscriptionKey")}:{clientId:f.get("clientId"),clientSecret:f.get("clientSecret")};
    try{const r=await apiRequest<{message:string}>(`/api/waste/billing/mobile-money/accounts/${provider}`,{method:"PUT",body:JSON.stringify({environment:f.get("environment"),credentials})});onDone(r.message)}
    catch(err){setError(err instanceof Error?err.message:"Could not save the account")}finally{setBusy(false)}
  }
  return <Modal open title={`Connect ${NAME[provider]}`} description={provider==="mtn_momo"?"From your MTN MoMo developer or partner portal: the Collection product's subscription key, and the API user and key created for it. Money is paid into the MTN account those belong to.":"From the Airtel Money developer portal: your Collections app's client ID and secret. Money is paid into the Airtel merchant account the app belongs to."} onClose={onClose}>
    <form onSubmit={submit} className="grid gap-4 text-sm">
      {error&&<Feedback tone="error">{error}</Feedback>}
      <label className="font-medium text-slate-700">Environment<select name="environment" defaultValue="production" className={field}><option value="production">Live (real money)</option><option value="sandbox">Sandbox (testing)</option></select></label>
      {provider==="mtn_momo"?<>
        <label className="font-medium text-slate-700">API user<input name="apiUser" required autoComplete="off" spellCheck={false} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className={`${field} font-mono`}/></label>
        <label className="font-medium text-slate-700">API key<input name="apiKey" type="password" required autoComplete="new-password" className={field}/></label>
        <label className="font-medium text-slate-700">Collection subscription key<input name="subscriptionKey" type="password" required autoComplete="new-password" className={field}/></label>
      </>:<>
        <label className="font-medium text-slate-700">Client ID<input name="clientId" required autoComplete="off" spellCheck={false} className={`${field} font-mono`}/></label>
        <label className="font-medium text-slate-700">Client secret<input name="clientSecret" type="password" required autoComplete="new-password" className={field}/></label>
        <p className="text-xs leading-5 text-slate-500">{callbackUrl?<>Set the app&rsquo;s callback URL in the Airtel portal to <span className="font-mono text-slate-700">{callbackUrl}</span>. Payments are also confirmed without it.</>:"Payments are confirmed by checking with Airtel; a callback URL is optional."}</p>
      </>}
      <p className="text-xs text-slate-500">Stored encrypted and checked on save.</p>
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="border border-slate-300 px-4 py-2 text-slate-700">Cancel</button><button disabled={busy} className="bg-[var(--color-action)] px-4 py-2 font-semibold text-white disabled:opacity-60">{busy?"Checking with the provider…":"Save and check"}</button></div>
    </form>
  </Modal>;
}

function ResolveDialog({payment,onClose,onDone}:{payment:Open|null;onClose:()=>void;onDone:(message:string)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!payment)return;const f=new FormData(e.currentTarget);setBusy(true);setError("");
    try{await apiRequest(`/api/waste/billing/payments/${payment.id}/review`,{method:"POST",body:JSON.stringify({resolution:f.get("resolution"),note:f.get("note")})});onDone("Payment settled.")}
    catch(err){setError(err instanceof Error?err.message:"Could not settle the payment")}finally{setBusy(false)}
  }
  return <Modal open={Boolean(payment)} title="Settle a payment" description={payment?.review_reason||undefined} onClose={onClose}>
    <form key={payment?.id} onSubmit={submit} className="grid gap-4 text-sm">
      {error&&<Feedback tone="error">{error}</Feedback>}
      {payment&&<p className="text-slate-600">{payment.customer_name} · {payment.invoice_number} · {ugx(payment.amount_ugx)} · {NAME[payment.provider]} {payment.provider_reference||payment.provider_request_id}</p>}
      <label className="font-medium text-slate-700">What did you do?<select name="resolution" className={field}>
        <option value="refunded">Refunded the payer</option>
        <option value="applied_by_hand">Recorded it by hand on Income &amp; billing</option>
        <option value="not_received">Checked the statement: no money arrived</option>
      </select></label>
      <label className="font-medium text-slate-700">Note<textarea name="note" required minLength={3} maxLength={500} rows={3} placeholder="Reference from the MTN or Airtel statement, who handled it" className={field}/></label>
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="border border-slate-300 px-4 py-2 text-slate-700">Cancel</button><button disabled={busy} className="bg-[var(--color-action)] px-4 py-2 font-semibold text-white disabled:opacity-60">{busy?"Saving…":"Settle"}</button></div>
    </form>
  </Modal>;
}
