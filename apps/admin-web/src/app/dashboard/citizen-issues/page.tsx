"use client";

import { FormEvent, useEffect, useState, useSyncExternalStore } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiRequest, queueDesktopWhenUnavailable } from "@/lib/api";
import { OrganizationWorkspaceNav } from "@/components/layout/OrganizationWorkspaceNav";
import {EmptyState,Feedback,Modal,PageHeader,Status} from "@/components/ui/System";
import dynamic from "next/dynamic";
import {Division,currentPosition,readPhoto} from "@/lib/dumping";

const DumpingMap=dynamic(()=>import("@/components/gis/DumpingMap"),{ssr:false,loading:()=><div className="flex h-[220px] items-center justify-center bg-slate-50 text-sm text-slate-500">Loading map…</div>});

type Issue = {
  id: string;
  reporter_name: string;
  assigned_organization_id: string | null;
  assigned_organization_name: string | null;
  category: string;
  title: string;
  description: string;
  status: string;
  address: string | null;
  resolution_notes: string | null;
  created_at: string;
};
type Organization = { id: string; name: string; type: string };
type CollectionException={id:string;customer_name:string;address:string;zone_id:string;zone_name:string;scheduled_date:string;exception_reason:string;exception_notes:string|null;exception_review_status:string};
type CollectionJob={id:string;zone_id:string;zone_name:string;job_date:string;status:string};
type DriverProblem={id:string;category:string;description:string;status:string;zone_name:string|null;driver_name:string;plate_number:string|null};
type ListResponse<T> = { data: T[] };

function storedRoles():string {
  try {
    return JSON.parse(sessionStorage.getItem("currentUser") || "{}").roles?.join(",") || "unknown";
  } catch {
    return "unknown";
  }
}
function subscribe() { return () => undefined; }
function label(value: string) { return value.replaceAll("_", " "); }

export default function CitizenIssuesPage() {
  const roleSnapshot = useSyncExternalStore(subscribe, storedRoles, () => "hydrating");
  const isCitizen = roleSnapshot.split(",").includes("citizen");
  const isCompany = roleSnapshot.split(",").some(role=>["company_admin","supervisor"].includes(role));
  const canAssign = roleSnapshot.includes("kcca_admin") || roleSnapshot.includes("system_admin");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [exceptions,setExceptions]=useState<CollectionException[]>([]),[reviewing,setReviewing]=useState<CollectionException|null>(null);
  const [collectionJobs,setCollectionJobs]=useState<CollectionJob[]>([]);
  const [driverProblems,setDriverProblems]=useState<DriverProblem[]>([]);
  const [exceptionAction,setExceptionAction]=useState<"resolve"|"reschedule">("reschedule");
  const [targetJobId,setTargetJobId]=useState("");
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ category: "illegal_dumping", title: "", description: "", address: "" });
  // Illegal dumping: the exact place, the division and a photo go with the report so KCCA can find and inspect the site.
  const [point,setPoint]=useState<{latitude:number;longitude:number}|null>(null),[photo,setPhoto]=useState<string|null>(null),[divisionId,setDivisionId]=useState(""),[divisions,setDivisions]=useState<Division[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadIssues() {
    const response = await apiRequest<ListResponse<Issue>>("/api/waste/citizen-issues");
    setIssues(response.data);
  }

  useEffect(() => {
    if (roleSnapshot === "hydrating" || roleSnapshot === "unknown") return;
    const requests: Promise<unknown>[] = [
      apiRequest<ListResponse<Issue>>("/api/waste/citizen-issues").then(
        (response) => setIssues(response.data)
      ),
    ];
    if (isCitizen) apiRequest<{data:Division[]}>("/api/waste/dumping/divisions").then(r=>setDivisions(r.data)).catch(()=>undefined);
    if (canAssign) {
      requests.push(
        apiRequest<ListResponse<Organization>>("/api/organizations").then((response) =>
          setOrganizations(response.data.filter((item) => item.type === "waste_collection_company"))
        )
      );
    }
    if(isCompany)requests.push(
      apiRequest<ListResponse<CollectionException>>("/api/waste/customer-collection-stops").then(response=>setExceptions(response.data.filter(item=>item.exception_review_status==="pending"))),
      apiRequest<ListResponse<CollectionJob>>("/api/waste/collection-jobs").then(response=>setCollectionJobs(response.data)),
      apiRequest<ListResponse<DriverProblem>>("/api/waste/driver-job-problems").then(response=>setDriverProblems(response.data))
    );
    Promise.all(requests)
      .catch((error: unknown) => setError(error instanceof Error ? error.message : "Failed to load citizen issues"))
      .finally(() => setLoading(false));
  }, [roleSnapshot, canAssign, isCompany, isCitizen]);

  async function submitIssue(event: FormEvent) {
    event.preventDefault();
    try {
      setSaving(true); setError(""); setMessage("");
      const dumping=form.category==="illegal_dumping";
      const result=await apiRequest<{data:{dumping_site:{site_number:string;outcome:string}|null}}>("/api/waste/citizen-issues", { method: "POST", body: JSON.stringify({...form,...(dumping&&point?{...point,photo:photo||undefined,divisionId:divisionId||undefined}:{})}) });
      setForm({ category: "illegal_dumping", title: "", description: "", address: "" });setPoint(null);setPhoto(null);setDivisionId("");
      const site=result.data.dumping_site;
      setMessage(site?(site.outcome==="new_site"?`Thank you. KCCA has a new dumping site to inspect (${site.site_number}). You can track it below.`:`Thank you. This place was already reported (${site.site_number}); your report has been added to it.`):"Your issue was submitted. You can track its progress below.");
      await loadIssues();
    } catch (error) { setError(error instanceof Error ? error.message : "Failed to submit issue"); }
    finally { setSaving(false); }
  }

  async function assignIssue(issueId: string) {
    const organizationId = assignments[issueId];
    if (!organizationId) return;
    try {
      setSaving(true); setError("");
      await apiRequest(`/api/waste/citizen-issues/${issueId}/assign`, {
        method: "PATCH", body: JSON.stringify({ organizationId }),
      });
      await loadIssues();
    } catch (error) { setError(error instanceof Error ? error.message : "Failed to assign issue"); }
    finally { setSaving(false); }
  }

  async function updateStatus(issueId: string, status: string) {
    try {
      setSaving(true); setError("");
      await apiRequest(`/api/waste/citizen-issues/${issueId}/status`, {
        method: "PATCH", body: JSON.stringify({ status }),
      });
      await loadIssues();
    } catch (error) {
      try{await queueDesktopWhenUnavailable(error,{endpoint:`/api/waste/citizen-issues/${issueId}/status`,method:"PATCH",body:{status}});setIssues(current=>current.map(item=>item.id===issueId?{...item,status}:item));setMessage("Issue update saved on this computer and waiting to synchronize.");}
      catch(failure){setError(failure instanceof Error ? failure.message : "Failed to update issue");}
    }
    finally { setSaving(false); }
  }

  async function updateDriverProblem(problemId:string,status:"acknowledged"|"resolved"){
    try{setSaving(true);setError("");setMessage("");await apiRequest(`/api/waste/driver-job-problems/${problemId}`,{method:"PATCH",body:JSON.stringify({status})});setDriverProblems(current=>current.map(item=>item.id===problemId?{...item,status}:item));setMessage(status==="resolved"?"Driver problem resolved.":"Driver problem acknowledged for follow-up.");}
    catch(error){try{await queueDesktopWhenUnavailable(error,{endpoint:`/api/waste/driver-job-problems/${problemId}`,method:"PATCH",body:{status}});setDriverProblems(current=>current.map(item=>item.id===problemId?{...item,status}:item));setMessage("Driver problem update saved on this computer and waiting to synchronize.");}catch(failure){setError(failure instanceof Error?failure.message:"Could not update driver problem");}}
    finally{setSaving(false)}
  }

  async function reviewCollectionException(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!reviewing||exceptionAction==="reschedule"&&!targetJobId)return;const form=new FormData(event.currentTarget),body={action:exceptionAction,reviewNotes:form.get("reviewNotes"),...(exceptionAction==="reschedule"?{targetJobId}:{})};try{setSaving(true);setError("");await apiRequest(`/api/waste/customer-collection-stops/${reviewing.id}/exception`,{method:"PATCH",body:JSON.stringify(body)});setMessage(exceptionAction==="reschedule"?"Missed collection assigned to the selected future job.":"Missed collection reviewed and closed.");setExceptions(current=>current.filter(item=>item.id!==reviewing.id));closeExceptionReview();}catch(error){try{await queueDesktopWhenUnavailable(error,{endpoint:`/api/waste/customer-collection-stops/${reviewing.id}/exception`,method:"PATCH",body});setMessage("Missed-collection follow-up saved on this computer and waiting to synchronize.");setExceptions(current=>current.filter(item=>item.id!==reviewing.id));closeExceptionReview();}catch(failure){setError(failure instanceof Error?failure.message:"Could not update the collection exception")}}finally{setSaving(false)}}

  function openExceptionReview(item:CollectionException){setReviewing(item);setExceptionAction("reschedule");setTargetJobId("");setError("");}
  function closeExceptionReview(){setReviewing(null);setExceptionAction("reschedule");setTargetJobId("");}
  const eligibleJobs=reviewing?collectionJobs.filter(job=>job.zone_id===reviewing.zone_id&&["pending","assigned"].includes(job.status)&&job.job_date.slice(0,10)>=reviewing.scheduled_date.slice(0,10)):[];

  return <AppShell><div className="mx-auto max-w-7xl">
    <OrganizationWorkspaceNav/>
    <PageHeader eyebrow={isCitizen?"Citizen service":"Operations follow-up"} title={isCitizen?"Issues and pickup requests":"Service issues"} description={isCitizen?"Report a waste problem and follow what happens next.":isCompany?"Review citizen requests, driver blockers and missed pickups in one operational queue.":"Prioritize reports, assign responsibility and keep residents informed."}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{message&&<Feedback tone="success">{message}</Feedback>}

    {isCompany&&<section className="mt-7 grid border-y border-slate-300 sm:grid-cols-3"><Metric label="Citizen reports" value={issues.filter(item=>item.status!=="resolved").length}/><Metric label="Driver problems" value={driverProblems.filter(item=>item.status!=="resolved").length}/><Metric label="Missed pickups" value={exceptions.length}/></section>}

    <div className={`grid gap-8 py-8 ${isCitizen ? "lg:grid-cols-[380px_1fr]" : ""}`}>
      {isCitizen && <form onSubmit={submitIssue} className="h-fit border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-black">Submit an issue</h2>
        <label className="mt-5 block text-sm font-bold">Category
          <select value={form.category} onChange={(e) => setForm({...form, category:e.target.value})} className="mt-2 w-full border p-3">
            <option value="illegal_dumping">Illegal dumping</option><option value="missed_collection">Missed collection</option>
            <option value="overflowing_bin">Overflowing bin</option><option value="pickup_request">Pickup request</option>
          </select>
        </label>
        <label className="mt-4 block text-sm font-bold">Title<input required minLength={3} value={form.title} onChange={(e)=>setForm({...form,title:e.target.value})} className="mt-2 w-full border p-3" /></label>
        <label className="mt-4 block text-sm font-bold">Description<textarea required minLength={10} rows={5} value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})} className="mt-2 w-full border p-3" /></label>
        <label className="mt-4 block text-sm font-bold">{form.category==="illegal_dumping"?"Landmark":"Location/address"}<input value={form.address} onChange={(e)=>setForm({...form,address:e.target.value})} className="mt-2 w-full border p-3" /></label>
        {form.category==="illegal_dumping"&&<div className="mt-4 space-y-3 text-sm">
          <div><div className="flex items-center justify-between gap-2"><p className="font-bold">Exact place</p><button type="button" onClick={()=>currentPosition().then(setPoint).catch(e=>setError(e.message))} className="min-h-0 border border-slate-300 px-2 py-1 text-xs font-medium">Use my location</button></div>
            <div className="mt-2 overflow-hidden border border-slate-200"><DumpingMap picked={point} onPick={(latitude,longitude)=>setPoint({latitude,longitude})} height={220}/></div>
            <p className="mt-1 text-xs text-slate-500">{point?"Place marked. KCCA will inspect it.":"Tap the map where the waste is. Without it KCCA cannot find the site."}</p></div>
          <label className="block font-bold">Division<select value={divisionId} onChange={e=>setDivisionId(e.target.value)} className="mt-2 w-full border p-3 font-normal"><option value="">Not sure</option>{divisions.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label className="block font-bold">Photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={async e=>{const f=e.target.files?.[0];try{setPhoto(f?await readPhoto(f):null)}catch(err){setError(err instanceof Error?err.message:"Photo not usable")}}} className="mt-2 block w-full font-normal"/></label>
        </div>}
        <button disabled={saving} className="mt-5 w-full bg-emerald-700 px-4 py-3 font-black text-white disabled:opacity-50">{saving ? "Submitting..." : "Submit issue"}</button>
      </form>}

      <section>
        <div className="border-b border-slate-300 pb-4"><h2 className="text-xl font-semibold">{isCitizen ? "My reports" : isCompany ? "Assigned issues" : "Issues requiring attention"}</h2><p className="mt-1 text-sm text-slate-500">{isCitizen?"Track the response to every report you submit.":isCompany?"Start assigned work and record the resolution for the customer.":"Assign new reports to the licensed collector responsible for that area."}</p></div>
        {loading ? <p className="border-b border-slate-200 py-6 text-slate-500">Loading issues...</p> : issues.length === 0 ? <div className="border-b border-slate-200 py-8"><p className="font-semibold text-slate-800">No issues require action</p><p className="mt-1 text-sm text-slate-500">{isCitizen?"You have not submitted a report yet.":"This queue is clear. New reports will appear here automatically."}</p></div> :
          <div className="table-wrap"><table className="min-w-[900px] text-left"><thead><tr><th>Issue</th><th>Location / date</th>{!isCitizen&&<><th>Reporter</th><th>Assigned to</th></>}<th>Status</th><th className="text-right">Action</th></tr></thead><tbody>{issues.map((issue) => <tr key={issue.id}>
            <td className="max-w-sm"><p className="table-primary">{issue.title}</p><p className="table-secondary capitalize">{label(issue.category)} · {issue.description}</p>{issue.resolution_notes&&<p className="table-secondary"><b>Resolution:</b> {issue.resolution_notes}</p>}</td>
            <td><p>{issue.address||"No address supplied"}</p><p className="table-secondary">{new Date(issue.created_at).toLocaleDateString("en-GB")}</p></td>
            {!isCitizen&&<><td>{issue.reporter_name}</td><td>{issue.assigned_organization_name||"Unassigned"}</td></>}
            <td><Status value={issue.status}/></td>
            <td><div className="table-actions">{canAssign&&<><select aria-label={`Assign ${issue.title}`} value={assignments[issue.id]||""} onChange={(e)=>setAssignments({...assignments,[issue.id]:e.target.value})} className="max-w-44 border px-2"><option value="">Select company</option>{organizations.map((o)=><option key={o.id} value={o.id}>{o.name}</option>)}</select><button type="button" disabled={saving||!assignments[issue.id]} onClick={()=>assignIssue(issue.id)} className="bg-slate-900 px-3 text-white disabled:opacity-40">Assign</button></>}{!isCitizen&&issue.assigned_organization_id&&issue.status!=="resolved"&&<><button type="button" disabled={saving} onClick={()=>updateStatus(issue.id,"in_progress")} className="border px-3">Start</button><button type="button" disabled={saving} onClick={()=>updateStatus(issue.id,"resolved")} className="bg-[var(--color-action)] px-3 text-white">Resolve</button></>}</div></td>
          </tr>)}</tbody></table></div>}
      </section>
    </div>
    {isCompany&&<section className="mb-8"><div className="border-b border-slate-300 pb-4"><h2 className="text-xl font-semibold">Driver problems</h2><p className="mt-1 text-sm text-slate-500">Operational blockers reported from active trips.</p></div>{driverProblems.length?<div className="table-wrap"><table className="min-w-[820px] text-left"><thead><tr><th>Problem</th><th>Service area</th><th>Driver / vehicle</th><th>Status</th><th className="text-right">Action</th></tr></thead><tbody>{driverProblems.map(item=><tr key={item.id}><td><p className="table-primary capitalize">{label(item.category)}</p><p className="table-secondary">{item.description}</p></td><td>{item.zone_name||"Not recorded"}</td><td>{item.driver_name} · {item.plate_number||"No vehicle"}</td><td><Status value={item.status}/></td><td><div className="table-actions">{item.status==="open"&&<button disabled={saving} onClick={()=>void updateDriverProblem(item.id,"acknowledged")} className="border px-3 py-2 text-xs font-semibold">Acknowledge</button>}{item.status!=="resolved"&&<button disabled={saving} onClick={()=>void updateDriverProblem(item.id,"resolved")} className="bg-[var(--color-action)] px-3 py-2 text-xs font-semibold text-white">Resolve</button>}</div></td></tr>)}</tbody></table></div>:<EmptyState title="No driver problems" description="Blocked access, vehicle faults and unsafe-site reports will appear here."/>}</section>}
    {isCompany&&<section className="mb-8"><div className="border-b border-slate-300 pb-4"><h2 className="text-xl font-semibold">Missed collection review</h2><p className="mt-1 text-sm text-slate-500">Customer collection failures stay here until operations records the follow-up.</p></div>{exceptions.length?<div className="table-wrap"><table className="min-w-[760px] text-left"><thead><tr><th>Customer</th><th>Service area</th><th>Reason</th><th>Date</th><th className="text-right">Action</th></tr></thead><tbody>{exceptions.map(item=><tr key={item.id}><td><p className="table-primary">{item.customer_name}</p><p className="table-secondary">{item.address}</p></td><td>{item.zone_name}</td><td><p className="capitalize">{label(item.exception_reason)}</p><p className="table-secondary">{item.exception_notes||"No driver note"}</p></td><td>{new Date(item.scheduled_date).toLocaleDateString("en-GB")}</td><td className="text-right"><button type="button" onClick={()=>openExceptionReview(item)} className="border border-[var(--color-action)] px-3 py-2 text-xs font-semibold text-[var(--color-action)]">Review</button></td></tr>)}</tbody></table></div>:<EmptyState title="No missed collections awaiting review" description="Customer exceptions will appear here automatically."/>}</section>}
    <Modal open={Boolean(reviewing)} onClose={()=>!saving&&closeExceptionReview()} title="Review missed collection" description={reviewing?`Choose the next operational step for ${reviewing.customer_name}.`:""}>
      <form onSubmit={reviewCollectionException} className="space-y-5">
        <fieldset><legend className="text-sm font-semibold">Outcome</legend><div className="mt-2 grid grid-cols-2 border border-slate-300"><label className={`cursor-pointer p-3 text-sm ${exceptionAction==="reschedule"?"bg-[var(--color-action-soft)] font-semibold text-[var(--color-action)]":""}`}><input type="radio" className="mr-2" checked={exceptionAction==="reschedule"} onChange={()=>{setExceptionAction("reschedule");setTargetJobId("");}}/>Reschedule pickup</label><label className={`cursor-pointer border-l border-slate-300 p-3 text-sm ${exceptionAction==="resolve"?"bg-[var(--color-action-soft)] font-semibold text-[var(--color-action)]":""}`}><input type="radio" className="mr-2" checked={exceptionAction==="resolve"} onChange={()=>setExceptionAction("resolve")}/>Close without pickup</label></div></fieldset>
        {exceptionAction==="reschedule"&&<label className="block text-sm font-semibold">Future collection job<select required value={targetJobId} onChange={event=>setTargetJobId(event.target.value)} className="mt-2 w-full border border-slate-300 p-3 font-normal"><option value="">Select a job in {reviewing?.zone_name}</option>{eligibleJobs.map(job=><option key={job.id} value={job.id}>{new Date(job.job_date).toLocaleDateString("en-GB")} · {label(job.status)}</option>)}</select>{eligibleJobs.length===0&&<span className="mt-2 block border-l-2 border-amber-500 pl-3 font-normal text-amber-800">No eligible future job exists for this service area. Create the next scheduled job in Today&apos;s operations first.</span>}</label>}
        <label className="block text-sm font-semibold">Follow-up note<textarea required minLength={5} name="reviewNotes" rows={4} placeholder={exceptionAction==="reschedule"?"Example: Customer contacted and replacement pickup confirmed.":"Explain why no replacement pickup is required."} className="mt-2 w-full border border-slate-300 p-3 font-normal"/></label>
        <div className="flex justify-end gap-3"><button type="button" onClick={closeExceptionReview} className="border border-slate-300 px-4 py-2.5 text-sm font-semibold">Cancel</button><button disabled={saving||(exceptionAction==="reschedule"&&!targetJobId)} className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving?"Saving…":exceptionAction==="reschedule"?"Assign replacement pickup":"Close review"}</button></div>
      </form>
    </Modal>
  </div></AppShell>;
}

function Metric({label,value}:{label:string;value:number}){return <div className="border-b py-4 pr-4 sm:border-b-0 sm:border-r"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold text-slate-950">{value}</p></div>}
