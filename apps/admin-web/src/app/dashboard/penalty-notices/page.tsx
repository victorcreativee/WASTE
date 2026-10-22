"use client";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,PageHeader} from "@/components/ui/System";
import {Pagination} from "@/components/ui/Pagination";
import {NoticePanel} from "@/components/penalties/NoticePanel";
import {apiRequest} from "@/lib/api";
import {useServerList} from "@/lib/factory";
import {Notice,NoticeDetail,STATUS,day,todayIso,ugx} from "@/lib/penalties";

type Summary={open:number;outstanding_ugx:number;overdue:number;appeals:number;paid_last_year:number;rules:{daysToPay:number;appealDays:number;escalateAfterDays:number}};
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";

export default function PenaltyNoticesPage(){
  const [summary,setSummary]=useState<Summary|null>(null),[notice,setNotice]=useState<NoticeDetail|null>(null),[error,setError]=useState(""),[message,setMessage]=useState("");
  const list=useServerList<Notice>("/api/waste/penalties/notices");
  const load=useCallback(async()=>{try{setSummary((await apiRequest<{data:Summary}>("/api/waste/penalties/company/summary")).data)}catch(e){setError(e instanceof Error?e.message:"Could not load penalty notices")}},[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  async function open(id:string){try{setNotice((await apiRequest<{data:NoticeDetail}>(`/api/waste/penalties/notices/${id}`)).data)}catch(e){setError(e instanceof Error?e.message:"Could not open the notice")}}
  async function done(text:string){setMessage(text);setError("");await Promise.all([load(),list.reload()]);if(notice)await open(notice.id);}
  const s=summary;

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow="KCCA regulation" title="Penalty notices" description={`Penalties KCCA has issued to your company. Pay within ${s?.rules.daysToPay??30} days and send KCCA the payment reference, or appeal within ${s?.rules.appealDays??14} days. Unpaid penalties can lead to suspension of your permit.`}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{message&&<Feedback tone="success">{message}</Feedback>}
    {s&&s.overdue>0&&<Feedback tone="warning">{s.overdue} penalty notice{s.overdue===1?" is":"s are"} overdue. KCCA can suspend your permit {s.rules.escalateAfterDays} days after the due date.</Feedback>}
    {s&&<div className="grid grid-cols-2 border border-slate-200 bg-white sm:grid-cols-4 rounded-[var(--ui-radius-lg)]">
      {([["Outstanding",ugx(s.outstanding_ugx),`${s.open} open notices`],["Overdue",s.overdue,"past the due date"],["Under appeal",s.appeals,"waiting for KCCA"],["Paid in the last year",ugx(s.paid_last_year),"confirmed by KCCA"]] as const).map(([label,value,hint],i)=>
        <div key={label} className={`px-4 py-3 ${i?"border-l border-slate-200":""}`}><p className="text-xs font-medium text-slate-500">{label}</p><p className={`mt-1 text-lg font-semibold tabular-nums ${label==="Overdue"&&s.overdue?"text-[var(--color-danger)]":"text-slate-900"}`}>{value}</p><p className="text-xs text-slate-500">{hint}</p></div>)}
    </div>}

    {list.error&&<Feedback tone="error">{list.error}</Feedback>}
    {list.rows.length?<div className="table-wrap"><table className="w-full min-w-[820px] text-left">
      <thead><tr><th>Notice</th><th>Offence</th><th className="text-right">Amount</th><th>Status</th><th>Due</th><th/></tr></thead>
      <tbody>{list.rows.map(n=><tr key={n.id}>
        <td className="table-primary">{n.notice_number}<p className="table-secondary">Issued {day(n.issued_at)}</p></td>
        <td>{n.offence}</td>
        <td className="text-right tabular-nums">{ugx(n.amount_ugx)}</td>
        <td><span className={STATUS[n.status].className}>{STATUS[n.status].label}</span></td>
        <td className={n.overdue?"font-medium text-[var(--color-danger)]":""}>{day(n.due_on)}</td>
        <td className="text-right"><button onClick={()=>void open(n.id)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">{n.status==="issued"?"Pay or appeal":"Open"}</button></td>
      </tr>)}</tbody>
    </table></div>:!list.loading&&<EmptyState title="No penalty notices" description="KCCA has not issued any penalties to your company."/>}
    <Pagination page={list.page} pageSize={list.pageSize} total={list.total} totalPages={list.totalPages} onPage={list.setPage} onPageSize={list.setPageSize}/>

    {notice&&<NoticePanel notice={notice} onClose={()=>setNotice(null)} actions={notice.status==="issued"?<CompanyActions notice={notice} onDone={done} onError={setError}/>:notice.status==="appealed"?<p className="border-y border-slate-100 py-4 text-slate-600">Your appeal is with KCCA. You do not need to pay until KCCA decides it.</p>:null}/>}
  </div></AppShell>;
}

function CompanyActions({notice,onDone,onError}:{notice:NoticeDetail;onDone:(message:string)=>Promise<void>;onError:(message:string)=>void}){
  const [mode,setMode]=useState<null|"pay"|"appeal">(null),[busy,setBusy]=useState(false);
  async function send(path:string,body:unknown,text:string){
    setBusy(true);
    try{await apiRequest(`/api/waste/penalties/notices/${notice.id}/${path}`,{method:"POST",body:JSON.stringify(body)});setMode(null);await onDone(text)}
    catch(e){onError(e instanceof Error?e.message:"Could not send")}finally{setBusy(false)}
  }
  return <div className="space-y-3 border-y border-slate-100 py-4">
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={()=>setMode(mode==="pay"?null:"pay")} className="bg-[var(--color-action)] px-3 py-2 text-xs font-semibold text-white">I have paid</button>
      {notice.can.appeal&&<button type="button" onClick={()=>setMode(mode==="appeal"?null:"appeal")} className="border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Appeal</button>}
    </div>
    {!notice.can.appeal&&!notice.appealed_before&&<p className="text-xs text-slate-500">The appeal period ended on {day(notice.appeal_deadline)}.</p>}
    {mode==="pay"&&<form className="grid gap-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void send("payment",{reference:f.get("reference"),paidOn:f.get("paidOn")},"Payment sent to KCCA for confirmation")}}>
      <p className="text-slate-600">Pay {ugx(notice.amount_ugx)} through KCCA&rsquo;s revenue channels quoting {notice.notice_number}, then enter the payment reference (PRN or receipt number). KCCA confirms it against its records.</p>
      <div className="grid gap-3 sm:grid-cols-2"><label className="font-medium text-slate-700">Payment reference<input name="reference" required minLength={4} maxLength={100} className={field}/></label><label className="font-medium text-slate-700">Paid on<input name="paidOn" type="date" required max={todayIso()} defaultValue={todayIso()} className={field}/></label></div>
      <div className="flex justify-end gap-2"><button type="button" onClick={()=>setMode(null)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Cancel</button><button disabled={busy} className="bg-[var(--color-action)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy?"Sending…":"Send to KCCA"}</button></div>
    </form>}
    {mode==="appeal"&&<form className="grid gap-3" onSubmit={e=>{e.preventDefault();void send("appeal",{grounds:new FormData(e.currentTarget).get("grounds")},"Appeal sent to KCCA")}}>
      <p className="text-slate-600">You can appeal once, by {day(notice.appeal_deadline)}. Payment is paused until KCCA decides.</p>
      <label className="font-medium text-slate-700">Grounds of appeal<textarea name="grounds" required minLength={20} rows={4} placeholder="Why the penalty should be withdrawn or reduced, and what evidence you can provide." className={field}/></label>
      <div className="flex justify-end gap-2"><button type="button" onClick={()=>setMode(null)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Cancel</button><button disabled={busy} className="bg-[var(--color-action)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy?"Sending…":"Send appeal"}</button></div>
    </form>}
  </div>;
}
