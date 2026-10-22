"use client";
import {useEffect,useState} from "react";
import {Feedback,Modal} from "@/components/ui/System";
import {apiRequest} from "@/lib/api";
import {ScheduleItem,ugx} from "@/lib/penalties";

export type PenaltyDraft={organizationId?:string;organizationName?:string;scheduleCode?:string;grounds?:string;dumpingSiteId?:string;complianceCaseId?:string;returnPeriod?:string;source?:string};
type Org={id:string;name:string;type:string;is_active:boolean};
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";

/** KCCA issues a penalty notice, optionally prefilled from the evidence it arises from (a dumping site, a late return). */
export function IssuePenaltyDialog({draft,onClose,onIssued}:{draft:PenaltyDraft|null;onClose:()=>void;onIssued:(message:string)=>void}){
  const [schedule,setSchedule]=useState<ScheduleItem[]>([]),[orgs,setOrgs]=useState<Org[]>([]),[code,setCode]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{
    if(!draft)return;
    setCode(draft.scheduleCode||"");setError("");
    apiRequest<{data:ScheduleItem[]}>("/api/waste/penalties/schedule").then(r=>setSchedule(r.data)).catch(()=>undefined);
    if(!draft.organizationId)apiRequest<{data:Org[]}>("/api/organizations").then(r=>setOrgs(r.data.filter(o=>o.is_active&&["waste_collection_company","recycling_company","processing_plant"].includes(o.type)))).catch(()=>undefined);
  },[draft]);
  const item=schedule.find(s=>s.code===code);

  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!draft)return;const form=new FormData(e.currentTarget);setBusy(true);setError("");
    try{
      const r=await apiRequest<{message:string;data:{amount_ugx:number;offence_number:number}}>("/api/waste/penalties/notices",{method:"POST",body:JSON.stringify({
        organizationId:draft.organizationId||form.get("organizationId"),scheduleCode:code,grounds:form.get("grounds"),
        dumpingSiteId:draft.dumpingSiteId,complianceCaseId:draft.complianceCaseId,returnPeriod:draft.returnPeriod})});
      onIssued(`${r.message}: ${ugx(r.data.amount_ugx)}${r.data.offence_number>1?` (repeat offence ${r.data.offence_number})`:""}.`);
    }catch(err){setError(err instanceof Error?err.message:"Could not issue the notice")}finally{setBusy(false)}
  }

  return <Modal open={Boolean(draft)} title="Issue penalty notice" description={draft?.organizationName?`${draft.organizationName}${draft.source?` · ${draft.source}`:""}. The company can pay within 30 days or appeal within 14.`:"The company can pay within 30 days or appeal within 14."} onClose={onClose}>
    {draft&&<form onSubmit={submit} className="grid gap-4 text-sm">
      {error&&<Feedback tone="error">{error}</Feedback>}
      {!draft.organizationId&&<label className="font-medium text-slate-700">Company<select name="organizationId" required className={field}><option value="">Choose</option>{orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
      <label className="font-medium text-slate-700">Offence<select value={code} onChange={e=>setCode(e.target.value)} required className={field}><option value="">Choose from the schedule</option>{schedule.map(s=><option key={s.code} value={s.code}>{s.title}</option>)}</select></label>
      {item&&<p className="text-slate-600">{item.description} <span className="font-medium text-slate-900">{ugx(item.amount_ugx)}</span>, or {ugx(item.repeat_amount_ugx)} for a repeat offence within a year (worked out automatically).</p>}
      <label className="font-medium text-slate-700">Grounds<textarea name="grounds" required minLength={20} rows={4} defaultValue={draft.grounds} placeholder="The facts, when they happened, and the evidence KCCA holds. Shown to the company." className={field}/></label>
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="border border-slate-300 px-4 py-2.5 font-medium text-slate-700">Cancel</button><button disabled={busy||!code} className="bg-[var(--color-danger)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">{busy?"Issuing…":"Issue notice"}</button></div>
    </form>}
  </Modal>;
}
