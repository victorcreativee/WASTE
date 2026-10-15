"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiRequest } from "@/lib/api";
import { Pagination } from "@/components/ui/Pagination";
import { Feedback, PageHeader } from "@/components/ui/System";

type StaffUser = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  status: string;
  membership_status: string | null;
  management_protected: boolean;
  roles: string[];
  last_login_at: string | null;
  driver_id: string | null;
  driver_status: string | null;
  license_number: string | null;
  supervised_driver_ids: string[];
};
type ListResponse = { data: StaffUser[] };
type Attendance={id:string;user_id:string;full_name:string;roles:string[];work_date:string;shift_name:string;shift_start:string|null;shift_end:string|null;status:string;notes:string|null};

export default function TeamPage() {
  const [permissions,setPermissions]=useState<string[]>([]);
  const [identity,setIdentity]=useState({currentUserId:"",isAdministrator:false});
  const [organizationType,setOrganizationType]=useState<"waste_collection_company"|"recycling_company"|"">("");
  const [driverSearch,setDriverSearch]=useState(""),[driverPage,setDriverPage]=useState(1),[driverPageSize,setDriverPageSize]=useState(10);
  const [search,setSearch]=useState(""),[page,setPage]=useState(1),[pageSize,setPageSize]=useState(10);
  const [attendanceLoading,setAttendanceLoading]=useState(false);
  const attendanceRequest=useRef({id:0});
  const [attendanceReady,setAttendanceReady]=useState(false);
  const canManage=permissions.includes("staff.manage");
  const canCreateStaff=canManage&&identity.isAdministrator;
  const canReadAttendance=permissions.includes("attendance.read");
  const canMarkAttendance=permissions.includes("attendance.manage");
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [form, setForm] = useState({
    fullName: "", email: "", phone: "", password: "", role: "recycling_collector", licenseNumber: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedSupervisorId, setSelectedSupervisorId] = useState("");
  const [selectedDriverIds, setSelectedDriverIds] = useState<string[]>([]);
  const [teamView,setTeamView]=useState<"people"|"add"|"teams"|"attendance">("people");
  const [attendance,setAttendance]=useState<Attendance[]>([]);
  const [attendanceDate,setAttendanceDate]=useState(()=>new Date().toISOString().slice(0,10));

  async function loadStaff() {
    const response = await apiRequest<ListResponse>("/api/auth/organization-users");
    setStaff(response.data);
  }
  async function loadAttendance(date=attendanceDate){
    const request=++attendanceRequest.current.id;setAttendanceLoading(true);setAttendanceReady(false);setAttendance([]);
    try{const response=await apiRequest<{data:Attendance[]}>(`/api/auth/organization-attendance?date=${date}`);if(request===attendanceRequest.current.id){setAttendance(response.data);setAttendanceReady(true);}}
    catch(e){if(request===attendanceRequest.current.id)setError(e instanceof Error?e.message:"Could not load attendance.");}
    finally{if(request===attendanceRequest.current.id)setAttendanceLoading(false);}
  }
  async function markAttendance(person:StaffUser,status:string){const existing=attendance.find(row=>row.user_id===person.id);try{setSaving(true);setError("");await apiRequest("/api/auth/organization-attendance",{method:"PUT",body:JSON.stringify({userId:person.id,workDate:attendanceDate,shiftName:existing?.shift_name||"Day shift",shiftStart:existing?.shift_start?.slice(0,5)||"08:00",shiftEnd:existing?.shift_end?.slice(0,5)||"17:00",notes:existing?.notes||undefined,status})});setMessage(`${person.full_name} marked ${status}.`);await loadAttendance();}catch(e){setError(e instanceof Error?e.message:"Failed to update attendance");}finally{setSaving(false);}}

  useEffect(() => {
    let cancelled=false;
    const requestState=attendanceRequest.current;
    const currentUser=JSON.parse(sessionStorage.getItem("currentUser")||"{}");
    const currentRoles:string[]=Array.isArray(currentUser.roles)?currentUser.roles.map((role:unknown)=>typeof role==="string"?role:(role as {name?:string})?.name||""):[];
    const inferredType=currentRoles.some(role=>["recycling_collector","recycling_sales","recycling_field_manager"].includes(role))?"recycling_company":"";
    if(inferredType)setOrganizationType(inferredType);
    Promise.all([
          apiRequest<ListResponse>("/api/auth/organization-users"),
          apiRequest<{data:{permissions:string[];currentUserId:string;isAdministrator:boolean}}>("/api/auth/organization-access/me"),
          apiRequest<{data:{organization_type:"waste_collection_company"|"recycling_company"}}>("/api/waste/regulatory/organization-package").catch(()=>null),
        ])
      .then(([response,access,packageResult])=>{
        if(cancelled)return;
        const type=packageResult?.data.organization_type||inferredType||"waste_collection_company";
        setOrganizationType(type);
        setForm(current=>({...current,role:type==="recycling_company"?"recycling_collector":"driver"}));
        setStaff(response.data);setPermissions(access.data.permissions);setIdentity(access.data);
      })
      .catch((loadError:unknown)=>{if(!cancelled)setError(loadError instanceof Error?loadError.message:"Could not load staff.");})
      .finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;requestState.id++;};
  }, []);
  useEffect(()=>{if(!canCreateStaff||!organizationType)return;const params=new URLSearchParams(window.location.search);if(params.get("action")==="add"){const requested=params.get("role"),allowed=organizationType==="recycling_company"?["recycling_field_manager","recycling_collector","recycling_sales"]:["driver","supervisor"];setForm(current=>({...current,role:allowed.includes(requested||"")?requested!:allowed[0]}));setTeamView("add")}},[canCreateStaff,organizationType]);

  async function createStaff(event: FormEvent) {
    event.preventDefault();
    try {
      setSaving(true); setError(""); setMessage("");
      await apiRequest("/api/auth/organization-users", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          phone: form.phone || undefined,
          licenseNumber: form.role === "driver" && form.licenseNumber ? form.licenseNumber : undefined,
        }),
      });
      const roleLabel=form.role==="driver"?"Driver":form.role==="supervisor"?"Supervisor":form.role==="recycling_collector"?"Collection and purchasing worker":form.role==="recycling_field_manager"?"Recycling field manager":"Industrial sales worker";
      setMessage(`${roleLabel} account created. They can now sign in with the email and password provided.`);
      setForm({ fullName: "", email: "", phone: "", password: "", role: organizationType==="recycling_company"?"recycling_collector":"driver", licenseNumber: "" });
      await loadStaff();
      setTeamView("people");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create staff account");
    } finally { setSaving(false); }
  }

  async function changeStatus(userId: string, status: "active" | "inactive" | "suspended") {
    try {
      setSaving(true); setError(""); setMessage("");
      await apiRequest(`/api/auth/organization-users/${userId}/status`, {
        method: "PATCH", body: JSON.stringify({ status }),
      });
      setMessage(`Staff account ${status === "active" ? "activated" : status}.`);
      await loadStaff();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Failed to update staff account");
    } finally { setSaving(false); }
  }

  function selectSupervisor(userId: string) {
    setSelectedSupervisorId(userId);setDriverPage(1);setDriverSearch("");
    setSelectedDriverIds(staff.find((person) => person.id === userId)?.supervised_driver_ids || []);
  }

  async function saveSupervisorTeam(event: FormEvent) {
    event.preventDefault();
    if (!selectedSupervisorId) return;
    try {
      setSaving(true); setError(""); setMessage("");
      await apiRequest(`/api/auth/organization-users/supervisors/${selectedSupervisorId}/drivers`, {
        method: "PUT", body: JSON.stringify({ driverIds: selectedDriverIds }),
      });
      setMessage("Supervisor team updated. The supervisor can now monitor these drivers and their operational work.");
      await loadStaff();
    } catch (assignmentError) {
      setError(assignmentError instanceof Error ? assignmentError.message : "Failed to update supervisor team");
    } finally { setSaving(false); }
  }

  const canChangeStatus=(person:StaffUser)=>canManage&&person.id!==identity.currentUserId&&!person.roles.some(r=>["company_admin","citizen","kcca_admin","system_admin"].includes(r))&&(identity.isAdministrator||(person.roles.length===1&&person.roles[0]==="driver"&&!person.management_protected));
  const driverEligible=(person:StaffUser)=>person.driver_status!=="inactive"&&person.status==="active"&&person.membership_status==="active"&&!person.roles.some(r=>["company_admin","citizen","kcca_admin","system_admin"].includes(r));
  const teamDrivers=staff.filter(p=>p.driver_id&&(driverEligible(p)||selectedDriverIds.includes(p.driver_id))&&(p.full_name+" "+p.email).toLowerCase().includes(driverSearch.toLowerCase()));
  const actualDriverPage=Math.min(driverPage,Math.max(1,Math.ceil(teamDrivers.length/driverPageSize)));
  const visibleDrivers=teamDrivers.slice((actualDriverPage-1)*driverPageSize,actualDriverPage*driverPageSize);
  const attendanceRoles=organizationType==="recycling_company"?["recycling_collector","recycling_sales","recycling_field_manager"]:["driver","supervisor"];
  const eligible=staff.filter(p=>teamView!=="attendance"||(p.status==="active"&&p.membership_status==="active"&&p.roles.some(r=>attendanceRoles.includes(r))));
  const filtered=eligible.filter(p=>(p.full_name+" "+p.email+" "+p.roles.join(" ")).toLowerCase().includes(search.toLowerCase()));
  const actualPage=Math.min(page,Math.max(1,Math.ceil(filtered.length/pageSize)));
  const visible=filtered.slice((actualPage-1)*pageSize,actualPage*pageSize);
  return <AppShell><div className="mx-auto max-w-7xl">

    <PageHeader eyebrow="Organization staff" title="People and responsibilities" description={organizationType==="recycling_company"?(canCreateStaff?"Create field managers, purchasing and industrial-sales accounts, control access, and confirm attendance.":"Review field staff responsibilities and confirm daily attendance."):"Create supervisors and drivers, organize field teams, control access, and confirm attendance."} action={canCreateStaff&&<button onClick={()=>setTeamView("add")} className="bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white">Add staff member</button>}/>
    <nav className="mt-6 flex gap-6 overflow-x-auto border-b border-slate-300">{[["people","People"],...(canManage&&organizationType==="waste_collection_company"?[["teams","Supervisor teams"]]:[]),...(canReadAttendance?[["attendance","Attendance"]]:[])].map(([value,label])=><button key={value} onClick={()=>{setPage(1);setTeamView(value as "people"|"teams"|"attendance");if(value==="attendance")void loadAttendance();}} className={`whitespace-nowrap border-b-2 pb-3 text-sm font-bold ${teamView===value?"border-[#3156a3] text-[#3156a3]":"border-transparent text-slate-500"}`}>{label}</button>)}</nav>
    {(teamView==="people"||teamView==="attendance")&&<label className="mt-5 block text-sm">Find staff<input value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="Search name, email or role" className="mt-2 block w-full max-w-md border px-3 py-2"/></label>}
    {error && <Feedback tone="error">{error}</Feedback>}
    {message && <Feedback tone="success">{message}</Feedback>}

    <div className="py-8">
      {canCreateStaff&&<form onSubmit={createStaff} className={`${teamView==="add"?"block":"hidden"} max-w-2xl border-t-2 border-[#3156a3] bg-white p-6`}>
        <h2 className="text-xl font-black">Add a team member</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">Choose the person&apos;s actual operational responsibility. Their workspace is limited to the tools required for that role.</p>
        <label className="mt-5 block text-sm font-bold">Responsibility<select value={form.role} onChange={(event)=>setForm({...form,role:event.target.value})} className="mt-2 w-full border p-3">{organizationType==="recycling_company"?<><option value="recycling_field_manager">Field operations manager</option><option value="recycling_collector">Collection & purchasing worker</option><option value="recycling_sales">Industrial sales worker</option></>:<><option value="driver">Driver</option><option value="supervisor">Supervisor</option></>}</select><span className="mt-2 block text-xs font-normal leading-5 text-slate-500">{organizationType==="recycling_company"?"Field managers oversee purchasing, sorting, stock, workers and attendance without company administration or unrestricted finance. Collection workers record bought material and local sales. Industrial sales workers manage industry buyers.":"Drivers receive assigned routes and record collection outcomes. Supervisors prepare, dispatch, and monitor field work."}</span></label>
        <label className="mt-4 block text-sm font-bold">Full name<input required minLength={2} value={form.fullName} onChange={(event)=>setForm({...form,fullName:event.target.value})} className="mt-2 w-full border p-3" /></label>
        <label className="mt-4 block text-sm font-bold">Email address<input required type="email" value={form.email} onChange={(event)=>setForm({...form,email:event.target.value})} className="mt-2 w-full border p-3" /></label>
        <label className="mt-4 block text-sm font-bold">Phone number<input value={form.phone} onChange={(event)=>setForm({...form,phone:event.target.value})} className="mt-2 w-full border p-3" /></label>
        <label className="mt-4 block text-sm font-bold">Temporary password<input required type="password" minLength={8} value={form.password} onChange={(event)=>setForm({...form,password:event.target.value})} className="mt-2 w-full border p-3" /><span className="mt-2 block text-xs font-normal leading-5 text-slate-500">Share this securely. The password is never displayed again.</span></label>
        <button disabled={saving} className="mt-5 w-full bg-[#3156a3] px-4 py-3 font-bold text-white disabled:opacity-50">{saving ? "Creating account..." : "Create staff account"}</button>
      </form>}

      <section className={`${teamView==="people"?"block":"hidden"} border-y border-slate-300 bg-white`}>
        <div className="border-b p-5"><h2 className="text-xl font-black">Current team</h2><p className="mt-1 text-sm text-slate-500">Access and operational role status for your organization.</p></div>
        {loading ? <p className="p-6 text-slate-500">Loading team...</p>  : visible.length ? <div className="table-wrap"><table className="min-w-[860px] text-left"><thead><tr><th>Staff member</th><th>Role / licence</th><th>Status</th><th>Last login</th><th className="text-right">Action</th></tr></thead><tbody>{visible.map((person)=><tr key={person.id}><td><p className="table-primary">{person.full_name}</p><p className="table-secondary">{person.email}{person.phone?` · ${person.phone}`:""}</p></td><td className="capitalize">{person.roles.join(", ").replaceAll("_"," ")}<p className="table-secondary">{person.license_number?`Licence ${person.license_number}`:"—"}</p></td><td><span className={`status status-${person.status}`}>{person.status}</span></td><td>{person.last_login_at?new Date(person.last_login_at).toLocaleString("en-GB"):"Never"}</td><td><div className="table-actions">{!canChangeStatus(person)&&<span className="text-xs text-slate-500">{person.id===identity.currentUserId?"Your account":person.roles.includes("company_admin")||person.management_protected?"Protected account":"Read only"}</span>}{canChangeStatus(person)&&<>{person.status!=="active"&&<button disabled={saving} type="button" onClick={()=>changeStatus(person.id,"active")} className="border border-[#3156a3] px-3 text-[#3156a3]">Activate</button>}{person.status==="active"&&<button disabled={saving} type="button" onClick={()=>changeStatus(person.id,"suspended")} className="border border-red-300 px-3 text-red-700">Suspend</button>}</>}</div></td></tr>)}</tbody></table></div> : <p className="p-6 text-slate-500">No matching staff. Try another search or ask an administrator to add staff.</p>}
      </section>
    </div>

    {canManage&&<section className={`${teamView==="teams"?"block":"hidden"} mb-8 border-y border-slate-300 bg-white`}>
      <div className="border-b p-5"><h2 className="text-xl font-black">Supervisor teams</h2><p className="mt-1 text-sm text-slate-500">Choose which drivers each supervisor is responsible for monitoring.</p></div>
      <form onSubmit={saveSupervisorTeam} className="grid gap-6 p-6 lg:grid-cols-[320px_1fr_auto] lg:items-start">
        <label className="text-sm font-bold">Supervisor<select disabled={saving} value={selectedSupervisorId} onChange={(event)=>selectSupervisor(event.target.value)} className="mt-2 w-full border p-3"><option value="">Select supervisor</option>{staff.filter((person)=>person.roles.includes("supervisor") && person.status === "active" && person.membership_status==="active" && person.id!==identity.currentUserId && !person.roles.includes("company_admin")).map((person)=><option key={person.id} value={person.id}>{person.full_name}</option>)}</select></label>
        <fieldset disabled={!selectedSupervisorId||saving}><legend className="text-sm font-medium">Assigned drivers · {selectedDriverIds.length} selected</legend>
          <input aria-label="Search drivers" placeholder="Search driver name or email" value={driverSearch} onChange={e=>{setDriverSearch(e.target.value);setDriverPage(1);}} className="my-3 w-full border px-3 py-2 text-sm"/>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Select</th><th>Driver</th><th>Eligibility</th></tr></thead><tbody>{visibleDrivers.map(driver=><tr key={driver.driver_id} className="border-t"><td className="p-2"><input aria-label={`Assign ${driver.full_name}`} type="checkbox" checked={selectedDriverIds.includes(driver.driver_id!)} disabled={!driverEligible(driver)&&!selectedDriverIds.includes(driver.driver_id!)} onChange={event=>setSelectedDriverIds(current=>event.target.checked?[...current,driver.driver_id!]:current.filter(id=>id!==driver.driver_id))} className="h-4 w-4 accent-[#3156a3]"/></td><td className="py-3">{driver.full_name}<p className="text-xs text-slate-500">{driver.email}</p></td><td className="text-xs">{driverEligible(driver)?"Available":"Remove: driver, account or membership unavailable"}</td></tr>)}
          {!visibleDrivers.length&&<tr><td colSpan={3} className="py-4 text-sm text-slate-500">No matching drivers. Adjust your search or add an eligible driver.</td></tr>}</tbody></table></div>
          <Pagination page={actualDriverPage} pageSize={driverPageSize} total={teamDrivers.length} totalPages={Math.max(1,Math.ceil(teamDrivers.length/driverPageSize))} onPage={setDriverPage} onPageSize={n=>{setDriverPageSize(n);setDriverPage(1);}}/>
        </fieldset>
        <button disabled={saving || !selectedSupervisorId} className="bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-40">Save team</button>
      </form>
    </section>}
    {canReadAttendance&&<section className={`${teamView==="attendance"?"block":"hidden"} mb-8 border-y border-slate-300 bg-white`}><div className="flex flex-col justify-between gap-4 border-b border-slate-300 p-5 md:flex-row md:items-end"><div><h2 className="text-xl font-semibold">Daily attendance</h2><p className="mt-1 text-sm text-slate-500">Confirm who is ready for dispatch before assigning work.</p></div><label className="text-xs font-bold uppercase tracking-wide text-slate-500">Work date<input type="date" disabled={saving} value={attendanceDate} onChange={e=>{setAttendanceDate(e.target.value);void loadAttendance(e.target.value)}} className="mt-1 block border border-slate-300 px-3 py-2 text-sm text-slate-900"/></label></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-slate-300 text-xs uppercase tracking-wide text-slate-500"><tr><th className="p-4">Staff member</th><th>Role</th><th>Shift</th><th>Current status</th><th className="pr-4 text-right">Mark attendance</th></tr></thead><tbody className="divide-y divide-slate-200">{!visible.length&&<tr><td colSpan={5} className="p-4 text-sm text-slate-500">No eligible staff match this search. Attendance requires an active account and membership.</td></tr>}{visible.map(person=>{const record=attendance.find(a=>a.user_id===person.id);return <tr key={person.id}><td className="p-4"><p className="font-semibold">{person.full_name}</p><p className="text-xs text-slate-500">{person.email}</p></td><td className="capitalize text-slate-600">{person.roles.join(", ").replaceAll("_"," ")}</td><td className="text-slate-600">{record?.shift_name||"Day shift"}<p className="text-xs">{record?.shift_start?.slice(0,5)||"08:00"}–{record?.shift_end?.slice(0,5)||"17:00"}</p></td><td><span className={`border-l-2 px-2 text-xs font-bold uppercase ${record?.status==="present"?"border-[#3156a3] text-[#3156a3]":record?.status==="late"?"border-amber-500 text-amber-700":record?.status==="absent"?"border-red-500 text-red-700":"border-slate-300 text-slate-500"}`}>{attendanceLoading?"Loading…":!attendanceReady?"Unavailable":record?.status||"Not marked"}</span></td><td className="pr-4 text-right"><select aria-label={`Attendance for ${person.full_name}`} disabled={saving||attendanceLoading||!attendanceReady||!canMarkAttendance} value={record?.status||""} onChange={e=>void markAttendance(person,e.target.value)} className="border border-slate-300 px-3 py-2"><option value="" disabled>Choose status</option><option value="present">Present</option><option value="late">Late</option><option value="absent">Absent</option><option value="leave">On leave</option><option value="scheduled">Scheduled</option></select></td></tr>})}</tbody></table></div></section>}
    {(teamView==="people"||teamView==="attendance")&&<Pagination page={actualPage} pageSize={pageSize} total={filtered.length} totalPages={Math.max(1,Math.ceil(filtered.length/pageSize))} onPage={setPage} onPageSize={n=>{setPageSize(n);setPage(1);}}/>}
  </div></AppShell>;
}
