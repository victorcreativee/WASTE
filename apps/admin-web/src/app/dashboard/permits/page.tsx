"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader,Status} from "@/components/ui/System";
import {Pagination,usePagination} from "@/components/ui/Pagination";
import {apiRequest,openAuthenticatedFile} from "@/lib/api";
import {useHasRole} from "@/lib/session";

type Activity={code:string;name:string};
type ActivityType=Activity&{description:string;organization_type:string};
type Permit={id:string;application_number:string;company_name:string;registration_number:string;contact_name:string;email:string;phone:string;address:string;service_description:string;status:string;submitted_at:string|null;permit_number:string|null;valid_until:string|null;days_left:number|null;review_notes:string|null;organization_id:string|null;organization_type:string;renewal_count:number;renewal_pending:boolean;verification_code:string|null;activities:Activity[];documents:Array<{id:string;document_type:string;file_name:string;file_url:string}>};
type Renewal={id:string;request_number:string;status:string;requested_valid_until:string;granted_valid_until:string|null;statement:string;review_notes:string|null;created_at:string;reviewed_at:string|null;evidence_file_name:string|null;has_evidence:boolean;permit_id:string;permit_number:string;company_name:string;permit_status:string;current_valid_until:string|null;days_left:number|null;requested_by_name:string;reviewed_by_name:string|null;activities:Activity[]};
type Overview={active:number;expiring_60:number;expired:number;suspended:number;in_review:number;renewals_waiting:number;no_permit_on_record:Unlicensed[]};
type Unlicensed={id:string;name:string;type:string;email:string|null;phone:string|null;address:string|null;created_at:string};
type HistoryEntry={id:string;previous_status:string|null;new_status:string;notes:string|null;created_at:string;changed_by_name:string};

const label=(v:string)=>v.replaceAll("_"," ").replace(/^\w/,c=>c.toUpperCase());
const date=(v:string|null)=>v?new Date(`${v.slice(0,10)}T00:00:00`).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"—";
const ACTIONS:Record<string,Array<[string,string]>>={
  submitted:[["start_review","Start review"]],
  under_review:[["approve","Approve and issue permit"],["request_information","Request information"],["reject","Reject"]],
  information_required:[["start_review","Resume review"]],
  approved:[["renew","Renew"],["update_activities","Change authorized activities"],["suspend","Suspend"]],
  suspended:[["reinstate","Reinstate"],["renew","Renew with new validity"]],
  expired:[["renew","Renew"]],
};
const effective=(p:{status:string;days_left:number|null})=>p.status==="approved"&&p.days_left!==null&&p.days_left<0?"expired":p.status;

function Validity({permit}:{permit:{valid_until:string|null;days_left:number|null;status:string}}){
  if(!permit.valid_until)return <span className="text-slate-400">—</span>;
  const days=permit.days_left??0,live=["approved"].includes(permit.status);
  const tone=!live?"text-slate-500":days<0?"text-[var(--color-danger)]":days<=60?"text-[var(--color-warning)]":"text-slate-500";
  return <><p>{date(permit.valid_until)}</p>{live&&<p className={`table-secondary ${tone}`}>{days<0?`Expired ${-days} days ago`:days===0?"Expires today":`${days} days left`}</p>}</>;
}

export default function PermitsPage(){
  const [tab,setTab]=useState<"permits"|"renewals"|"unlicensed">("permits");
  const [items,setItems]=useState<Permit[]>([]),[renewals,setRenewals]=useState<Renewal[]>([]),[overview,setOverview]=useState<Overview|null>(null),[activityTypes,setActivityTypes]=useState<ActivityType[]>([]);
  const [selected,setSelected]=useState<Permit|null>(null),[history,setHistory]=useState<HistoryEntry[]>([]),[action,setAction]=useState("");
  const [renewal,setRenewal]=useState<Renewal|null>(null),[issueFor,setIssueFor]=useState<Unlicensed|null>(null);
  const [query,setQuery]=useState(""),[status,setStatus]=useState("all"),[error,setError]=useState(""),[notice,setNotice]=useState(""),[saving,setSaving]=useState(false);
  const canReview=useHasRole("kcca_admin");

  const load=useCallback(async()=>{
    const [permits,requests,summary,types]=await Promise.allSettled([
      apiRequest<{data:Permit[]}>("/api/waste/regulatory/permit-applications"),
      apiRequest<{data:Renewal[]}>("/api/waste/regulatory/permit-renewals"),
      apiRequest<{data:Overview}>("/api/waste/regulatory/permit-lifecycle/overview"),
      apiRequest<{data:ActivityType[]}>("/api/waste/regulatory/permit-activity-types"),
    ]);
    if(permits.status==="fulfilled"){setItems(permits.value.data);setSelected(current=>current?permits.value.data.find(item=>item.id===current.id)||null:null);}
    else setError(permits.reason instanceof Error?permits.reason.message:"Could not load permits");
    if(requests.status==="fulfilled")setRenewals(requests.value.data);
    if(summary.status==="fulfilled")setOverview(summary.value.data);
    if(types.status==="fulfilled")setActivityTypes(types.value.data);
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);

  function openPermit(permit:Permit){
    setSelected(permit);setAction(ACTIONS[permit.status]?.[0]?.[0]||"");setHistory([]);
    apiRequest<{data:HistoryEntry[]}>(`/api/waste/regulatory/permit-applications/${permit.id}/history`).then(r=>setHistory(r.data)).catch(()=>setHistory([]));
  }

  const filtered=useMemo(()=>items.filter(item=>{
    const state=effective(item);
    const matchesStatus=status==="all"||(status==="expiring"?state==="approved"&&item.days_left!==null&&item.days_left<=60:status==="renewal"?item.renewal_pending:state===status);
    return matchesStatus&&`${item.application_number} ${item.company_name} ${item.registration_number} ${item.permit_number||""}`.toLowerCase().includes(query.toLowerCase());
  }),[items,query,status]);
  const paging=usePagination(filtered,10);
  const waitingRenewals=renewals.filter(item=>item.status==="submitted").length;

  function showStatus(value:string){setTab("permits");setStatus(value);paging.setPage(1);}

  async function review(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!selected)return;
    const f=new FormData(e.currentTarget),activityCodes=f.getAll("activityCodes").map(String);
    const needsActivities=["approve","update_activities"].includes(action)||(action==="renew"&&activityCodes.length>0);
    setSaving(true);setError("");setNotice("");
    try{
      await apiRequest(`/api/waste/regulatory/permit-applications/${selected.id}`,{method:"PATCH",body:JSON.stringify({action,notes:f.get("notes"),validUntil:f.get("validUntil")||undefined,activityCodes:needsActivities?activityCodes:undefined})});
      setSelected(null);setNotice(action==="renew"?"Permit renewed and division authorizations extended.":action==="suspend"?"Permit suspended. The company can no longer plan or dispatch routes.":"Decision recorded.");
      await load();
    }catch(e){setError(e instanceof Error?e.message:"Could not save the decision")}finally{setSaving(false)}
  }

  async function decideRenewal(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!renewal)return;
    const submitter=(e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null,decision=submitter?.value==="reject"?"reject":"approve";
    const f=new FormData(e.currentTarget);
    setSaving(true);setError("");setNotice("");
    try{
      await apiRequest(`/api/waste/regulatory/permit-renewals/${renewal.id}`,{method:"PATCH",body:JSON.stringify({action:decision,notes:f.get("notes"),validUntil:decision==="approve"?f.get("validUntil")||undefined:undefined})});
      setRenewal(null);setNotice(decision==="approve"?`${renewal.company_name}: permit extended.`:`${renewal.company_name}: renewal request rejected.`);
      await load();
    }catch(e){setError(e instanceof Error?e.message:"Could not record the renewal decision")}finally{setSaving(false)}
  }

  async function issuePermit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!issueFor)return;
    const f=new FormData(e.currentTarget);
    setSaving(true);setError("");setNotice("");
    try{
      const r=await apiRequest<{message:string}>(`/api/waste/regulatory/organizations/${issueFor.id}/permits`,{method:"POST",body:JSON.stringify({
        registrationNumber:f.get("registrationNumber"),contactName:f.get("contactName"),email:f.get("email"),phone:f.get("phone"),address:f.get("address"),
        serviceDescription:f.get("serviceDescription"),validUntil:f.get("validUntil"),activityCodes:f.getAll("activityCodes").map(String),notes:f.get("notes"),
      })});
      setIssueFor(null);setNotice(`${issueFor.name}: ${r.message}.`);await load();
    }catch(e){setError(e instanceof Error?e.message:"Could not issue the permit")}finally{setSaving(false)}
  }

  async function runLifecycle(){
    setError("");setNotice("");
    try{const r=await apiRequest<{message:string}>("/api/waste/regulatory/permit-lifecycle/run",{method:"POST"});setNotice(r.message);await load();}
    catch(e){setError(e instanceof Error?e.message:"Could not run the expiry check")}
  }

  const activitiesFor=(permit:Permit)=>activityTypes.filter(type=>type.organization_type===permit.organization_type);
  const summary:Array<[string,number|undefined,string]>=[
    ["In force",overview?.active,"approved"],["Expiring in 60 days",overview?.expiring_60,"expiring"],["Expired",overview?.expired,"expired"],
    ["Suspended",overview?.suspended,"suspended"],["Applications in review",overview?.in_review,"under_review"],
  ];

  return <AppShell><div className="mx-auto max-w-[1500px] space-y-6">
    <PageHeader eyebrow="KCCA regulation" title="Permits and renewals" description="Issue permits, decide what each company may do, and keep validity current. Expired or suspended permits stop route planning and dispatch automatically." action={canReview?<button onClick={()=>void runLifecycle()} className="border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Run expiry check now</button>:undefined}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}

    <div className="grid grid-cols-2 border border-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-5 rounded-[var(--ui-radius-lg)]">
      {summary.map(([name,value,filter],index)=><button key={name} onClick={()=>showStatus(filter)} className={`min-h-0 border-slate-200 px-4 py-3 text-left hover:bg-slate-50 ${index?"border-l":""} ${tab==="permits"&&status===filter?"bg-slate-50":""}`}>
        <p className="text-xs font-medium text-slate-500">{name}</p>
        <p className={`mt-1 text-xl font-semibold tabular-nums ${filter==="expired"&&value?"text-[var(--color-danger)]":filter==="expiring"&&value?"text-[var(--color-warning)]":"text-slate-900"}`}>{value??"—"}</p>
      </button>)}
    </div>

    <div role="tablist" className="flex gap-6 border-b border-slate-200 text-sm">
      {([["permits","Permits",items.length],["renewals","Renewal requests",waitingRenewals],["unlicensed","No permit on record",overview?.no_permit_on_record.length??0]] as const).map(([key,name,count])=>
        <button key={key} role="tab" aria-selected={tab===key} onClick={()=>setTab(key)} className={`-mb-px min-h-0 border-b-2 pb-3 font-medium ${tab===key?"border-[var(--color-action)] text-slate-900":"border-transparent text-slate-500 hover:text-slate-800"}`}>
          {name}{count>0&&<span className={`ml-2 rounded-[3px] px-1.5 py-0.5 text-xs tabular-nums ${key==="permits"?"bg-slate-100 text-slate-600":"bg-amber-100 text-amber-800"}`}>{count}</span>}
        </button>)}
    </div>

    {tab==="permits"&&<section>
      <div className="table-toolbar">
        <input className="table-search" value={query} onChange={e=>{setQuery(e.target.value);paging.setPage(1)}} placeholder="Search company, registration or permit number"/>
        <select className="border border-slate-300 px-3 py-2 text-sm" value={status} onChange={e=>showStatus(e.target.value)}>
          <option value="all">All permits</option><option value="expiring">Expiring within 60 days</option><option value="renewal">Renewal requested</option>
          {["submitted","under_review","information_required","approved","suspended","expired","rejected"].map(x=><option key={x} value={x}>{label(x)}</option>)}
        </select>
        <span className="table-count">{filtered.length} results</span>
      </div>
      <div className="table-wrap"><table className="w-full min-w-[980px] text-left">
        <thead><tr><th>Company</th><th>Permit</th><th>Authorized activities</th><th>Valid until</th><th>Status</th><th className="text-right">Action</th></tr></thead>
        <tbody>{paging.paged.map(item=><tr key={item.id}>
          <td><p className="table-primary">{item.company_name}</p><p className="table-secondary">{item.registration_number} · {item.application_number}</p></td>
          <td><p>{item.permit_number||"Not issued"}</p>{item.renewal_count>0&&<p className="table-secondary">Renewed {item.renewal_count}×</p>}</td>
          <td className="max-w-[260px]">{item.activities.length?<p className="text-slate-600">{item.activities.map(a=>a.name).join(", ")}</p>:<span className="text-slate-400">—</span>}</td>
          <td><Validity permit={item}/></td>
          <td><div className="flex flex-col items-start gap-1"><Status value={effective(item)}/>{item.renewal_pending&&<span className="text-xs font-medium text-[var(--color-warning)]">Renewal requested</span>}</div></td>
          <td className="text-right"><button onClick={()=>openPermit(item)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Open</button></td>
        </tr>)}
        {!paging.paged.length&&<tr><td colSpan={6} className="p-8 text-center text-sm text-slate-500">No permits match this view.</td></tr>}</tbody>
      </table></div>
      <Pagination page={paging.page} pageSize={paging.pageSize} total={paging.total} totalPages={paging.totalPages} onPage={paging.setPage} onPageSize={paging.setPageSize}/>
    </section>}

    {tab==="renewals"&&<section>{renewals.length?<div className="table-wrap"><table className="w-full min-w-[980px] text-left">
      <thead><tr><th>Request</th><th>Company</th><th>Current expiry</th><th>Requested until</th><th>Status</th><th className="text-right">Action</th></tr></thead>
      <tbody>{renewals.map(item=><tr key={item.id}>
        <td><p className="table-primary">{item.request_number}</p><p className="table-secondary">{new Date(item.created_at).toLocaleDateString("en-GB")} · {item.requested_by_name}</p></td>
        <td><p>{item.company_name}</p><p className="table-secondary">{item.permit_number}</p></td>
        <td><Validity permit={{valid_until:item.current_valid_until,days_left:item.days_left,status:item.permit_status}}/></td>
        <td>{date(item.granted_valid_until||item.requested_valid_until)}{item.granted_valid_until&&item.granted_valid_until!==item.requested_valid_until&&<p className="table-secondary">Requested {date(item.requested_valid_until)}</p>}</td>
        <td><Status value={item.status}/></td>
        <td className="text-right"><button onClick={()=>setRenewal(item)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">{item.status==="submitted"&&canReview?"Review":"View"}</button></td>
      </tr>)}</tbody>
    </table></div>:<EmptyState title="No renewal requests yet" description="Companies can request renewal from 90 days before their permit expires."/>}</section>}

    {tab==="unlicensed"&&<section className="space-y-3">
      <Feedback tone="warning">These companies joined before permits applied to them: collectors created before licensing, and recycling companies, which join with a registration document. They can operate until KCCA issues a permit; after that the permit rules apply to them like everyone else.</Feedback>
      {overview?.no_permit_on_record.length?<div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Company</th><th>Type</th><th>On the platform since</th><th/></tr></thead><tbody>
        {overview.no_permit_on_record.map(org=><tr key={org.id}><td className="table-primary">{org.name}</td><td>{org.type==="recycling_company"?"Recycling company":org.type==="processing_plant"?"Recycling factory":"Waste collector"}</td><td>{new Date(org.created_at).toLocaleDateString("en-GB")}</td>
          <td className="text-right">{canReview&&<button onClick={()=>setIssueFor(org)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Issue permit</button>}</td></tr>)}
      </tbody></table></div>:<EmptyState title="Every active company holds a permit"/>}
    </section>}

    {selected&&<div className="anim-fade fixed inset-0 z-50 flex justify-end bg-slate-900/40" onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null)}}>
      <section className="h-full w-full max-w-2xl overflow-y-auto bg-white">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-slate-200 bg-white px-6 py-5">
          <div><p className="text-xs font-medium text-slate-500">{selected.permit_number||selected.application_number}</p><h2 className="mt-1 text-xl font-semibold">{selected.company_name}</h2><div className="mt-2"><Status value={effective(selected)}/></div></div>
          <button onClick={()=>setSelected(null)} className="text-sm font-medium text-slate-500 hover:text-slate-900">Close</button>
        </header>
        <div className="px-6">
          <dl className="grid gap-x-6 gap-y-4 border-b border-slate-200 py-6 sm:grid-cols-2">
            {[["Registration",selected.registration_number],["Contact",`${selected.contact_name} · ${selected.phone}`],["Email",selected.email],["Address",selected.address],["Valid until",selected.valid_until?`${date(selected.valid_until)}${selected.days_left!==null&&selected.status==="approved"?` (${selected.days_left<0?"expired":`${selected.days_left} days left`})`:""}`:"—"],["Verification code",selected.verification_code||"Issued with the permit"]].map(([a,b])=><div key={a}><dt className="text-xs font-medium text-slate-500">{a}</dt><dd className="mt-1 text-sm">{b}</dd></div>)}
          </dl>
          <div className="border-b border-slate-200 py-6">
            <h3 className="text-sm font-semibold">Authorized activities</h3>
            {selected.activities.length?<ul className="mt-2 space-y-1 text-sm text-slate-700">{selected.activities.map(a=><li key={a.code}>— {a.name}</li>)}</ul>:<p className="mt-2 text-sm text-slate-500">Chosen when the permit is approved.</p>}
            <h3 className="mt-6 text-sm font-semibold">Proposed service</h3><p className="mt-2 text-sm leading-6 text-slate-600">{selected.service_description}</p>
            <h3 className="mt-6 text-sm font-semibold">Documents</h3>
            {selected.documents.length?<div className="mt-2 divide-y divide-slate-200 border-y border-slate-200">{selected.documents.map(d=><a key={d.id} href={d.file_url} target="_blank" rel="noreferrer" className="flex justify-between py-2.5 text-sm text-[var(--color-action)]"><span>{d.file_name}</span><span className="text-slate-500">{label(d.document_type)} ↗</span></a>)}</div>:<p className="mt-2 text-sm text-slate-500">No documents on file.</p>}
          </div>

          {canReview&&ACTIONS[selected.status]&&<form onSubmit={review} className="border-b border-slate-200 py-6">
            <h3 className="text-sm font-semibold">Record a decision</h3>
            <div className="mt-4 grid gap-4">
              <select value={action} onChange={e=>setAction(e.target.value)} className="border border-slate-300 px-3 py-2.5 text-sm">{ACTIONS[selected.status].map(([value,text])=><option key={value} value={value}>{text}</option>)}</select>
              {["approve","renew"].includes(action)&&<label className="text-sm font-medium text-slate-700">Valid until<input name="validUntil" type="date" required className="mt-1 block w-full border border-slate-300 px-3 py-2.5 text-sm font-normal"/></label>}
              {["approve","update_activities","renew"].includes(action)&&<fieldset><legend className="text-sm font-medium text-slate-700">Authorized activities{action==="renew"&&<span className="font-normal text-slate-500"> (unchanged unless you edit them)</span>}</legend>
                <div className="mt-2 space-y-2">{activitiesFor(selected).map(type=><label key={type.code} className="flex items-start gap-3 text-sm"><input type="checkbox" name="activityCodes" value={type.code} defaultChecked={selected.activities.some(a=>a.code===type.code)} className="mt-0.5 h-4 w-4"/><span><span className="font-medium text-slate-800">{type.name}</span><span className="block text-xs text-slate-500">{type.description}</span></span></label>)}</div>
              </fieldset>}
              {action==="suspend"&&<Feedback tone="warning">Suspension stops route planning and dispatch for this company and suspends its division authorizations until KCCA reinstates the permit.</Feedback>}
              <textarea name="notes" required minLength={3} rows={3} placeholder="Reason for the decision (recorded in the permit history and shown to the company)" className="border border-slate-300 px-3 py-2.5 text-sm"/>
              <button disabled={saving||!action} className="justify-self-start bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving?"Saving…":"Save decision"}</button>
            </div>
          </form>}

          <div className="py-6">
            <h3 className="text-sm font-semibold">History</h3>
            {history.length?<ol className="mt-3 space-y-4 border-l border-slate-200 pl-4">{history.map(h=><li key={h.id} className="text-sm">
              <p className="text-xs text-slate-500">{new Date(h.created_at).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"})} · {h.changed_by_name}</p>
              <p className="mt-0.5 font-medium text-slate-800">{h.previous_status&&h.previous_status!==h.new_status?`${label(h.previous_status)} → ${label(h.new_status)}`:label(h.new_status)}</p>
              {h.notes&&<p className="mt-0.5 text-slate-600">{h.notes}</p>}
            </li>)}</ol>:<p className="mt-2 text-sm text-slate-500">No recorded changes.</p>}
          </div>
        </div>
      </section>
    </div>}

    <Modal open={!!issueFor} onClose={()=>setIssueFor(null)} title="Issue permit" description={issueFor?`${issueFor.name} · ${issueFor.type==="recycling_company"?"recycling company":issueFor.type==="processing_plant"?"recycling factory":"waste collector"} already active on the platform`:undefined}>
      {issueFor&&<form key={issueFor.id} onSubmit={issuePermit} className="grid gap-4 text-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="font-medium text-slate-700">Registration number<input name="registrationNumber" required minLength={3} className="mt-1 block w-full border border-slate-300 px-3 py-2.5 font-normal"/></label>
          <label className="font-medium text-slate-700">Valid until<input name="validUntil" type="date" required className="mt-1 block w-full border border-slate-300 px-3 py-2.5 font-normal"/></label>
          <label className="font-medium text-slate-700">Contact person<input name="contactName" required minLength={2} className="mt-1 block w-full border border-slate-300 px-3 py-2.5 font-normal"/></label>
          <label className="font-medium text-slate-700">Phone<input name="phone" required defaultValue={issueFor.phone||""} placeholder="+256700123456" className="mt-1 block w-full border border-slate-300 px-3 py-2.5 font-normal"/></label>
          <label className="font-medium text-slate-700">Email<input name="email" type="email" required defaultValue={issueFor.email||""} className="mt-1 block w-full border border-slate-300 px-3 py-2.5 font-normal"/></label>
          <label className="font-medium text-slate-700">Address<input name="address" required minLength={3} defaultValue={issueFor.address||""} className="mt-1 block w-full border border-slate-300 px-3 py-2.5 font-normal"/></label>
        </div>
        <label className="font-medium text-slate-700">Licensed operations<textarea name="serviceDescription" required minLength={10} rows={2} placeholder="What the company does and where" className="mt-1 block w-full border border-slate-300 px-3 py-2.5 font-normal"/></label>
        <fieldset><legend className="font-medium text-slate-700">Authorized activities</legend><div className="mt-2 space-y-2">
          {activityTypes.filter(type=>type.organization_type===issueFor.type).map(type=><label key={type.code} className="flex items-start gap-3"><input type="checkbox" name="activityCodes" value={type.code} className="mt-0.5 h-4 w-4"/><span><span className="font-medium text-slate-800">{type.name}</span><span className="block text-xs text-slate-500">{type.description}</span></span></label>)}
        </div></fieldset>
        <textarea name="notes" required minLength={3} rows={2} placeholder="Basis for issuing (inspection, documents checked) — recorded in the permit history" className="border border-slate-300 px-3 py-2.5"/>
        <button disabled={saving} className="justify-self-start bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">{saving?"Issuing…":"Issue permit"}</button>
      </form>}
    </Modal>

    <Modal open={!!renewal} onClose={()=>setRenewal(null)} title={renewal?`Renewal ${renewal.request_number}`:""} description={renewal?`${renewal.company_name} · ${renewal.permit_number}`:undefined}>
      {renewal&&<div className="space-y-5">
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div><dt className="text-xs font-medium text-slate-500">Current expiry</dt><dd className="mt-1">{date(renewal.current_valid_until)}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Requested until</dt><dd className="mt-1">{date(renewal.requested_valid_until)}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Submitted by</dt><dd className="mt-1">{renewal.requested_by_name}</dd></div>
        </dl>
        <div><p className="text-xs font-medium text-slate-500">Company statement</p><p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-700">{renewal.statement}</p></div>
        {renewal.has_evidence&&<button type="button" onClick={()=>void openAuthenticatedFile(`/api/waste/regulatory/permit-renewals/${renewal.id}/evidence`).catch(e=>setError(e.message))} className="min-h-0 p-0 text-sm font-medium text-[var(--color-action)] hover:underline">Open evidence: {renewal.evidence_file_name} ↗</button>}
        <p className="text-sm text-slate-600">Current activities: {renewal.activities.map(a=>a.name).join(", ")||"none recorded"}. Approving keeps them; change them on the permit afterwards if needed.</p>
        {renewal.status==="submitted"&&canReview?<form onSubmit={decideRenewal} className="grid gap-4 border-t border-slate-100 pt-5">
          <label className="text-sm font-medium text-slate-700">Grant validity until<input name="validUntil" type="date" defaultValue={renewal.requested_valid_until} className="mt-1 block w-full border border-slate-300 px-3 py-2.5 text-sm font-normal"/></label>
          <textarea name="notes" required minLength={3} rows={3} placeholder="Decision note (shown to the company)" className="border border-slate-300 px-3 py-2.5 text-sm"/>
          <div className="flex gap-2"><button value="approve" disabled={saving} className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Approve renewal</button><button value="reject" disabled={saving} className="border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-[var(--color-danger)] disabled:opacity-50">Reject</button></div>
        </form>:<p className="border-t border-slate-100 pt-5 text-sm text-slate-600">{label(renewal.status)}{renewal.reviewed_by_name?` by ${renewal.reviewed_by_name}`:""}{renewal.reviewed_at?` on ${new Date(renewal.reviewed_at).toLocaleDateString("en-GB")}`:""}{renewal.review_notes?`: ${renewal.review_notes}`:""}</p>}
      </div>}
    </Modal>
  </div></AppShell>;
}
