"use client";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {Pagination} from "@/components/ui/Pagination";
import {apiRequest,openAuthenticatedFile} from "@/lib/api";
import {day,useServerList} from "@/lib/factory";
import {useHasRole} from "@/lib/session";
import {ChainCheck,Receipt,ReceiptExport,ReceiptSummary,dateTime,kg,smsState} from "@/lib/receipts";

type View="receipts"|"exports";
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";

export default function ReceiptsPage(){
  const isAdmin=useHasRole("company_admin");
  const [view,setView]=useState<View>("receipts"),[summary,setSummary]=useState<ReceiptSummary|null>(null);
  const [filters,setFilters]=useState({from:"",to:"",search:"",status:""}),[draft,setDraft]=useState(filters);
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[voiding,setVoiding]=useState<Receipt|null>(null);
  const [chain,setChain]=useState<ChainCheck|null>(null),[checking,setChecking]=useState(false);

  const query=new URLSearchParams(Object.entries(filters).filter(([,v])=>v)).toString();
  const receipts=useServerList<Receipt>(`/api/waste/receipts${query?`?${query}`:""}`);
  const exports=useServerList<ReceiptExport>("/api/waste/receipts/exports");
  const loadSummary=useCallback(async()=>{
    try{setSummary((await apiRequest<{data:ReceiptSummary}>("/api/waste/receipts/summary")).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load receipts")}
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void loadSummary(),0);return()=>window.clearTimeout(timer)},[loadSummary]);

  async function checkChain(){
    setChecking(true);setError("");
    try{setChain((await apiRequest<{data:ChainCheck}>("/api/waste/receipts/chain-check")).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not check the receipt ledger")}finally{setChecking(false)}
  }
  async function download(e:ReceiptExport,part:"file"|"signature"){
    try{await openAuthenticatedFile(`/api/waste/receipts/exports/${e.id}/download${part==="signature"?"?part=signature":""}`,{download:`receipts-${e.export_date}${part==="signature"?".sig":""}.json`})}
    catch(err){setError(err instanceof Error?err.message:"Could not download the export")}
  }
  async function voided(message:string){setVoiding(null);setNotice(message);await Promise.all([receipts.reload(),loadSummary()]);}
  const s=summary;

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow="KCCA regulation" title="Collection receipts" description="A numbered SMS receipt for every collection. Void with a reason; never edit."/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}

    {s&&<div className="grid grid-cols-2 rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-5">
      {([["Issued today",s.today,s.series?`Code ${s.series.code}`:"No receipts yet"],["This month",s.this_month,`${s.voided_this_month} voided`],
        ["No phone number",s.without_phone_30d,"last 30 days, receipt on /my only"],["SMS failed",s.sms_failed_30d,"last 30 days"],
        ["Last KCCA export",s.last_export?day(s.last_export.export_date):"—",s.last_export?`filed ${dateTime(s.last_export.generated_at)}`:"after the first full day"]] as const).map(([label,value,hint],i)=>
        <div key={label} className={`px-4 py-3 ${i?"border-l border-slate-200":""}`}><p className="text-xs font-medium text-slate-500">{label}</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${label==="SMS failed"&&Number(value)>0?"text-[var(--color-danger)]":"text-slate-900"}`}>{value}</p><p className="text-xs text-slate-500">{hint}</p></div>)}
    </div>}

    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="radiogroup" aria-label="Show" className="inline-flex overflow-hidden rounded-[var(--ui-radius)] border border-slate-300 bg-white text-sm">
        {([["receipts","Receipts"],["exports","Daily KCCA exports"]] as const).map(([value,label],i)=><button key={value} role="radio" aria-checked={view===value} onClick={()=>setView(value)} className={`min-h-0 rounded-none px-3 py-1.5 ${i?"border-l border-slate-300":""} ${view===value?"bg-slate-900 text-white":"text-slate-700 hover:bg-slate-50"}`}>{label}</button>)}
      </div>
      <div className="flex items-center gap-3 text-sm">
        {chain&&<span className={chain.intact?"text-slate-600":"font-medium text-[var(--color-danger)]"}>{chain.intact?`Ledger intact: ${chain.checked.toLocaleString("en-GB")} receipts checked`:`Ledger altered at ${chain.first_broken_serial}. Report this to KCCA.`}</span>}
        <button onClick={()=>void checkChain()} disabled={checking} className="border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 disabled:opacity-60">{checking?"Checking…":"Check ledger"}</button>
      </div>
    </div>

    {view==="receipts"?<section>
      <form onSubmit={e=>{e.preventDefault();setFilters(draft);receipts.setPage(1)}} className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        <label className="text-xs font-medium text-slate-600">Search<input value={draft.search} onChange={e=>setDraft({...draft,search:e.target.value})} placeholder="Receipt, household, phone" className="mt-1 block w-60 border border-slate-300 px-3 py-2"/></label>
        <label className="text-xs font-medium text-slate-600">From<input type="date" value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})} className="mt-1 block border border-slate-300 px-3 py-2"/></label>
        <label className="text-xs font-medium text-slate-600">To<input type="date" value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})} className="mt-1 block border border-slate-300 px-3 py-2"/></label>
        <label className="text-xs font-medium text-slate-600">Status<select value={draft.status} onChange={e=>setDraft({...draft,status:e.target.value})} className="mt-1 block border border-slate-300 bg-white px-3 py-2"><option value="">All</option><option value="valid">Valid</option><option value="voided">Voided</option></select></label>
        <button className="bg-slate-900 px-4 py-2 text-white">Show</button>
      </form>
      {receipts.error&&<Feedback tone="error">{receipts.error}</Feedback>}
      {receipts.rows.length?<div className="table-wrap"><table className="w-full min-w-[960px] text-left">
        <thead><tr><th>Receipt</th><th>Collected</th><th>Household</th><th className="text-right">Weight</th><th>Delivery</th><th/></tr></thead>
        <tbody>{receipts.rows.map(r=>{const sms=smsState(r);return <tr key={r.id}>
          <td><a href={`/r/${r.serial_number}`} target="_blank" rel="noreferrer" className="table-primary font-mono hover:underline">{r.serial_number}</a>
            {r.voided_at?<p className="table-secondary text-[var(--color-danger)]">Voided by {r.voided_by_name}: {r.void_reason}</p>:<p className="table-secondary">{r.truck_plate||"No vehicle"}{r.driver_name?` · ${r.driver_name}`:""}</p>}</td>
          <td>{dateTime(r.collected_at)}<p className="table-secondary">{r.zone_name||""}</p></td>
          <td><p className="table-primary">{r.customer_name}</p><p className="table-secondary">{r.location_label} · {r.address}</p></td>
          <td className="text-right tabular-nums">{kg(r.collected_weight_kg)}</td>
          <td><span className={sms.className} title={r.sms_error||undefined}>{sms.label}</span>{r.customer_phone&&<p className="table-secondary">{r.customer_phone}</p>}</td>
          <td className="text-right">{isAdmin&&!r.voided_at&&<button onClick={()=>setVoiding(r)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Void</button>}</td>
        </tr>})}</tbody>
      </table></div>:!receipts.loading&&<EmptyState title={query?"No receipts match":"No receipts yet"} description={query?undefined:"Receipts appear here as drivers complete household collections."}/>}
      <Pagination page={receipts.page} pageSize={receipts.pageSize} total={receipts.total} totalPages={receipts.totalPages} onPage={receipts.setPage} onPageSize={receipts.setPageSize}/>
    </section>:<section>
      <p className="mb-3 text-sm text-slate-600">One signed file per day, shared with KCCA.</p>
      {exports.error&&<Feedback tone="error">{exports.error}</Feedback>}
      {exports.rows.length?<div className="table-wrap"><table className="w-full min-w-[820px] text-left">
        <thead><tr><th>Day</th><th className="text-right">Receipts</th><th className="text-right">Voids</th><th>Serials</th><th>Filed</th><th/></tr></thead>
        <tbody>{exports.rows.map(e=><tr key={e.id}>
          <td className="table-primary">{day(e.export_date)}</td>
          <td className="text-right tabular-nums">{e.receipt_count}</td>
          <td className="text-right tabular-nums">{e.void_count}</td>
          <td className="font-mono text-xs">{e.first_serial?`${e.first_serial} – ${e.last_serial}`:"None issued"}</td>
          <td>{dateTime(e.generated_at)}</td>
          <td className="whitespace-nowrap text-right"><button onClick={()=>void download(e,"file")} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Download</button> <button onClick={()=>void download(e,"signature")} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Signature</button></td>
        </tr>)}</tbody>
      </table></div>:!exports.loading&&<EmptyState title="No exports yet" description="First file is made after midnight."/>}
      <Pagination page={exports.page} pageSize={exports.pageSize} total={exports.total} totalPages={exports.totalPages} onPage={exports.setPage} onPageSize={exports.setPageSize}/>
    </section>}

    <VoidDialog receipt={voiding} onClose={()=>setVoiding(null)} onDone={voided}/>
  </div></AppShell>;
}

function VoidDialog({receipt,onClose,onDone}:{receipt:Receipt|null;onClose:()=>void;onDone:(message:string)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!receipt)return;setBusy(true);setError("");
    try{await apiRequest(`/api/waste/receipts/${receipt.id}/void`,{method:"POST",body:JSON.stringify({reason:new FormData(e.currentTarget).get("reason")})});onDone(`Receipt ${receipt.serial_number} voided.`)}
    catch(err){setError(err instanceof Error?err.message:"Could not void the receipt")}finally{setBusy(false)}
  }
  return <Modal open={Boolean(receipt)} title={`Void ${receipt?.serial_number||"receipt"}`} description="Stays on record as void. Can’t be undone." onClose={onClose}>
    <form onSubmit={submit} className="grid gap-4 text-sm">
      {error&&<Feedback tone="error">{error}</Feedback>}
      {receipt&&<p className="text-slate-600">{receipt.customer_name} · {receipt.location_label} · {dateTime(receipt.collected_at)}</p>}
      <label className="font-medium text-slate-700">Reason<textarea name="reason" required minLength={5} maxLength={500} rows={3} placeholder="For example: driver completed the wrong household" className={field}/></label>
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="border border-slate-300 px-4 py-2 text-slate-700">Cancel</button><button disabled={busy} className="bg-[var(--color-danger)] px-4 py-2 font-semibold text-white disabled:opacity-60">{busy?"Voiding…":"Void receipt"}</button></div>
    </form>
  </Modal>;
}
