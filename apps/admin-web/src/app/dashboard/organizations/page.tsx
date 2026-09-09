"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Feedback, Modal, PageHeader } from "@/components/ui/System";
import { Pagination, usePagination } from "@/components/ui/Pagination";
import { AdminSetup } from "./AdminSetup";
import { apiRequest } from "@/lib/api";

type Organization = {
  id: string;
  name: string;
  type: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
  created_at: string;
};

type OrganizationsResponse = {
  success: boolean;
  message: string;
  data: Organization[];
};
type ApprovedPermit={id:string;application_number:string;company_name:string;registration_number:string;valid_until:string|null;organization_id:string|null};
type Division={id:string;name:string;code:string};
type DivisionAuthorization={organization_id:string;division_id:string;status:string;expires_on:string|null};

const organizationTypes = [
  "all",
  "kcca",
  "waste_collection_company",
  "recycling_company",
  "processing_plant",
  "environment_agency",
  "business",
  "citizen_group",
  "system",
];
function roleSnapshot(){try{return JSON.parse(sessionStorage.getItem("currentUser")||"{}").roles?.join(",")||"unknown";}catch{return"unknown";}}
function subscribe(){return()=>undefined;}

export default function OrganizationsPage() {
  const roles=useSyncExternalStore(subscribe,roleSnapshot,()=>"hydrating");
  const canCreateOrganization=roles.includes("system_admin");
  const canManageDivisions=roles.includes("kcca_admin");
  const [createOpen,setCreateOpen]=useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [approvedPermits,setApprovedPermits]=useState<ApprovedPermit[]>([]);
  const [divisions,setDivisions]=useState<Division[]>([]),[authorizations,setAuthorizations]=useState<DivisionAuthorization[]>([]);
  const [divisionOrganization,setDivisionOrganization]=useState<Organization|null>(null),[selectedDivisions,setSelectedDivisions]=useState<string[]>([]),[authorizationExpiry,setAuthorizationExpiry]=useState(""),[savingDivisions,setSavingDivisions]=useState(false);

  const [form, setForm] = useState({
    name: "",
    type: "waste_collection_company",
    email: "",
    phone: "",
    address: "",
    approvedPermitId: "",
  });

  async function loadOrganizations() {
    try {
      setLoading(true);
      setError("");

      const response = await apiRequest<OrganizationsResponse>(
        "/api/organizations"
      );

      setOrganizations(response.data);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to load organizations"
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();

    try {
      setCreating(true);
      setError("");

      await apiRequest("/api/organizations", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          email: form.email || undefined,
          phone: form.phone || undefined,
          address: form.address || undefined,
          approvedPermitId: form.approvedPermitId || undefined,
        }),
      });

      setCreateOpen(false);
      setForm({
        name: "",
        type: "waste_collection_company",
        email: "",
        phone: "",
        address: "",
        approvedPermitId: "",
      });

      await loadOrganizations();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to create organization"
      );
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    apiRequest<OrganizationsResponse>("/api/organizations")
      .then((response) => setOrganizations(response.data))
      .catch((loadError: unknown) =>
        setError(loadError instanceof Error ? loadError.message : "Failed to load organizations")
      )
      .finally(() => setLoading(false));
  }, []);
  useEffect(()=>{if(!canCreateOrganization&&!canManageDivisions)return;apiRequest<{data:ApprovedPermit[]}>("/api/waste/regulatory/permit-applications?status=approved").then(r=>setApprovedPermits(canCreateOrganization?r.data.filter(p=>!p.organization_id):r.data)).catch(()=>setApprovedPermits([]));},[canCreateOrganization,canManageDivisions]);
  useEffect(()=>{if(!canManageDivisions)return;Promise.all([apiRequest<{data:Division[]}>("/api/waste/regulatory/divisions"),apiRequest<{data:DivisionAuthorization[]}>("/api/waste/regulatory/division-authorizations")]).then(([d,a])=>{setDivisions(d.data);setAuthorizations(a.data);}).catch((e:unknown)=>setError(e instanceof Error?e.message:"Failed to load division assignments"));},[canManageDivisions]);

  function openDivisionAssignment(organization:Organization){const current=authorizations.filter(item=>item.organization_id===organization.id&&item.status==="active");setDivisionOrganization(organization);setSelectedDivisions(current.map(item=>item.division_id));setAuthorizationExpiry(current[0]?.expires_on?.slice(0,10)||"");setError("");}
  async function saveDivisionAssignment(event:React.FormEvent){event.preventDefault();if(!divisionOrganization)return;const permit=approvedPermits.find(item=>item.organization_id===divisionOrganization.id);if(!permit){setError("This collector needs a current approved KCCA permit before divisions can be assigned.");return;}try{setSavingDivisions(true);setError("");await apiRequest("/api/waste/regulatory/division-authorizations",{method:"POST",body:JSON.stringify({organizationId:divisionOrganization.id,permitApplicationId:permit.id,divisionIds:selectedDivisions,expiresOn:authorizationExpiry||undefined})});const refreshed=await apiRequest<{data:DivisionAuthorization[]}>("/api/waste/regulatory/division-authorizations");setAuthorizations(refreshed.data);setDivisionOrganization(null);}catch(e){setError(e instanceof Error?e.message:"Failed to save division assignments");}finally{setSavingDivisions(false);}}

  const filteredOrganizations = useMemo(() => {
    return organizations.filter((organization) => {
      const matchesSearch =
        organization.name.toLowerCase().includes(search.toLowerCase()) ||
        organization.type.toLowerCase().includes(search.toLowerCase()) ||
        (organization.email || "").toLowerCase().includes(search.toLowerCase());

      const matchesType =
        typeFilter === "all" || organization.type === typeFilter;

      return matchesSearch && matchesType;
    });
  }, [organizations, search, typeFilter]);

  const pagination=usePagination(filteredOrganizations);
  return (
    <AppShell>
      <div className="mx-auto max-w-7xl">
        <PageHeader eyebrow={canManageDivisions?"KCCA oversight":"Platform administration"} title={canManageDivisions?"Licensed collectors":"Organizations"} description={canManageDivisions?"Assign permitted divisions and monitor the organizations responsible for city waste collection.":"Review active organizations created through the verified permit and platform-access process."} action={canCreateOrganization?<a href="/dashboard/account-verification" className="inline-block bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white">Review account applications</a>:undefined}/>

        {error && (
          <Feedback tone="error">{error}</Feedback>
        )}

        <section className="py-8">
          <div>
            <div className="mb-0 flex flex-col justify-between gap-5 pb-4 lg:flex-row lg:items-end">
              <div>
                <h2 className="text-2xl font-black text-slate-950">
                  Registered partners
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  {filteredOrganizations.length} shown from{" "}
                  {organizations.length} total organizations.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="search"
                  value={search}
                  onChange={(event) => {setSearch(event.target.value);pagination.setPage(1);}}
                  placeholder="Search organization..."
                  className="table-search"
                />

                <select
                  value={typeFilter}
                  onChange={(event) => {setTypeFilter(event.target.value);pagination.setPage(1);}}
                  className="border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-[#3156a3]"
                >
                  {organizationTypes.map((type) => (
                    <option key={type} value={type}>
                      {type === "all" ? "All types" : type.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="table-wrap">
              {loading ? (
                <p className="p-8 text-sm text-slate-500">
                  Loading organizations...
                </p>
              ) : filteredOrganizations.length === 0 ? (
                <p className="p-8 text-sm text-slate-500">
                  No organizations match your search.
                </p>
              ) : (
                <table className="min-w-[900px] text-left"><thead><tr><th>Organization</th><th>Type</th><th>Contact</th><th>Status</th>{canManageDivisions&&<th>Authorized divisions</th>}{canCreateOrganization&&<th>Onboarding</th>}</tr></thead><tbody>{pagination.paged.map((organization) => (
                  <tr key={organization.id}><td><p className="table-primary">{organization.name}</p><p className="table-secondary">{organization.address||"No address added"}</p></td><td className="capitalize">{organization.type.replaceAll("_"," ")}</td><td><p>{organization.email||"No email"}</p><p className="table-secondary">{organization.phone||"No phone"}</p></td><td><span className={`status status-${organization.is_active?"active":"inactive"}`}>{organization.is_active?"Active":"Inactive"}</span></td>{canManageDivisions&&<td>{organization.type==="waste_collection_company"?<div><p className="text-sm">{authorizations.filter(item=>item.organization_id===organization.id&&item.status==="active").map(item=>divisions.find(d=>d.id===item.division_id)?.name).filter(Boolean).join(", ")||"Not assigned"}</p><button onClick={()=>openDivisionAssignment(organization)} className="mt-1 text-xs font-semibold text-[#3156a3]">Manage divisions</button></div>:<span className="text-xs text-slate-500">Not applicable</span>}</td>}{canCreateOrganization&&<td>{organization.type==="waste_collection_company"&&organization.is_active?<AdminSetup organization={organization}/>:<span className="text-xs text-slate-500">Not eligible</span>}</td>}</tr>
                ))}</tbody></table>
              )}
            </div>
            <Pagination page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} totalPages={pagination.totalPages} onPage={pagination.setPage} onPageSize={pagination.setPageSize}/>
          </div>

          {canCreateOrganization&&<Modal open={createOpen} title="Add organization" description="Register a verified organization. For a waste-collection company, issue its first-administrator setup link after creation." onClose={()=>{if(!creating)setCreateOpen(false);}}>
            {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}

            <form onSubmit={handleCreate} className="mt-7 space-y-5">
              <label className="block">
                <span className="text-sm font-black text-slate-700">
                  Organization name
                </span>
                <input
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  required
                  className="mt-2 w-full border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-[#3156a3]"
                  placeholder="Example: Kampala Recycling Partners"
                />
              </label>

              <label className="block">
                <span className="text-sm font-black text-slate-700">Type</span>
                <select
                  value={form.type}
                  onChange={(event) =>
                    setForm({ ...form, type: event.target.value })
                  }
                  className="mt-2 w-full border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-[#3156a3]"
                >
                  {organizationTypes
                    .filter((type) => type !== "all")
                    .map((type) => (
                      <option key={type} value={type}>
                        {type.replaceAll("_", " ")}
                      </option>
                    ))}
                </select>
              </label>

              {form.type==="waste_collection_company"&&<label className="block"><span className="text-sm font-black text-slate-700">Approved KCCA permit</span><select required value={form.approvedPermitId} onChange={event=>{const permit=approvedPermits.find(item=>item.id===event.target.value);setForm({...form,approvedPermitId:event.target.value,name:permit?.company_name||form.name})}} className="mt-2 w-full border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-[#3156a3]"><option value="">Select an unused approved permit</option>{approvedPermits.map(permit=><option key={permit.id} value={permit.id}>{permit.application_number} · {permit.company_name}</option>)}</select><span className="mt-2 block text-xs font-normal text-slate-500">Waste collectors can only be activated after KCCA approval.</span></label>}

              <label className="block">
                <span className="text-sm font-black text-slate-700">Email</span>
                <input
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                  className="mt-2 w-full border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-[#3156a3]"
                  placeholder="info@example.ug"
                />
              </label>

              <label className="block">
                <span className="text-sm font-black text-slate-700">Phone</span>
                <input
                  value={form.phone}
                  onChange={(event) =>
                    setForm({ ...form, phone: event.target.value })
                  }
                  className="mt-2 w-full border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-[#3156a3]"
                  placeholder="+256..."
                />
              </label>

              <label className="block">
                <span className="text-sm font-black text-slate-700">
                  Address
                </span>
                <textarea
                  value={form.address}
                  onChange={(event) =>
                    setForm({ ...form, address: event.target.value })
                  }
                  className="mt-2 min-h-24 w-full border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-[#3156a3]"
                  placeholder="Kampala, Uganda"
                />
              </label>

              <button
                type="submit"
                disabled={creating}
                className="w-full bg-[#3156a3] px-5 py-4 text-sm font-black text-white transition hover:bg-[#284886] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creating ? "Creating organization..." : "Create organization"}
              </button>
            </form>
          </Modal>}
          <Modal open={Boolean(divisionOrganization)} title="Assign authorized divisions" description={divisionOrganization?`Choose where ${divisionOrganization.name} is licensed to operate. The company creates its own zones and routes inside these divisions.`:undefined} onClose={()=>{if(!savingDivisions)setDivisionOrganization(null);}}>
            <form onSubmit={saveDivisionAssignment} className="space-y-5">
              <fieldset><legend className="text-sm font-semibold">Kampala divisions</legend><div className="mt-2 divide-y border-y border-slate-200">{divisions.map(division=><label key={division.id} className="flex items-center gap-3 py-3 text-sm"><input type="checkbox" checked={selectedDivisions.includes(division.id)} onChange={()=>setSelectedDivisions(current=>current.includes(division.id)?current.filter(id=>id!==division.id):[...current,division.id])}/><span>{division.name}</span></label>)}</div></fieldset>
              <label className="block text-sm font-semibold">Authorization expires<input required type="date" min={new Date().toISOString().slice(0,10)} value={authorizationExpiry} onChange={event=>setAuthorizationExpiry(event.target.value)} className="mt-1 w-full border border-slate-300 p-3 font-normal"/></label>
              <p className="text-xs text-slate-500">Removing a division suspends future setup in that division. Existing records remain available for audit.</p>
              <button disabled={savingDivisions||selectedDivisions.length===0} className="w-full bg-[#3156a3] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{savingDivisions?"Saving…":"Save division authorization"}</button>
            </form>
          </Modal>
        </section>
      </div>
    </AppShell>
  );
}
