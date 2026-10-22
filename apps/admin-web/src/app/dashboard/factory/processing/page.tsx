"use client";
import {useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {Feedback,Modal,PageHeader} from "@/components/ui/System";
import {Pagination} from "@/components/ui/Pagination";
import {apiRequest} from "@/lib/api";
import {Batch,Intake,day,kg,materialLabel,todayIso,useServerList} from "@/lib/factory";

const field="mt-1 block w-full border border-slate-300 px-3 py-2 text-sm font-normal";

function BatchForm({onDone}:{onDone:(message:string)=>void}){
  const [stock,setStock]=useState<Intake[]|null>(null),[draws,setDraws]=useState<Record<string,string>>({}),[problem,setProblem]=useState(""),[saving,setSaving]=useState(false);
  const [output,setOutput]=useState(""),[residue,setResidue]=useState("0");
  useEffect(()=>{
    apiRequest<{data:Intake[]}>("/api/waste/factory/intakes?page=1&pageSize=500").then(r=>setStock(r.data.filter(i=>i.status==="received"&&Number(i.available_kg)>0))).catch(e=>{setStock([]);setProblem(e instanceof Error?e.message:"Could not load stock")});
  },[]);
  const input=Object.values(draws).reduce((total,value)=>total+(Number(value)||0),0);
  const yieldRate=input>0&&output?Math.round(Number(output)/input*1000)/10:null;

  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    const f=new FormData(e.currentTarget);
    setSaving(true);setProblem("");
    try{
      const r=await apiRequest<{message:string}>("/api/waste/factory/batches",{method:"POST",body:JSON.stringify({
        processedOn:f.get("processedOn"),productName:f.get("productName"),
        inputs:Object.entries(draws).filter(([,value])=>Number(value)>0).map(([intakeId,value])=>({intakeId,kg:Number(value)})),
        outputKg:Number(output||0),residueKg:Number(residue||0),residueDisposal:String(f.get("residueDisposal")||"").trim()||undefined,notes:String(f.get("notes")||"").trim()||undefined,
      })});
      onDone(r.message);
    }catch(e){setProblem(e instanceof Error?e.message:"The batch could not be recorded")}finally{setSaving(false)}
  }

  return <form onSubmit={submit} className="grid gap-4 text-sm">
    {problem&&<Feedback tone="error">{problem}</Feedback>}
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="font-medium text-slate-700">Product made<input name="productName" required minLength={2} placeholder="e.g. PET flakes, HDPE pellets" className={field}/></label>
      <label className="font-medium text-slate-700">Processed on<input name="processedOn" type="date" required max={todayIso()} defaultValue={todayIso()} className={field}/></label>
    </div>
    <fieldset><legend className="font-medium text-slate-700">Material used</legend>
      {stock===null?<p className="mt-2 text-slate-500">Loading stock…</p>:stock.length?<div className="table-wrap mt-2"><table className="w-full text-left"><thead><tr><th>Intake</th><th>Material</th><th className="text-right">Remaining</th><th className="w-32">Use (kg)</th></tr></thead><tbody>
        {stock.map(i=><tr key={i.id}><td><p className="table-primary">{i.intake_number}</p><p className="table-secondary">{i.supplier_name}</p></td><td>{i.material_description}<p className="table-secondary">{materialLabel(i.material_category)}</p></td><td className="text-right tabular-nums">{kg(i.available_kg)}</td>
          <td><input aria-label={`Kilograms from ${i.intake_number}`} type="number" min={0} max={Number(i.available_kg)} step="any" value={draws[i.id]||""} onChange={e=>setDraws(d=>({...d,[i.id]:e.target.value}))} className="w-full border border-slate-300 px-2 py-1.5 tabular-nums"/></td></tr>)}
      </tbody></table></div>:<p className="mt-2 text-slate-500">No material is waiting to be processed. Record an intake first.</p>}
    </fieldset>
    <div className="grid gap-4 sm:grid-cols-3">
      <div><p className="font-medium text-slate-700">Material in</p><p className="mt-2 text-lg font-semibold tabular-nums">{kg(input)}</p></div>
      <label className="font-medium text-slate-700">Product output (kg)<input type="number" min={0} step="any" required value={output} onChange={e=>setOutput(e.target.value)} className={field}/></label>
      <label className="font-medium text-slate-700">Residue (kg)<input type="number" min={0} step="any" value={residue} onChange={e=>setResidue(e.target.value)} className={field}/></label>
    </div>
    {yieldRate!==null&&<p className="text-slate-600">Yield {yieldRate}%{Number(output)+Number(residue)<input?` · ${kg(input-Number(output)-Number(residue))} unaccounted (moisture, losses)`:""}</p>}
    {Number(residue)>0&&<label className="font-medium text-slate-700">How the residue was disposed of<input name="residueDisposal" required placeholder="e.g. licensed hauler to Kiteezi" className={field}/></label>}
    <label className="font-medium text-slate-700">Notes <span className="font-normal text-slate-500">optional</span><input name="notes" className={field}/></label>
    <button disabled={saving||!input} className="justify-self-start bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">{saving?"Saving…":"Record batch"}</button>
  </form>;
}

export default function FactoryProcessingPage(){
  const list=useServerList<Batch>("/api/waste/factory/batches");
  const [creating,setCreating]=useState(false),[notice,setNotice]=useState("");

  return <AppShell><div className="mx-auto max-w-6xl space-y-6">
    <PageHeader eyebrow="Recycling factory" title="Processing" description="Each batch records which intakes it used, what it produced and the residue left for disposal."
      action={<button onClick={()=>setCreating(true)} className="bg-[var(--color-action)] px-3 py-2 text-sm font-semibold text-white">New batch</button>}/>
    {list.error&&<Feedback tone="error">{list.error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}
    <div className="table-wrap"><table className="w-full min-w-[900px] text-left">
      <thead><tr><th>Batch</th><th>Product</th><th>Material used</th><th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">Yield</th><th className="text-right">Residue</th><th className="text-right">Dispatched</th></tr></thead>
      <tbody>{list.rows.map(b=><tr key={b.id}>
        <td><p className="table-primary">{b.batch_number}</p><p className="table-secondary">{day(b.processed_on)} · {b.recorded_by_name}</p></td>
        <td>{b.product_name}</td>
        <td className="max-w-[240px]">{b.inputs.map(i=><p key={i.intake_id} className="table-secondary">{i.intake_number} · {kg(i.kg)} · {materialLabel(i.material_category)}</p>)}</td>
        <td className="text-right tabular-nums">{kg(b.input_kg)}</td>
        <td className="text-right tabular-nums">{kg(b.output_kg)}</td>
        <td className="text-right tabular-nums">{b.yield_rate===null?"—":`${b.yield_rate}%`}</td>
        <td className="text-right tabular-nums">{kg(b.residue_kg)}{b.residue_disposal&&<p className="table-secondary max-w-[160px]">{b.residue_disposal}</p>}</td>
        <td className="text-right tabular-nums">{kg(b.dispatched_kg)}</td>
      </tr>)}
      {!list.rows.length&&!list.loading&&<tr><td colSpan={8} className="p-8 text-center text-sm text-slate-500">No batches recorded yet.</td></tr>}</tbody>
    </table></div>
    <Pagination page={list.page} pageSize={list.pageSize} total={list.total} totalPages={list.totalPages} onPage={list.setPage} onPageSize={list.setPageSize}/>
    <Modal open={creating} onClose={()=>setCreating(false)} title="New processing batch" description="Choose the intakes this batch used and how much of each.">
      {creating&&<BatchForm onDone={message=>{setCreating(false);setNotice(message);void list.reload()}}/>}
    </Modal>
  </div></AppShell>;
}
