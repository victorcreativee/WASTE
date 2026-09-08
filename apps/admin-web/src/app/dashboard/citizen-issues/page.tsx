"use client";

import { FormEvent, useEffect, useState, useSyncExternalStore } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiRequest } from "@/lib/api";
import { OrganizationWorkspaceNav } from "@/components/layout/OrganizationWorkspaceNav";
import {EmptyState,Feedback,PageHeader,Status} from "@/components/ui/System";

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
    Promise.all(requests)
      .catch((error: unknown) => setError(error instanceof Error ? error.message : "Failed to load citizen issues"))
      .finally(() => setLoading(false));
  }, [roleSnapshot, canAssign]);

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

      <section className="border border-slate-200 bg-white">
        <div className="border-b p-5"><h2 className="text-xl font-black">{isCitizen ? "My reports" : isCompany ? "Assigned issues" : "City issue queue"}</h2></div>
        {loading ? <p className="p-6 text-slate-500">Loading issues...</p> : issues.length === 0 ? <EmptyState title="No issues in this queue" description={isCitizen?"Your submitted reports will appear here.":"New reports will appear when they require attention."}/> :
          <div className="table-wrap"><table className="min-w-[900px] text-left"><thead><tr><th>Issue</th><th>Location / date</th>{!isCitizen&&<><th>Reporter</th><th>Assigned to</th></>}<th>Status</th><th className="text-right">Action</th></tr></thead><tbody>{issues.map((issue) => <tr key={issue.id}>
            <td className="max-w-sm"><p className="table-primary">{issue.title}</p><p className="table-secondary capitalize">{label(issue.category)} · {issue.description}</p>{issue.resolution_notes&&<p className="table-secondary"><b>Resolution:</b> {issue.resolution_notes}</p>}</td>
            <td><p>{issue.address||"No address supplied"}</p><p className="table-secondary">{new Date(issue.created_at).toLocaleDateString("en-GB")}</p></td>
            {!isCitizen&&<><td>{issue.reporter_name}</td><td>{issue.assigned_organization_name||"Unassigned"}</td></>}
            <td><Status value={issue.status}/></td>
            <td><div className="table-actions">{canAssign&&<><select aria-label={`Assign ${issue.title}`} value={assignments[issue.id]||""} onChange={(e)=>setAssignments({...assignments,[issue.id]:e.target.value})} className="max-w-44 border px-2"><option value="">Select company</option>{organizations.map((o)=><option key={o.id} value={o.id}>{o.name}</option>)}</select><button type="button" disabled={saving||!assignments[issue.id]} onClick={()=>assignIssue(issue.id)} className="bg-slate-900 px-3 text-white disabled:opacity-40">Assign</button></>}{!isCitizen&&issue.assigned_organization_id&&issue.status!=="resolved"&&<><button type="button" disabled={saving} onClick={()=>updateStatus(issue.id,"in_progress")} className="border px-3">Start</button><button type="button" disabled={saving} onClick={()=>updateStatus(issue.id,"resolved")} className="bg-[#3156a3] px-3 text-white">Resolve</button></>}</div></td>
          </tr>)}</tbody></table></div>}
      </section>
    </div>
  </div></AppShell>;
}
