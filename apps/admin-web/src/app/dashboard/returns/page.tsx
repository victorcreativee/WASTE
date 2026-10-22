"use client";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {apiRequest} from "@/lib/api";
import {useHasRole} from "@/lib/session";
import {COLLECTOR_FIELDS,FACTORY_FIELDS,FIELD_LABEL,MATERIAL_CATEGORIES,RETURN_STATE,monthName,shortDate} from "@/lib/returns";

type Variance={field:string;declared:number;recorded:number;difference:number};
type FiledReturn={id:string;return_number:string;period:string;due_on:string;status:string;version:number;figures:Record<string,unknown>;variances:Variance[];declarant_name:string;declarant_title:string;submitted_at:string;submitted_late:boolean;review_notes:string|null;reviewed_at:string|null};
type Period={period:string;due_on:string;state:string;return:FiledReturn|null};
type ReturnsData={organization:{name:string;type:string};today:string;periods:Period[]};
type Prefill={period:string;due_on:string;organization_type:string;recorded:Record<string,number>;existing:FiledReturn|null};

const input="mt-1 block w-full border border-slate-300 px-3 py-2 text-sm font-normal tabular-nums";
const fmt=(n:number)=>Number(n).toLocaleString("en-GB");

function ReturnForm({prefill,onDone}:{prefill:Prefill;onDone:(message:string)=>void}){
  const [saving,setSaving]=useState(false),[problem,setProblem]=useState("");
  const collector=prefill.organization_type==="waste_collection_company",factory=prefill.organization_type==="processing_plant";
  const previous=prefill.existing?.figures as Record<string,unknown>|undefined;
  const start=(key:string)=>String(previous?.[key]??prefill.recorded[key]??0);
  const material=(category:string,kind:"collectedKg"|"soldKg")=>{
    const row=(previous?.materials as Array<Record<string,unknown>>|undefined)?.find(m=>m.category===category);
    return String(row?.[kind]??prefill.recorded[`${category}_${kind==="collectedKg"?"collected":"sold"}_kg`]??0);
  };

  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    const f=new FormData(e.currentTarget),n=(key:string)=>Number(f.get(key)||0);
    const figures=collector
      ?{...Object.fromEntries(COLLECTOR_FIELDS.map(([key])=>[key,n(key)])),disposal_site:String(f.get("disposal_site")||""),notes:String(f.get("notes")||"")||undefined}
      :factory?{...Object.fromEntries(FACTORY_FIELDS.map(([key])=>[key,n(key)])),residue_disposal:String(f.get("residue_disposal")||"")||undefined,notes:String(f.get("notes")||"")||undefined}
      :{materials:MATERIAL_CATEGORIES.map(([key])=>({category:key,collectedKg:n(`${key}_collected`),soldKg:n(`${key}_sold`)})).filter(m=>m.collectedKg||m.soldKg),
        residue_kg:n("residue_kg"),residue_disposal:String(f.get("residue_disposal")||"")||undefined,staff_employed:n("staff_employed"),notes:String(f.get("notes")||"")||undefined};
    const body={declarantName:f.get("declarantName"),declarantTitle:f.get("declarantTitle"),figures,confirm:f.get("confirm")==="on"};
    setSaving(true);setProblem("");
    try{
      const r=prefill.existing?.status==="queried"
        ?await apiRequest<{message:string}>(`/api/waste/regulatory/returns/${prefill.existing.id}`,{method:"PUT",body:JSON.stringify(body)})
        :await apiRequest<{message:string}>("/api/waste/regulatory/returns",{method:"POST",body:JSON.stringify({...body,period:prefill.period})});
      onDone(`${monthName(prefill.period)}: ${r.message}.`);
    }catch(e){setProblem(e instanceof Error?e.message:"The return could not be submitted")}finally{setSaving(false)}
  }

  const recorded=(key:string)=>prefill.recorded[key]?<span className="font-normal text-slate-500">Platform recorded {fmt(prefill.recorded[key])}</span>:null;

  return <form onSubmit={submit} className="grid gap-5 text-sm">
    {problem&&<Feedback tone="error">{problem}</Feedback>}
    {prefill.existing?.status==="queried"&&<Feedback tone="warning"><p className="font-semibold">KCCA queried this return</p><p className="font-normal">{prefill.existing.review_notes}</p></Feedback>}
    <p className="text-slate-600">Figures start from what the platform recorded for {monthName(prefill.period)}. Correct anything the platform did not capture; KCCA sees both.</p>
    {factory?<div className="grid gap-4 sm:grid-cols-2">
      {FACTORY_FIELDS.map(([key,label,hint])=><label key={key} className="font-medium text-slate-700">{label}<input name={key} type="number" min={0} step={key.endsWith("_kg")?"any":1} required defaultValue={start(key)} className={input}/><span className="mt-1 block text-xs">{recorded(key)||<span className="font-normal text-slate-400">{hint}</span>}</span></label>)}
      <label className="font-medium text-slate-700 sm:col-span-2">How residue was disposed of<input name="residue_disposal" defaultValue={String(previous?.residue_disposal??"")} placeholder="Required when there is residue" className={input.replace(" tabular-nums","")}/></label>
    </div>:collector?<div className="grid gap-4 sm:grid-cols-2">
      {COLLECTOR_FIELDS.map(([key,label,hint])=><label key={key} className="font-medium text-slate-700">{label}<input name={key} type="number" min={0} step={key.endsWith("_kg")?"any":1} required defaultValue={start(key)} className={input}/><span className="mt-1 block text-xs">{recorded(key)||<span className="font-normal text-slate-400">{hint}</span>}</span></label>)}
      <label className="font-medium text-slate-700 sm:col-span-2">Disposal site used<input name="disposal_site" required minLength={2} defaultValue={String(previous?.disposal_site??"")} placeholder="e.g. Kiteezi landfill" className={input.replace(" tabular-nums","")}/></label>
    </div>:<>
      <div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Material</th><th>Collected (kg)</th><th>Sold (kg)</th></tr></thead><tbody>
        {MATERIAL_CATEGORIES.map(([key,label])=><tr key={key}><td className="table-primary">{label}</td>
          <td><input aria-label={`${label} collected kg`} name={`${key}_collected`} type="number" min={0} step="any" defaultValue={material(key,"collectedKg")} className={input.replace("mt-1 ","")}/></td>
          <td><input aria-label={`${label} sold kg`} name={`${key}_sold`} type="number" min={0} step="any" defaultValue={material(key,"soldKg")} className={input.replace("mt-1 ","")}/></td></tr>)}
      </tbody></table></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="font-medium text-slate-700">Sorting residue (kg)<input name="residue_kg" type="number" min={0} step="any" defaultValue={start("residue_kg")} className={input}/><span className="mt-1 block text-xs">{recorded("residue_kg")}</span></label>
        <label className="font-medium text-slate-700">Staff employed<input name="staff_employed" type="number" min={0} step={1} defaultValue={start("staff_employed")} className={input}/><span className="mt-1 block text-xs">{recorded("staff_employed")}</span></label>
        <label className="font-medium text-slate-700 sm:col-span-2">How residue was disposed of<input name="residue_disposal" defaultValue={String(previous?.residue_disposal??"")} placeholder="Required when there is residue, e.g. licensed hauler to Kiteezi" className={input.replace(" tabular-nums","")}/></label>
      </div>
    </>}
    <label className="font-medium text-slate-700">Notes for KCCA <span className="font-normal text-slate-500">(optional)</span><textarea name="notes" rows={2} defaultValue={String(previous?.notes??"")} className={input.replace(" tabular-nums","")}/></label>
    <fieldset className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
      <legend className="sr-only">Declaration</legend>
      <label className="font-medium text-slate-700">Your name<input name="declarantName" required minLength={2} className={input.replace(" tabular-nums","")}/></label>
      <label className="font-medium text-slate-700">Your position<input name="declarantTitle" required minLength={2} placeholder="e.g. Managing Director" className={input.replace(" tabular-nums","")}/></label>
      <label className="flex items-start gap-3 text-slate-700 sm:col-span-2"><input type="checkbox" name="confirm" required className="mt-0.5 h-4 w-4"/><span>I declare that these figures are complete and correct to the best of my knowledge. Submitting false information to KCCA is an offence.</span></label>
    </fieldset>
    <button disabled={saving} className="justify-self-start bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">{saving?"Submitting…":prefill.existing?.status==="queried"?"Resubmit to KCCA":"Submit to KCCA"}</button>
  </form>;
}

function ReturnView({filed}:{filed:FiledReturn}){
  const figures=filed.figures as Record<string,unknown>;
  const rows=Object.entries(figures).filter(([key])=>!["materials","notes","disposal_site","residue_disposal"].includes(key));
  return <div className="space-y-4 text-sm">
    <p className="text-slate-600">{filed.return_number} · version {filed.version} · declared by {filed.declarant_name}, {filed.declarant_title} on {shortDate(filed.submitted_at)}{filed.submitted_late?" (after the due date)":""}</p>
    {filed.review_notes&&<Feedback tone={filed.status==="queried"?"warning":"info"}><span className="font-normal">KCCA: {filed.review_notes}</span></Feedback>}
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">{rows.map(([key,value])=><div key={key}><dt className="text-xs text-slate-500">{FIELD_LABEL[key]||key}</dt><dd className="tabular-nums">{fmt(Number(value))}</dd></div>)}
      {"disposal_site" in figures&&<div><dt className="text-xs text-slate-500">Disposal site</dt><dd>{String(figures.disposal_site)}</dd></div>}
      {"residue_disposal" in figures&&<div><dt className="text-xs text-slate-500">Residue disposal</dt><dd>{String(figures.residue_disposal)}</dd></div>}</dl>
    {Array.isArray(figures.materials)&&<div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Material</th><th className="text-right">Collected kg</th><th className="text-right">Sold kg</th></tr></thead><tbody>{(figures.materials as Array<{category:string;collectedKg:number;soldKg:number}>).map(m=><tr key={m.category}><td>{MATERIAL_CATEGORIES.find(([k])=>k===m.category)?.[1]}</td><td className="text-right tabular-nums">{fmt(m.collectedKg)}</td><td className="text-right tabular-nums">{fmt(m.soldKg)}</td></tr>)}</tbody></table></div>}
  </div>;
}

export default function ReturnsPage(){
  const [data,setData]=useState<ReturnsData|null>(null),[prefill,setPrefill]=useState<Prefill|null>(null),[viewing,setViewing]=useState<FiledReturn|null>(null);
  const [error,setError]=useState(""),[notice,setNotice]=useState("");
  const isAdmin=useHasRole("company_admin");

  const load=useCallback(async()=>{
    try{setData((await apiRequest<{data:ReturnsData}>("/api/waste/regulatory/returns")).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load your returns")}
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);

  async function openForm(period:string){
    setError("");
    try{setPrefill((await apiRequest<{data:Prefill}>(`/api/waste/regulatory/returns/prefill?period=${period}`)).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not prepare the return")}
  }

  return <AppShell><div className="mx-auto max-w-5xl space-y-6">
    <PageHeader eyebrow="KCCA regulation" title="Monthly returns" description="Report each month's operations to KCCA by the 15th of the following month. Figures are prefilled from what you recorded on the platform."/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}
    {!isAdmin&&<Feedback tone="info">Your company administrator files returns. You can follow their status here.</Feedback>}

    {data&&(data.periods.length?<div className="table-wrap"><table className="w-full text-left">
      <thead><tr><th>Month</th><th>Due</th><th>Status</th><th>Submitted</th><th/></tr></thead>
      <tbody>{data.periods.map(p=><tr key={p.period}>
        <td className="table-primary">{monthName(p.period)}</td>
        <td>{shortDate(p.due_on)}</td>
        <td><span className={RETURN_STATE[p.state].className}>{RETURN_STATE[p.state].label}</span>{p.return?.submitted_late&&<p className="table-secondary">Filed late</p>}</td>
        <td>{p.return?<>{shortDate(p.return.submitted_at)}<p className="table-secondary">{p.return.declarant_name}</p></>:"—"}</td>
        <td className="text-right">{(p.state==="due"||p.state==="overdue"||p.state==="queried")&&isAdmin
          ?<button onClick={()=>void openForm(p.period)} className="bg-[var(--color-action)] px-3 py-2 text-xs font-semibold text-white">{p.state==="queried"?"Correct and resubmit":"File return"}</button>
          :p.return&&<button onClick={()=>setViewing(p.return)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">View</button>}</td>
      </tr>)}</tbody>
    </table></div>:<EmptyState title="No returns are owed yet" description="Your first return is due on the 15th of the month after your first full month on the platform."/>)}

    <Modal open={!!prefill} onClose={()=>setPrefill(null)} title={prefill?`Return for ${monthName(prefill.period)}`:""} description={prefill?`Due ${shortDate(prefill.due_on)}`:undefined}>
      {prefill&&<ReturnForm key={prefill.period} prefill={prefill} onDone={message=>{setPrefill(null);setNotice(message);void load()}}/>}
    </Modal>
    <Modal open={!!viewing} onClose={()=>setViewing(null)} title={viewing?`Return for ${monthName(viewing.period)}`:""} description={viewing?RETURN_STATE[viewing.status]?.label:undefined}>
      {viewing&&<ReturnView filed={viewing}/>}
    </Modal>
  </div></AppShell>;
}
