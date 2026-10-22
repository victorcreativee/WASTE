"use client";
import {useState} from "react";
import {Feedback} from "@/components/ui/System";
import {apiRequest} from "@/lib/api";
import {Delivery,MATERIALS,day,kg,materialLabel,todayIso} from "@/lib/factory";

const field="mt-1 block w-full border border-slate-300 px-3 py-2 text-sm font-normal";

/** Records material received: either an expected delivery from a licensed recycler, or a manual intake. */
export function IntakeForm({delivery,onDone}:{delivery?:Delivery|null;onDone:(message:string)=>void}){
  const [saving,setSaving]=useState(false),[problem,setProblem]=useState(""),[received,setReceived]=useState(delivery?String(delivery.sold_kg):"");
  const shortfall=delivery&&received?delivery.sold_kg-Number(received):0;

  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    const f=new FormData(e.currentTarget),text=(k:string)=>String(f.get(k)||"").trim()||undefined;
    setSaving(true);setProblem("");
    try{
      const r=await apiRequest<{message:string}>("/api/waste/factory/intakes",{method:"POST",body:JSON.stringify({
        ...(delivery?{sourceSaleId:delivery.sale_id}:{supplierName:text("supplierName"),materialCategory:text("materialCategory"),materialDescription:text("materialDescription"),declaredKg:f.get("declaredKg")?Number(f.get("declaredKg")):undefined}),
        receivedKg:Number(f.get("receivedKg")),rejectedKg:Number(f.get("rejectedKg")||0),receivedOn:f.get("receivedOn"),vehicleRegistration:text("vehicleRegistration"),notes:text("notes"),
      })});
      onDone(r.message);
    }catch(e){setProblem(e instanceof Error?e.message:"The intake could not be recorded")}finally{setSaving(false)}
  }

  return <form onSubmit={submit} className="grid gap-4 text-sm">
    {problem&&<Feedback tone="error">{problem}</Feedback>}
    {delivery?<dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-[var(--ui-radius)] border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3">
      <div><dt className="text-xs text-slate-500">From</dt><dd className="font-medium">{delivery.seller_name}</dd></div>
      <div><dt className="text-xs text-slate-500">Material</dt><dd>{delivery.material_type} · {materialLabel(delivery.material_category)}</dd></div>
      <div><dt className="text-xs text-slate-500">Sold</dt><dd className="tabular-nums">{kg(delivery.sold_kg)} on {day(delivery.sold_on)}</dd></div>
    </dl>:<div className="grid gap-4 sm:grid-cols-2">
      <label className="font-medium text-slate-700 sm:col-span-2">Supplier<input name="supplierName" required minLength={2} placeholder="Who delivered the material" className={field}/></label>
      <label className="font-medium text-slate-700">Material category<select name="materialCategory" required className={field}>{MATERIALS.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label className="font-medium text-slate-700">Material<input name="materialDescription" required minLength={2} placeholder="e.g. PET bottles, baled" className={field}/></label>
      <label className="font-medium text-slate-700">Declared weight (kg) <span className="font-normal text-slate-500">optional</span><input name="declaredKg" type="number" min={0} step="any" className={field}/></label>
    </div>}
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="font-medium text-slate-700">Weight received (kg)<input name="receivedKg" type="number" min={0.01} step="any" required value={received} onChange={e=>setReceived(e.target.value)} className={field}/></label>
      <label className="font-medium text-slate-700">Rejected at the gate (kg)<input name="rejectedKg" type="number" min={0} step="any" defaultValue="0" className={field}/></label>
      <label className="font-medium text-slate-700">Received on<input name="receivedOn" type="date" required max={todayIso()} defaultValue={todayIso()} className={field}/></label>
    </div>
    {delivery&&shortfall>0&&<p className="text-[var(--color-warning)]">{kg(shortfall)} less than the recycler sold. The difference is recorded and visible to KCCA.</p>}
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="font-medium text-slate-700">Vehicle <span className="font-normal text-slate-500">optional</span><input name="vehicleRegistration" placeholder="UBE 123A" className={field}/></label>
      <label className="font-medium text-slate-700">Notes <span className="font-normal text-slate-500">optional</span><input name="notes" className={field}/></label>
    </div>
    <button disabled={saving} className="justify-self-start bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">{saving?"Saving…":delivery?"Receive delivery":"Record intake"}</button>
  </form>;
}
