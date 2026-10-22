"use client";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,PageHeader} from "@/components/ui/System";
import {Pagination} from "@/components/ui/Pagination";
import {IssuePenaltyDialog,type PenaltyDraft} from "@/components/penalties/IssuePenaltyDialog";
import {NoticePanel} from "@/components/penalties/NoticePanel";
import {apiRequest} from "@/lib/api";
import {useHasRole} from "@/lib/session";
import {useServerList} from "@/lib/factory";
import {PERIODS} from "@/lib/disposal";
import {Notice,NoticeDetail,STATUS,ScheduleItem,day,todayIso,ugx} from "@/lib/penalties";

type Overview={period:{label:string};rules:{daysToPay:number;appealDays:number;escalateAfterDays:number;repeatWindowDays:number};
  totals:{issued:number;issued_ugx:number;collected_ugx:number;open:number;outstanding_ugx:number;overdue:number;overdue_ugx:number;appeals:number;payments_to_confirm:number;can_escalate:number;withdrawn:number};
  schedule:Array<{code:string;title:string;notices:number;issued_ugx:number;collected_ugx:number}>;
  companies:Array<{id:string;name:string;open:number;outstanding_ugx:number;overdue:number;last_year:number}>};
const FILTERS:Array<[string,string]>=[["open","Open"],["appealed","Appeals"],["payment_submitted","Payments to confirm"],["overdue","Overdue"],["escalate","Can escalate"],["paid","Paid"],["waived","Withdrawn"]];
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";

export default function PenaltiesPage(){
  const [period,setPeriod]=useState("30d"),[data,setData]=useState<Overview|null>(null),[filter,setFilter]=useState("open");
  const [notice,setNotice]=useState<NoticeDetail|null>(null),[draft,setDraft]=useState<PenaltyDraft|null>(null),[editing,setEditing]=useState(false),[schedule,setSchedule]=useState<ScheduleItem[]>([]);
  const [error,setError]=useState(""),[message,setMessage]=useState("");
  const canAct=useHasRole("kcca_admin");
  const list=useServerList<Notice>(`/api/waste/penalties/notices?status=${filter}`);
  const load=useCallback(async()=>{
    try{
      const [o,s]=await Promise.all([apiRequest<{data:Overview}>(`/api/waste/penalties/overview?period=${period}`),apiRequest<{data:ScheduleItem[]}>("/api/waste/penalties/schedule?all=1")]);
      setData(o.data);setSchedule(s.data);
    }catch(e){setError(e instanceof Error?e.message:"Could not load penalties")}
  },[period]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  async function open(id:string){try{setNotice((await apiRequest<{data:NoticeDetail}>(`/api/waste/penalties/notices/${id}`)).data)}catch(e){setError(e instanceof Error?e.message:"Could not open the notice")}}
  async function refresh(text:string){setMessage(text);setError("");await Promise.all([load(),list.reload()]);if(notice)await open(notice.id);}
  const t=data?.totals;

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow="Regulation" title="Penalties" description={`Penalty notices to licensed companies under the published schedule. Companies pay within ${data?.rules.daysToPay??30} days or appeal within ${data?.rules.appealDays??14}; a fine left unpaid ${data?.rules.escalateAfterDays??30} days after its due date can lead to suspension of the permit.`}
      action={<div className="flex gap-2"><select aria-label="Period" value={period} onChange={e=>setPeriod(e.target.value)} className="border border-slate-300 bg-white px-3 py-2 text-sm">{PERIODS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>{canAct&&<button onClick={()=>setDraft({})} className="bg-[var(--color-action)] px-3 py-2 text-sm font-semibold text-white">Issue notice</button>}</div>}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{message&&<Feedback tone="success">{message}</Feedback>}

    {t&&<div className="grid grid-cols-2 border border-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-6 rounded-[var(--ui-radius-lg)]">
      {([["Issued this period",ugx(t.issued_ugx),`${t.issued} notices · ${t.withdrawn} withdrawn`],["Collected this period",ugx(t.collected_ugx),"confirmed payments"],["Outstanding",ugx(t.outstanding_ugx),`${t.open} open notices`],["Overdue",ugx(t.overdue_ugx),`${t.overdue} notices`],["To decide",t.appeals+t.payments_to_confirm,`${t.appeals} appeals · ${t.payments_to_confirm} payments`],["Can escalate",t.can_escalate,"unpaid well past due"]] as const).map(([label,value,hint],i)=>
        <div key={label} className={`px-4 py-3 ${i?"border-l border-slate-200":""}`}><p className="text-xs font-medium text-slate-500">{label}</p><p className={`mt-1 text-lg font-semibold tabular-nums ${(label==="Overdue"&&t.overdue)||(label==="Can escalate"&&t.can_escalate)?"text-[var(--color-danger)]":"text-slate-900"}`}>{value}</p><p className="text-xs text-slate-500">{hint}</p></div>)}
    </div>}

    <section className="space-y-3">
      <div role="radiogroup" aria-label="Show" className="inline-flex flex-wrap overflow-hidden rounded-[var(--ui-radius)] border border-slate-300 bg-white text-sm">
        {FILTERS.map(([value,label],i)=><button key={value} role="radio" aria-checked={filter===value} onClick={()=>{setFilter(value);list.setPage(1)}} className={`min-h-0 rounded-none px-3 py-1.5 ${i?"border-l border-slate-300":""} ${filter===value?"bg-slate-900 text-white":"text-slate-700 hover:bg-slate-50"}`}>{label}</button>)}
      </div>
      {list.error&&<Feedback tone="error">{list.error}</Feedback>}
      {list.rows.length?<div className="table-wrap"><table className="w-full min-w-[960px] text-left">
        <thead><tr><th>Notice</th><th>Company</th><th>Offence</th><th className="text-right">Amount</th><th>Status</th><th>Due</th><th/></tr></thead>
        <tbody>{list.rows.map(n=><tr key={n.id}>
          <td className="table-primary">{n.notice_number}</td>
          <td>{n.organization_name}</td>
          <td><p>{n.offence}</p>{n.offence_number>1&&<p className="table-secondary">Repeat offence {n.offence_number}</p>}</td>
          <td className="text-right tabular-nums">{ugx(n.amount_ugx)}</td>
          <td><span className={STATUS[n.status].className}>{STATUS[n.status].label}</span>{n.escalated_at&&<p className="table-secondary text-[var(--color-danger)]">Permit suspended</p>}</td>
          <td className={n.overdue?"font-medium text-[var(--color-danger)]":""}>{day(n.due_on)}</td>
          <td className="text-right"><button onClick={()=>void open(n.id)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">{canAct&&["appealed","payment_submitted"].includes(n.status)?"Decide":"Open"}</button></td>
        </tr>)}</tbody>
      </table></div>:!list.loading&&<EmptyState title="No notices in this view"/>}
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} totalPages={list.totalPages} onPage={list.setPage} onPageSize={list.setPageSize}/>
    </section>

    {data&&<div className="grid gap-6 lg:grid-cols-2">
      <section><div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Penalty schedule</h2>{canAct&&<button onClick={()=>setEditing(!editing)} className="min-h-0 p-0 text-sm font-medium text-[var(--color-action)] hover:underline">{editing?"Done":"Change amounts"}</button>}</div>
        <div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Offence</th><th className="text-right">First</th><th className="text-right">Repeat</th><th className="text-right">Notices</th></tr></thead>
          <tbody>{schedule.map(item=>{const stats=data.schedule.find(s=>s.code===item.code);return editing?<ScheduleRow key={item.code} item={item} onSaved={text=>void refresh(text)} onError={setError}/>
            :<tr key={item.code} className={item.is_active?"":"text-slate-400"}><td><p className="table-primary">{item.title}</p>{!item.is_active&&<p className="table-secondary">Not in use</p>}</td><td className="text-right tabular-nums">{ugx(item.amount_ugx)}</td><td className="text-right tabular-nums">{ugx(item.repeat_amount_ugx)}</td><td className="text-right tabular-nums">{stats?.notices??0}</td></tr>})}</tbody></table></div>
        <p className="mt-2 text-xs text-slate-500">Amounts are placeholders until KCCA confirms its schedule. A repeat offence is the same offence within {data.rules.repeatWindowDays} days.</p></section>
      <section><h2 className="mb-2 font-semibold">Companies with open notices</h2>
        {data.companies.length?<div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Company</th><th className="text-right">Open</th><th className="text-right">Outstanding</th></tr></thead>
          <tbody>{data.companies.map(c=><tr key={c.id}><td><p className="table-primary">{c.name}</p><p className="table-secondary">{c.last_year} notice{c.last_year===1?"":"s"} in the last year</p></td><td className="text-right tabular-nums">{c.open}{c.overdue?<span className="text-[var(--color-danger)]"> ({c.overdue} overdue)</span>:null}</td><td className="text-right tabular-nums">{ugx(c.outstanding_ugx)}</td></tr>)}</tbody></table></div>
          :<EmptyState title="No outstanding penalties"/>}</section>
    </div>}

    {notice&&<NoticePanel notice={notice} onClose={()=>setNotice(null)} actions={canAct?<KccaActions notice={notice} onDone={refresh} onError={setError}/>:null}/>}
    <IssuePenaltyDialog draft={draft} onClose={()=>setDraft(null)} onIssued={text=>{setDraft(null);void refresh(text)}}/>
  </div></AppShell>;
}

function ScheduleRow({item,onSaved,onError}:{item:ScheduleItem;onSaved:(message:string)=>void;onError:(message:string)=>void}){
  const [busy,setBusy]=useState(false);
  async function save(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);
    try{await apiRequest(`/api/waste/penalties/schedule/${item.code}`,{method:"PUT",body:JSON.stringify({amountUgx:Number(f.get("amount")),repeatAmountUgx:Number(f.get("repeat")),isActive:f.get("active")==="on"})});onSaved(`${item.title}: amounts saved.`)}
    catch(err){onError(err instanceof Error?err.message:"Could not save")}finally{setBusy(false)}
  }
  return <tr><td colSpan={4}><form onSubmit={save} className="flex flex-wrap items-end gap-3"><p className="w-full font-medium text-slate-900 sm:w-auto sm:flex-1">{item.title}</p>
    <label className="text-xs text-slate-500">First<input name="amount" type="number" min={1} step={1000} defaultValue={item.amount_ugx} className="mt-1 block w-32 border border-slate-300 px-2 py-1.5 text-sm"/></label>
    <label className="text-xs text-slate-500">Repeat<input name="repeat" type="number" min={1} step={1000} defaultValue={item.repeat_amount_ugx} className="mt-1 block w-32 border border-slate-300 px-2 py-1.5 text-sm"/></label>
    <label className="flex items-center gap-1 text-xs text-slate-600"><input name="active" type="checkbox" defaultChecked={item.is_active} className="h-4 w-4"/>In use</label>
    <button disabled={busy} className="bg-[var(--color-action)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save</button></form></td></tr>;
}

type Mode=null|"decide"|"confirm"|"reject"|"withdraw"|"escalate";

function KccaActions({notice,onDone,onError}:{notice:NoticeDetail;onDone:(message:string)=>Promise<void>;onError:(message:string)=>void}){
  const [mode,setMode]=useState<Mode>(null),[decision,setDecision]=useState("upheld"),[busy,setBusy]=useState(false);
  async function send(path:string,body:unknown,text:string){
    setBusy(true);
    try{await apiRequest(`/api/waste/penalties/notices/${notice.id}/${path}`,{method:"PATCH",body:JSON.stringify(body)});setMode(null);await onDone(text)}
    catch(e){onError(e instanceof Error?e.message:"Could not save")}finally{setBusy(false)}
  }
  const v=(f:FormData,n:string)=>{const x=f.get(n);return x===null||x===""?undefined:String(x)};
  const button=(m:Mode,label:string,primary=false)=><button type="button" onClick={()=>setMode(mode===m?null:m)} className={`px-3 py-2 text-xs font-semibold ${primary?"bg-[var(--color-action)] text-white":"border border-slate-300 text-slate-700"}`}>{label}</button>;
  const submit=(label:string,danger=false)=><div className="flex justify-end gap-2"><button type="button" onClick={()=>setMode(null)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Cancel</button><button disabled={busy} className={`px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 ${danger?"bg-[var(--color-danger)]":"bg-[var(--color-action)]"}`}>{busy?"Saving…":label}</button></div>;
  if(["paid","waived"].includes(notice.status)&&!notice.can.escalate)return null;

  return <div className="space-y-3 border-y border-slate-100 py-4">
    <div className="flex flex-wrap gap-2">
      {notice.status==="appealed"&&button("decide","Decide appeal",true)}
      {notice.status==="payment_submitted"&&<>{button("confirm","Confirm payment",true)}{button("reject","Payment not found")}</>}
      {notice.status==="issued"&&<>{button("confirm","Record payment")}{button("withdraw","Withdraw")}</>}
      {notice.can.escalate&&button("escalate","Suspend permit")}
    </div>
    {notice.status==="issued"&&!notice.can.escalate&&notice.overdue&&notice.can.escalate_reason&&<p className="text-xs text-slate-500">{notice.can.escalate_reason}.</p>}

    {mode==="decide"&&<form className="grid gap-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void send("decide-appeal",{decision,newAmount:decision==="reduced"?Number(v(f,"amount")):undefined,note:v(f,"note")},"Appeal decided")}}>
      <fieldset className="flex flex-wrap gap-4">{([["upheld","Not allowed: the penalty stands"],["reduced","Partly allowed: reduce it"],["withdrawn","Allowed: withdraw it"]] as const).map(([value,label])=><label key={value} className="flex items-center gap-2"><input type="radio" name="decision" checked={decision===value} onChange={()=>setDecision(value)}/>{label}</label>)}</fieldset>
      {decision==="reduced"&&<label className="font-medium text-slate-700">New amount (UGX)<input name="amount" type="number" required min={1} max={notice.amount_ugx-1} step={1000} className={field}/></label>}
      <label className="font-medium text-slate-700">Reasons (shown to the company)<textarea name="note" required minLength={10} rows={3} className={field}/></label>{submit("Record decision")}
    </form>}
    {mode==="confirm"&&<form className="grid gap-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void send("confirm-payment",notice.status==="issued"?{reference:v(f,"reference"),paidOn:v(f,"paidOn")}:{},"Payment confirmed")}}>
      {notice.status==="payment_submitted"?<p className="text-slate-600">The company reports reference <span className="font-medium text-slate-900">{notice.payment_reference}</span>, paid {day(notice.paid_on)}. Confirm only once it shows in KCCA&rsquo;s revenue records.</p>
        :<div className="grid gap-3 sm:grid-cols-2"><label className="font-medium text-slate-700">Receipt or payment reference<input name="reference" required minLength={4} className={field}/></label><label className="font-medium text-slate-700">Paid on<input name="paidOn" type="date" required max={todayIso()} className={field}/></label></div>}
      {submit("Confirm payment")}
    </form>}
    {mode==="reject"&&<form className="grid gap-3" onSubmit={e=>{e.preventDefault();void send("reject-payment",{reason:v(new FormData(e.currentTarget),"reason")},"Payment rejected")}}>
      <label className="font-medium text-slate-700">What KCCA found<textarea name="reason" required minLength={10} rows={2} className={field}/></label>{submit("Reject payment",true)}
    </form>}
    {mode==="withdraw"&&<form className="grid gap-3" onSubmit={e=>{e.preventDefault();void send("withdraw",{reason:v(new FormData(e.currentTarget),"reason")},"Penalty withdrawn")}}>
      <label className="font-medium text-slate-700">Why the notice is withdrawn<textarea name="reason" required minLength={10} rows={2} className={field}/></label>{submit("Withdraw notice",true)}
    </form>}
    {mode==="escalate"&&<form className="grid gap-3" onSubmit={e=>{e.preventDefault();void send("escalate",{note:v(new FormData(e.currentTarget),"note")??""},"Permit suspended")}}>
      <p className="text-slate-600">This suspends {notice.organization_name}&rsquo;s KCCA permit through the permit process: their routes cannot be dispatched until KCCA reinstates it. They are told immediately.</p>
      <label className="font-medium text-slate-700">Note (optional)<textarea name="note" rows={2} className={field}/></label>{submit("Suspend permit",true)}
    </form>}
  </div>;
}
