"use client";
import {useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {Feedback,Modal,PageHeader,Status} from "@/components/ui/System";
import {Pagination} from "@/components/ui/Pagination";
import {IntakeForm} from "@/components/factory/IntakeForm";
import {apiRequest} from "@/lib/api";
import {useHasRole} from "@/lib/session";
import {Intake,day,kg,materialLabel,useServerList} from "@/lib/factory";

export default function FactoryIntakePage(){
  const list=useServerList<Intake>("/api/waste/factory/intakes");
  const [recording,setRecording]=useState(false),[voiding,setVoiding]=useState<Intake|null>(null),[notice,setNotice]=useState(""),[error,setError]=useState(""),[saving,setSaving]=useState(false);
  const isAdmin=useHasRole("company_admin");

  async function voidIntake(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!voiding)return;
    setSaving(true);setError("");
    try{await apiRequest(`/api/waste/factory/intakes/${voiding.id}/void`,{method:"PATCH",body:JSON.stringify({reason:new FormData(e.currentTarget).get("reason")})});setVoiding(null);setNotice(`${voiding.intake_number} voided.`);await list.reload();}
    catch(e){setError(e instanceof Error?e.message:"Could not void the intake")}finally{setSaving(false)}
  }

  return <AppShell><div className="mx-auto max-w-6xl space-y-6">
    <PageHeader eyebrow="Recycling factory" title="Material intake" description="Everything received at the gate: who supplied it, what was accepted or rejected, and how much is left to process. Deliveries from licensed recyclers are received from the factory overview."
      action={<button onClick={()=>setRecording(true)} className="bg-[var(--color-action)] px-3 py-2 text-sm font-semibold text-white">Record intake</button>}/>
    {(error||list.error)&&<Feedback tone="error">{error||list.error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}

    <div className="table-wrap"><table className="w-full min-w-[900px] text-left">
      <thead><tr><th>Intake</th><th>Supplier</th><th>Material</th><th className="text-right">Received</th><th className="text-right">Accepted</th><th className="text-right">Remaining</th><th>Status</th><th/></tr></thead>
      <tbody>{list.rows.map(i=>{const shortfall=i.declared_kg!==null?Number(i.declared_kg)-Number(i.received_kg):0;return <tr key={i.id}>
        <td><p className="table-primary">{i.intake_number}</p><p className="table-secondary">{day(i.received_on)} · {i.recorded_by_name}</p></td>
        <td>{i.supplier_name}<p className="table-secondary">{i.source_sale_id?"Licensed recycler delivery":"Recorded at the gate"}</p></td>
        <td>{i.material_description}<p className="table-secondary">{materialLabel(i.material_category)}</p></td>
        <td className="text-right tabular-nums">{kg(i.received_kg)}{shortfall>0&&<p className="table-secondary text-[var(--color-warning)]">{kg(shortfall)} short of declared</p>}</td>
        <td className="text-right tabular-nums">{kg(i.accepted_kg)}{Number(i.rejected_kg)>0&&<p className="table-secondary">{kg(i.rejected_kg)} rejected</p>}</td>
        <td className="text-right tabular-nums">{kg(i.available_kg)}</td>
        <td><Status value={i.status}/>{i.void_reason&&<p className="table-secondary max-w-[180px]">{i.void_reason}</p>}</td>
        <td className="text-right">{isAdmin&&i.status==="received"&&Number(i.available_kg)===Number(i.accepted_kg)&&<button onClick={()=>setVoiding(i)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Void</button>}</td>
      </tr>})}
      {!list.rows.length&&!list.loading&&<tr><td colSpan={8} className="p-8 text-center text-sm text-slate-500">No intake recorded yet.</td></tr>}</tbody>
    </table></div>
    <Pagination page={list.page} pageSize={list.pageSize} total={list.total} totalPages={list.totalPages} onPage={list.setPage} onPageSize={list.setPageSize}/>

    <Modal open={recording} onClose={()=>setRecording(false)} title="Record intake" description="Material received from a supplier that is not a licensed recycler on the platform.">
      {recording&&<IntakeForm onDone={message=>{setRecording(false);setNotice(message);void list.reload()}}/>}
    </Modal>
    <Modal open={!!voiding} onClose={()=>setVoiding(null)} title={voiding?`Void ${voiding.intake_number}`:""} description="Only an intake that has not been processed can be voided. The record stays, marked void.">
      <form onSubmit={voidIntake} className="grid gap-3 text-sm">
        <textarea name="reason" required minLength={5} rows={3} placeholder="Why is this intake being voided?" className="border border-slate-300 px-3 py-2.5"/>
        <button disabled={saving} className="justify-self-start border border-slate-300 bg-white px-4 py-2.5 font-semibold text-[var(--color-danger)] disabled:opacity-50">{saving?"Voiding…":"Void intake"}</button>
      </form>
    </Modal>
  </div></AppShell>;
}
