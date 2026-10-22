"use client";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,PageHeader,SectionHeading,Status} from "@/components/ui/System";
import {apiRequest,openAuthenticatedFile} from "@/lib/api";
import {useHasRole} from "@/lib/session";

type Standing={
  today:string;
  organization:{name:string;type:string}|null;
  permit:null|{id:string;permit_number:string;company_name:string;status:string;effective_status:string;valid_from:string|null;valid_until:string|null;renewal_count:number;verification_code:string|null;activities:Array<{code:string;name:string;description:string}>;divisions:Array<{name:string;status:string;expires_on:string|null}>};
  renewal:{eligible:boolean;reason:string|null;opensOn:string|null};
  requests:Array<{id:string;request_number:string;status:string;requested_valid_until:string;granted_valid_until:string|null;statement:string;review_notes:string|null;created_at:string;reviewed_at:string|null;evidence_file_name:string|null;requested_by_name:string}>;
  notices:Array<{id:string;notice_type:string;message:string;created_at:string;acknowledged_at:string|null}>;
};

const date=(v:string|null)=>v?new Date(`${v.slice(0,10)}T00:00:00`).toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"}):"—";
const daysBetween=(from:string,to:string)=>Math.round((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000);
const URGENT=new Set(["expired","suspended","expiry_7","renewal_rejected"]);

function readFile(file:File){return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("The file could not be read"));reader.readAsDataURL(file);});}

export default function OrganizationPermitPage(){
  const [data,setData]=useState<Standing|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[saving,setSaving]=useState(false),[loading,setLoading]=useState(true);
  const isAdmin=useHasRole("company_admin");

  const load=useCallback(async()=>{
    try{setData((await apiRequest<{data:Standing}>("/api/waste/regulatory/organization-permit")).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load your permit")}
    finally{setLoading(false)}
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);

  async function requestRenewal(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    const form=e.currentTarget,f=new FormData(form),file=f.get("evidence");
    setSaving(true);setError("");setNotice("");
    try{
      let evidence;
      if(file instanceof File&&file.size){
        if(!["application/pdf","image/jpeg"].includes(file.type))throw new Error("Attach a PDF or JPG file");
        if(file.size>5_000_000)throw new Error("The evidence file must be smaller than 5 MB");
        evidence={fileName:file.name,mimeType:file.type,dataUrl:await readFile(file)};
      }
      await apiRequest("/api/waste/regulatory/organization-permit/renewals",{method:"POST",body:JSON.stringify({requestedValidUntil:f.get("requestedValidUntil"),statement:f.get("statement"),evidence})});
      form.reset();setNotice("Renewal request sent. KCCA will review it and you will see the decision here.");
      await load();
    }catch(e){setError(e instanceof Error?e.message:"Could not send the renewal request")}finally{setSaving(false)}
  }

  async function withdraw(id:string){
    if(!window.confirm("Withdraw this renewal request? You can send a new one afterwards."))return;
    setError("");setNotice("");
    try{await apiRequest(`/api/waste/regulatory/organization-permit/renewals/${id}/withdraw`,{method:"PATCH"});setNotice("Renewal request withdrawn.");await load();}
    catch(e){setError(e instanceof Error?e.message:"Could not withdraw the request")}
  }

  async function acknowledge(id:string){
    try{await apiRequest(`/api/waste/regulatory/organization-permit/notices/${id}/acknowledge`,{method:"POST"});await load();}
    catch(e){setError(e instanceof Error?e.message:"Could not update the notice")}
  }

  const permit=data?.permit,open=data?.requests.find(r=>r.status==="submitted"),unread=data?.notices.filter(n=>!n.acknowledged_at)||[];
  const daysLeft=permit?.valid_until&&data?daysBetween(data.today,permit.valid_until):null;

  return <AppShell><div className="mx-auto max-w-5xl space-y-8">
    <PageHeader eyebrow="Regulation" title="KCCA permit" description="Your licence to operate in Kampala: what it allows, where, and until when."
      action={permit&&permit.effective_status==="approved"?<button onClick={()=>void openAuthenticatedFile("/api/waste/regulatory/organization-certificate/pdf",{download:`${permit.permit_number}.pdf`}).catch(e=>setError(e.message))} className="border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Download certificate</button>:undefined}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}

    {unread.map(n=><div key={n.id} className={`feedback ${URGENT.has(n.notice_type)?"feedback-error":"feedback-warning"} !mt-0 items-center justify-between`}>
      <div><p>{n.message}</p><p className="mt-0.5 text-xs font-normal opacity-80">{new Date(n.created_at).toLocaleDateString("en-GB")}</p></div>
      <button onClick={()=>void acknowledge(n.id)} className="min-h-0 shrink-0 px-2 py-1 text-xs font-semibold underline">Mark as read</button>
    </div>)}

    {loading?<p className="text-sm text-slate-500">Loading…</p>:!permit?<EmptyState title="No KCCA permit is linked to your organization" description="If you hold a permit, ask KCCA to link it to this account. Until then KCCA lists your company as operating without a permit on record."/>:<>
      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div><p className="text-xs font-medium text-slate-500">Permit number</p><p className="mt-1 text-lg font-semibold text-slate-900">{permit.permit_number}</p></div>
          <Status value={permit.effective_status}/>
        </div>
        <dl className="grid gap-px bg-slate-100 sm:grid-cols-3">
          <div className="bg-white px-6 py-4"><dt className="text-xs font-medium text-slate-500">Valid from</dt><dd className="mt-1 text-sm">{date(permit.valid_from)}</dd></div>
          <div className="bg-white px-6 py-4"><dt className="text-xs font-medium text-slate-500">Valid until</dt><dd className="mt-1 text-sm">{date(permit.valid_until)}</dd>
            {daysLeft!==null&&permit.status==="approved"&&<dd className={`mt-0.5 text-xs ${daysLeft<0?"text-[var(--color-danger)]":daysLeft<=60?"text-[var(--color-warning)]":"text-slate-500"}`}>{daysLeft<0?`Expired ${-daysLeft} days ago`:daysLeft===0?"Expires today":`${daysLeft} days left`}</dd>}</div>
          <div className="bg-white px-6 py-4"><dt className="text-xs font-medium text-slate-500">Verification code</dt><dd className="mt-1 font-mono text-sm">{permit.verification_code||"—"}</dd><dd className="mt-0.5 text-xs text-slate-500">Anyone can check it at /verify</dd></div>
        </dl>
        {permit.effective_status!=="approved"&&<p className="border-t border-slate-100 px-6 py-3 text-sm text-[var(--color-danger)]">{`${permit.effective_status==="suspended"?"Suspended":"Expired"}: ${data!.organization?.type==="recycling_company"?"new material purchases and sales cannot be recorded":data!.organization?.type==="processing_plant"?"new material intake cannot be recorded":"you cannot plan or dispatch collection routes"} until KCCA ${permit.effective_status==="suspended"?"reinstates":"renews"} the permit.`}</p>}
      </section>

      <div className="grid gap-8 md:grid-cols-2">
        <section><SectionHeading title="Authorized activities"/>
          <ul className="card divide-y divide-slate-100">{permit.activities.map(a=><li key={a.code} className="px-5 py-3"><p className="text-sm font-medium text-slate-900">{a.name}</p><p className="text-xs text-slate-500">{a.description}</p></li>)}
          {!permit.activities.length&&<li className="px-5 py-3 text-sm text-slate-500">KCCA has not recorded activities on this permit.</li>}</ul>
        </section>
        <section><SectionHeading title="Divisions"/>
          <ul className="card divide-y divide-slate-100">{permit.divisions.map(d=><li key={d.name} className="flex items-center justify-between px-5 py-3 text-sm"><span>{d.name}</span><Status value={d.status}/></li>)}
          {!permit.divisions.length&&<li className="px-5 py-3 text-sm text-slate-500">No divisions assigned yet. KCCA assigns divisions after activation.</li>}</ul>
        </section>
      </div>

      <section>
        <SectionHeading title="Renewal" description="Requests open 90 days before expiry and remain open after a permit expires."/>
        {open?<div className="card flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div><p className="text-sm font-semibold text-slate-900">{open.request_number} is waiting for KCCA</p><p className="text-sm text-slate-500">Sent {new Date(open.created_at).toLocaleDateString("en-GB")} by {open.requested_by_name}, asking for validity until {date(open.requested_valid_until)}.</p></div>
          {isAdmin&&<button onClick={()=>void withdraw(open.id)} className="border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Withdraw</button>}
        </div>:data!.renewal.eligible?(isAdmin?<form onSubmit={requestRenewal} className="card grid gap-4 p-5">
          <label className="text-sm font-medium text-slate-700">Requested validity until<input name="requestedValidUntil" type="date" required min={permit.valid_until&&permit.valid_until>data!.today?permit.valid_until:data!.today} className="mt-1 block w-full max-w-xs border border-slate-300 px-3 py-2.5 text-sm font-normal"/></label>
          <label className="text-sm font-medium text-slate-700">Statement to KCCA<textarea name="statement" required minLength={10} rows={4} placeholder="Confirm your operations, fleet and compliance since the last approval, and anything that has changed." className="mt-1 block w-full border border-slate-300 px-3 py-2.5 text-sm font-normal"/></label>
          <label className="text-sm font-medium text-slate-700">Supporting document <span className="font-normal text-slate-500">(optional, PDF or JPG, up to 5 MB)</span><input name="evidence" type="file" accept="application/pdf,image/jpeg" className="mt-1 block w-full text-sm font-normal"/></label>
          <button disabled={saving} className="justify-self-start bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving?"Sending…":"Send renewal request"}</button>
        </form>:<p className="card px-5 py-4 text-sm text-slate-600">Renewal is open. Your company administrator can send the request.</p>)
        :<p className="card px-5 py-4 text-sm text-slate-600">{data!.renewal.reason}{data!.renewal.opensOn?` You can apply from ${date(data!.renewal.opensOn)}.`:""}</p>}

        {data!.requests.length>0&&<div className="table-wrap mt-4"><table className="w-full text-left"><thead><tr><th>Request</th><th>Requested until</th><th>Outcome</th></tr></thead><tbody>
          {data!.requests.map(r=><tr key={r.id}><td><p className="table-primary">{r.request_number}</p><p className="table-secondary">{new Date(r.created_at).toLocaleDateString("en-GB")} · {r.requested_by_name}</p></td>
            <td>{date(r.requested_valid_until)}{r.granted_valid_until&&<p className="table-secondary">Granted until {date(r.granted_valid_until)}</p>}</td>
            <td><Status value={r.status}/>{r.review_notes&&<p className="table-secondary max-w-sm">{r.review_notes}</p>}</td></tr>)}
        </tbody></table></div>}
      </section>

      {data!.notices.some(n=>n.acknowledged_at)&&<section><SectionHeading title="Earlier notices"/>
        <ul className="card divide-y divide-slate-100">{data!.notices.filter(n=>n.acknowledged_at).map(n=><li key={n.id} className="px-5 py-3 text-sm"><p className="text-slate-700">{n.message}</p><p className="text-xs text-slate-400">{new Date(n.created_at).toLocaleDateString("en-GB")}</p></li>)}</ul>
      </section>}
    </>}
  </div></AppShell>;
}
