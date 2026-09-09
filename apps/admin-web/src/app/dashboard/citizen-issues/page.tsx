"use client";

import { FormEvent, useEffect, useState, useSyncExternalStore } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiRequest } from "@/lib/api";
import { OrganizationWorkspaceNav } from "@/components/layout/OrganizationWorkspaceNav";
import {EmptyState,Feedback,Modal,PageHeader,Status} from "@/components/ui/System";

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
type ListResponse<T> = { data: T[] };

function storedRoles() {
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
  const isCompany = roleSnapshot.split(",").includes("company_admin");
  const canAssign = roleSnapshot.includes("kcca_admin") || roleSnapshot.includes("system_admin");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [exceptions,setExceptions]=useState<CollectionException[]>([]),[reviewing,setReviewing]=useState<CollectionException|null>(null);
  const [collectionJobs,setCollectionJobs]=useState<CollectionJob[]>([]);
  const [exceptionAction,setExceptionAction]=useState<"resolve"|"reschedule">("reschedule");
  const [targetJobId,setTargetJobId]=useState("");
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ category: "illegal_dumping", title: "", description: "", address: "" });
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
    if (canAssign) {
      requests.push(
        apiRequest<ListResponse<Organization>>("/api/organizations").then((response) =>
          setOrganizations(response.data.filter((item) => item.type === "waste_collection_company"))
        )
      );
    }
    if(isCompany)requests.push(
      apiRequest<ListResponse<CollectionException>>("/api/waste/customer-collection-stops").then(response=>setExceptions(response.data.filter(item=>item.exception_review_status==="pending"))),
      apiRequest<ListResponse<CollectionJob>>("/api/waste/collection-jobs").then(response=>setCollectionJobs(response.data))
    );
    Promise.all(requests)
      .catch((error: unknown) => setError(error instanceof Error ? error.message : "Failed to load citizen issues"))
      .finally(() => setLoading(false));
  }, [roleSnapshot, canAssign, isCompany]);

  async function submitIssue(event: FormEvent) {
    event.preventDefault();
    try {
      setSaving(true); setError(""); setMessage("");
      await apiRequest("/api/waste/citizen-issues", { method: "POST", body: JSON.stringify(form) });
      setForm({ category: "illegal_dumping", title: "", description: "", address: "" });
      setMessage("Your issue was submitted. You can track its progress below.");
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
    } catch (error) { setError(error instanceof Error ? error.message : "Failed to update issue"); }
    finally { setSaving(false); }
  }

  async function reviewCollectionException(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!reviewing||exceptionAction==="reschedule"&&!targetJobId)return;const form=new FormData(event.currentTarget);try{setSaving(true);setError("");await apiRequest(`/api/waste/customer-collection-stops/${reviewing.id}/exception`,{method:"PATCH",body:JSON.stringify({action:exceptionAction,reviewNotes:form.get("reviewNotes"),...(exceptionAction==="reschedule"?{targetJobId}:{})})});setMessage(exceptionAction==="reschedule"?"Missed collection assigned to the selected future job.":"Missed collection reviewed and closed.");setExceptions(current=>current.filter(item=>item.id!==reviewing.id));closeExceptionReview();}catch(error){setError(error instanceof Error?error.message:"Could not update the collection exception")}finally{setSaving(false)}}

  function openExceptionReview(item:CollectionException){setReviewing(item);setExceptionAction("reschedule");setTargetJobId("");setError("");}
  function closeExceptionReview(){setReviewing(null);setExceptionAction("reschedule");setTargetJobId("");}
  const eligibleJobs=reviewing?collectionJobs.filter(job=>job.zone_id===reviewing.zone_id&&["pending","assigned"].includes(job.status)&&job.job_date.slice(0,10)>=reviewing.scheduled_date.slice(0,10)):[];

  return <AppShell><div className="mx-auto max-w-7xl">
    <OrganizationWorkspaceNav/>
    <PageHeader eyebrow="Citizen service" title="Issues and pickup requests" description={isCitizen?"Report a waste problem and follow what happens next.":"Prioritize reports, assign responsibility and keep residents informed."}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{message&&<Feedback tone="success">{message}</Feedback>}

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
        <label className="mt-4 block text-sm font-bold">Location/address<input value={form.address} onChange={(e)=>setForm({...form,address:e.target.value})} className="mt-2 w-full border p-3" /></label>
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
            <td><div className="table-actions">{canAssign&&<><select aria-label={`Assign ${issue.title}`} value={assignments[issue.id]||""} onChange={(e)=>setAssignments({...assignments,[issue.id]:e.target.value})} className="max-w-44 border px-2"><option value="">Select company</option>{organizations.map((o)=><option key={o.id} value={o.id}>{o.name}</option>)}</select><button type="button" disabled={saving||!assignments[issue.id]} onClick={()=>assignIssue(issue.id)} className="bg-slate-900 px-3 text-white disabled:opacity-40">Assign</button></>}{!isCitizen&&issue.assigned_organization_id&&issue.status!=="resolved"&&<><button type="button" disabled={saving} onClick={()=>updateStatus(issue.id,"in_progress")} className="border px-3">Start</button><button type="button" disabled={saving} onClick={()=>updateStatus(issue.id,"resolved")} className="bg-[#3156a3] px-3 text-white">Resolve</button></>}</div></td>
          </tr>)}</tbody></table></div>}
      </section>
    </div>
    {isCompany&&<section className="mb-8"><div className="border-b border-slate-300 pb-4"><h2 className="text-xl font-semibold">Missed collection review</h2><p className="mt-1 text-sm text-slate-500">Driver-reported collection failures stay here until operations records the follow-up.</p></div>{exceptions.length?<div className="table-wrap"><table className="min-w-[760px] text-left"><thead><tr><th>Customer</th><th>Service area</th><th>Reason</th><th>Date</th><th className="text-right">Action</th></tr></thead><tbody>{exceptions.map(item=><tr key={item.id}><td><p className="table-primary">{item.customer_name}</p><p className="table-secondary">{item.address}</p></td><td>{item.zone_name}</td><td><p className="capitalize">{label(item.exception_reason)}</p><p className="table-secondary">{item.exception_notes||"No driver note"}</p></td><td>{new Date(item.scheduled_date).toLocaleDateString("en-GB")}</td><td className="text-right"><button type="button" onClick={()=>openExceptionReview(item)} className="border border-[#3156a3] px-3 py-2 text-xs font-semibold text-[#3156a3]">Review</button></td></tr>)}</tbody></table></div>:<EmptyState title="No missed collections awaiting review" description="Driver exceptions will appear here automatically."/>}</section>}
    <Modal open={Boolean(reviewing)} onClose={()=>!saving&&closeExceptionReview()} title="Review missed collection" description={reviewing?`Choose the next operational step for ${reviewing.customer_name}.`:""}>
      <form onSubmit={reviewCollectionException} className="space-y-5">
        <fieldset><legend className="text-sm font-semibold">Outcome</legend><div className="mt-2 grid grid-cols-2 border border-slate-300"><label className={`cursor-pointer p-3 text-sm ${exceptionAction==="reschedule"?"bg-[#eef3ff] font-semibold text-[#3156a3]":""}`}><input type="radio" className="mr-2" checked={exceptionAction==="reschedule"} onChange={()=>{setExceptionAction("reschedule");setTargetJobId("");}}/>Reschedule pickup</label><label className={`cursor-pointer border-l border-slate-300 p-3 text-sm ${exceptionAction==="resolve"?"bg-[#eef3ff] font-semibold text-[#3156a3]":""}`}><input type="radio" className="mr-2" checked={exceptionAction==="resolve"} onChange={()=>setExceptionAction("resolve")}/>Close without pickup</label></div></fieldset>
        {exceptionAction==="reschedule"&&<label className="block text-sm font-semibold">Future collection job<select required value={targetJobId} onChange={event=>setTargetJobId(event.target.value)} className="mt-2 w-full border border-slate-300 p-3 font-normal"><option value="">Select a job in {reviewing?.zone_name}</option>{eligibleJobs.map(job=><option key={job.id} value={job.id}>{new Date(job.job_date).toLocaleDateString("en-GB")} · {label(job.status)}</option>)}</select>{eligibleJobs.length===0&&<span className="mt-2 block border-l-2 border-amber-500 pl-3 font-normal text-amber-800">No eligible future job exists for this service area. Create the next scheduled job in Today&apos;s operations first.</span>}</label>}
        <label className="block text-sm font-semibold">Follow-up note<textarea required minLength={5} name="reviewNotes" rows={4} placeholder={exceptionAction==="reschedule"?"Example: Customer contacted and replacement pickup confirmed.":"Explain why no replacement pickup is required."} className="mt-2 w-full border border-slate-300 p-3 font-normal"/></label>
        <div className="flex justify-end gap-3"><button type="button" onClick={closeExceptionReview} className="border border-slate-300 px-4 py-2.5 text-sm font-semibold">Cancel</button><button disabled={saving||(exceptionAction==="reschedule"&&!targetJobId)} className="bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving?"Saving…":exceptionAction==="reschedule"?"Assign replacement pickup":"Close review"}</button></div>
      </form>
    </Modal>
  </div></AppShell>;
}
