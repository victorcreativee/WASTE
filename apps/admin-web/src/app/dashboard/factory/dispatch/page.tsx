"use client";
import {useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {Feedback,Modal,PageHeader} from "@/components/ui/System";
import {Pagination} from "@/components/ui/Pagination";
import {apiRequest} from "@/lib/api";
import {Batch,Dispatch,day,kg,todayIso,useServerList} from "@/lib/factory";

const field="mt-1 block w-full border border-slate-300 px-3 py-2 text-sm font-normal";

function DispatchForm({onDone}:{onDone:(message:string)=>void}){
  const [batches,setBatches]=useState<Batch[]>([]),[batchId,setBatchId]=useState(""),[problem,setProblem]=useState(""),[saving,setSaving]=useState(false);
  useEffect(()=>{apiRequest<{data:Batch[]}>("/api/waste/factory/batches?page=1&pageSize=500").then(r=>setBatches(r.data.filter(b=>Number(b.output_kg)-Number(b.dispatched_kg)>0))).catch(()=>setBatches([]))},[]);
  const batch=batches.find(b=>b.id===batchId),remaining=batch?Number(batch.output_kg)-Number(batch.dispatched_kg):null;

  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    const f=new FormData(e.currentTarget),text=(k:string)=>String(f.get(k)||"").trim()||undefined;
    setSaving(true);setProblem("");
    try{
      const r=await apiRequest<{message:string}>("/api/waste/factory/dispatches",{method:"POST",body:JSON.stringify({batchId:batchId||undefined,productName:f.get("productName"),quantityKg:Number(f.get("quantityKg")),buyerName:f.get("buyerName"),destination:text("destination"),dispatchedOn:f.get("dispatchedOn"),notes:text("notes")})});
      onDone(r.message);
    }catch(e){setProblem(e instanceof Error?e.message:"The dispatch could not be recorded")}finally{setSaving(false)}
  }

  return <form onSubmit={submit} className="grid gap-4 text-sm">
    {problem&&<Feedback tone="error">{problem}</Feedback>}
    <label className="font-medium text-slate-700">From batch <span className="font-normal text-slate-500">optional, keeps traceability</span>
      <select value={batchId} onChange={e=>setBatchId(e.target.value)} className={field}><option value="">Not linked to a batch</option>
        {batches.map(b=><option key={b.id} value={b.id}>{b.batch_number} · {b.product_name} · {kg(Number(b.output_kg)-Number(b.dispatched_kg))} left</option>)}</select></label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="font-medium text-slate-700">Product<input key={batchId} name="productName" required minLength={2} defaultValue={batch?.product_name||""} className={field}/></label>
      <label className="font-medium text-slate-700">Quantity (kg){remaining!==null&&<span className="font-normal text-slate-500"> · up to {kg(remaining)}</span>}<input name="quantityKg" type="number" min={0.01} max={remaining??undefined} step="any" required className={field}/></label>
      <label className="font-medium text-slate-700">Buyer<input name="buyerName" required minLength={2} className={field}/></label>
      <label className="font-medium text-slate-700">Dispatched on<input name="dispatchedOn" type="date" required max={todayIso()} defaultValue={todayIso()} className={field}/></label>
      <label className="font-medium text-slate-700">Destination <span className="font-normal text-slate-500">optional</span><input name="destination" className={field}/></label>
      <label className="font-medium text-slate-700">Notes <span className="font-normal text-slate-500">optional</span><input name="notes" className={field}/></label>
    </div>
    <button disabled={saving} className="justify-self-start bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">{saving?"Saving…":"Record dispatch"}</button>
  </form>;
}

export default function FactoryDispatchPage(){
  const list=useServerList<Dispatch>("/api/waste/factory/dispatches");
  const [creating,setCreating]=useState(false),[notice,setNotice]=useState("");
  return <AppShell><div className="mx-auto max-w-6xl space-y-6">
    <PageHeader eyebrow="Recycling factory" title="Product dispatch" description="Finished product leaving the factory, linked to the batch it came from where possible."
      action={<button onClick={()=>setCreating(true)} className="bg-[var(--color-action)] px-3 py-2 text-sm font-semibold text-white">Record dispatch</button>}/>
    {list.error&&<Feedback tone="error">{list.error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}
    <div className="table-wrap"><table className="w-full min-w-[760px] text-left">
      <thead><tr><th>Dispatch</th><th>Product</th><th className="text-right">Quantity</th><th>Buyer</th><th>Batch</th></tr></thead>
      <tbody>{list.rows.map(d=><tr key={d.id}>
        <td><p className="table-primary">{d.dispatch_number}</p><p className="table-secondary">{day(d.dispatched_on)} · {d.recorded_by_name}</p></td>
        <td>{d.product_name}</td><td className="text-right tabular-nums">{kg(d.quantity_kg)}</td>
        <td>{d.buyer_name}{d.destination&&<p className="table-secondary">{d.destination}</p>}</td>
        <td>{d.batch_number||<span className="text-slate-400">—</span>}</td>
      </tr>)}
      {!list.rows.length&&!list.loading&&<tr><td colSpan={5} className="p-8 text-center text-sm text-slate-500">No dispatches recorded yet.</td></tr>}</tbody>
    </table></div>
    <Pagination page={list.page} pageSize={list.pageSize} total={list.total} totalPages={list.totalPages} onPage={list.setPage} onPageSize={list.setPageSize}/>
    <Modal open={creating} onClose={()=>setCreating(false)} title="Record dispatch">
      {creating&&<DispatchForm onDone={message=>{setCreating(false);setNotice(message);void list.reload()}}/>}
    </Modal>
  </div></AppShell>;
}
