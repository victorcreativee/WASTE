"use client";
import { useState } from "react";
import { Modal, EmptyState } from "@/components/ui/System";
import { Pagination } from "@/components/ui/Pagination";
import { apiRequest } from "@/lib/api";

export type AccessRole={id:string;name:string;legacy_role_name:string|null;permissions:string[]};
const button="border border-slate-300 px-3 py-2 text-xs font-medium disabled:opacity-50";

export function ReviewRoles({roles,catalog,canManage,onSaved}:{roles:AccessRole[];catalog:Array<{code:string;description:string}>;canManage:boolean;onSaved:(message:string)=>void}){
 const [editing,setEditing]=useState<AccessRole|null>(null),[open,setOpen]=useState(false),[name,setName]=useState(""),[includeAudit,setIncludeAudit]=useState(false),[staffRead,setStaffRead]=useState(false),[staffManage,setStaffManage]=useState(false),[attendanceLevel,setAttendanceLevel]=useState("none");
 const [saving,setSaving]=useState(false),[error,setError]=useState(""),[search,setSearch]=useState(""),[page,setPage]=useState(1),[size,setSize]=useState(10);
 const filtered=roles.filter(r=>r.name.toLowerCase().includes(search.toLowerCase()));
 const actualPage=Math.min(page,Math.max(1,Math.ceil(filtered.length/size)));
 const visible=filtered.slice((actualPage-1)*size,actualPage*size);
 const start=(role:AccessRole|null)=>{setEditing(role);setName(role?.name||"");setIncludeAudit(role?.permissions.includes("audit.read")||false);setStaffRead(role?.permissions.includes("staff.read")||false);setStaffManage(role?.permissions.includes("staff.manage")||false);setAttendanceLevel(role?.permissions.includes("attendance.manage")?"manage":role?.permissions.includes("attendance.read")?"read":"none");setError("");setOpen(true);};
 async function save(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();setSaving(true);setError("");
  try{
   const result=await apiRequest<{message:string}>(`/api/auth/organization-access/roles${editing?`/${editing.id}`:""}`,{method:editing?"PUT":"POST",body:JSON.stringify({name,permissions:["access.read",...(includeAudit?["audit.read"]:[]),...(staffRead?["staff.read"]:[]),...(staffManage?["staff.manage"]:[]),...(attendanceLevel!=="none"?["attendance.read"]:[]),...(attendanceLevel==="manage"?["attendance.manage"]:[])],...(editing?{expected:{name:editing.name,permissions:editing.permissions}}:{})})});
   setOpen(false);setName("");setEditing(null);onSaved(result.message);
  }catch(e){setError(e instanceof Error?e.message:"Could not save this role.");}finally{setSaving(false);}
 }
 return <section className="mt-5">
  <p className="text-sm text-slate-600">Custom roles grant only the permissions you select. Staff directory and attendance access are optional. Driver-account and team management can be delegated explicitly. Supervisor accounts, payroll, financial actions and administrator powers remain protected. Existing roles gain no new permissions automatically.</p>
  <div className="flex flex-wrap justify-between gap-3 border-b py-4"><input aria-label="Search roles" placeholder="Search role name" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} className="w-full max-w-md border px-3 py-2 text-sm"/>{canManage&&<button className="bg-[var(--color-action)] px-4 py-2 text-sm text-white" onClick={()=>start(null)}>Create custom role</button>}</div>
  {visible.length?<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b bg-slate-50 text-xs text-slate-500"><tr>{["Role","Type","Permissions","Action"].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{visible.map(r=><tr key={r.id} className="border-b align-top"><td className="p-3 font-medium">{r.name.replaceAll("_"," ")}</td><td className="p-3 text-xs">{r.legacy_role_name?"Built-in":"Custom"}</td><td className="p-3 text-xs leading-6">{r.permissions.map(code=>catalog.find(p=>p.code===code)?.description||code).join(" · ")||"No administration permissions; operational access unchanged."}</td><td className="p-3">{r.legacy_role_name?<span className="text-xs text-slate-500">Protected</span>:canManage?<button className={button} onClick={()=>start(r)}>Edit role</button>:<span className="text-xs text-slate-500">Read only</span>}</td></tr>)}</tbody></table></div>:<EmptyState title="No matching roles" description="Try another role name."/>}
  <Pagination page={actualPage} pageSize={size} total={filtered.length} totalPages={Math.max(1,Math.ceil(filtered.length/size))} onPage={setPage} onPageSize={n=>{setSize(n);setPage(1);}}/>
  <Modal open={open} title={editing?"Edit custom role":"Create custom role"} description={editing?"Permission changes affect every member assigned this role on their next request.":"Choose permissions, then assign the role from Memberships."} onClose={()=>{if(!saving)setOpen(false);}}>
   <form onSubmit={save} className="space-y-5">
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <label className="block text-sm">Role name<input autoFocus required minLength={2} maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder="For example, Access reviewer" className="mt-2 block w-full border p-2"/></label>
    <fieldset className="space-y-3 text-sm"><legend className="mb-2 font-medium">Permissions</legend><p>Included: view organization memberships, staff names/emails and role templates.</p><label className="flex items-start gap-3"><input type="checkbox" checked={includeAudit} onChange={e=>setIncludeAudit(e.target.checked)}/><span>Also view audit history, including staff-status and team changes.</span></label><label className="flex items-start gap-3"><input type="checkbox" checked={staffRead} onChange={e=>{setStaffRead(e.target.checked);if(!e.target.checked){setAttendanceLevel("none");setStaffManage(false);}}}/><span>View staff directory, contact details, licences and team assignments.</span></label><label className="flex items-start gap-3"><input type="checkbox" disabled={!staffRead} checked={staffManage} onChange={e=>setStaffManage(e.target.checked)}/><span>Manage driver accounts and assign drivers to existing supervisors. Does not allow supervisor creation, self-changes, administrator changes or changes to other staff managers.</span></label><label className="block">Attendance<select disabled={!staffRead} value={attendanceLevel} onChange={e=>setAttendanceLevel(e.target.value)} className="mt-2 block w-full border p-2"><option value="none">No attendance access</option><option value="read">View attendance only</option><option value="manage">View and record attendance</option></select><span className="mt-2 block text-xs text-slate-500">Requires staff viewing. Recording covers eligible staff across the organization, not just the assigned team.</span></label></fieldset>
    <div className="flex justify-end gap-3"><button type="button" disabled={saving} className={button} onClick={()=>setOpen(false)}>Cancel</button><button disabled={saving} className="bg-[var(--color-action)] px-4 py-2 text-sm text-white disabled:opacity-50">{saving?"Saving…":"Save role"}</button></div>
   </form>
  </Modal>
 </section>;
}

export function MemberReviewRoles({member,roles,onSaved}:{member:{id:string;full_name:string;custom_role_ids:string[]};roles:AccessRole[];onSaved:(message:string)=>void}){
 const [open,setOpen]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState("");
 const [search,setSearch]=useState(""),[page,setPage]=useState(1),[size,setSize]=useState(10);
 const custom=roles.filter(r=>!r.legacy_role_name&&r.name.toLowerCase().includes(search.toLowerCase()));
 const actualPage=Math.min(page,Math.max(1,Math.ceil(custom.length/size)));
 const visible=custom.slice((actualPage-1)*size,actualPage*size);
 async function change(role:AccessRole,assigned:boolean){
  setSaving(true);setError("");
  try{
   const result=await apiRequest<{message:string}>(`/api/auth/organization-access/memberships/${member.id}/roles/${role.id}`,{method:"PUT",body:JSON.stringify({assigned})});
   setOpen(false);onSaved(result.message);
  }catch(e){setError(e instanceof Error?e.message:"Could not change role assignment.");}finally{setSaving(false);}
 }
 return <><button className={button} onClick={()=>{setError("");setOpen(true);}}>Assigned roles</button>
  <Modal open={open} title={`Assigned roles for ${member.full_name}`} description="Grant or remove the selected custom-role permissions. Each action saves immediately. Existing operational roles and account status are unchanged." onClose={()=>{if(!saving)setOpen(false);}}>
   {error&&<p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
   <input aria-label="Search assignable roles" placeholder="Search custom roles" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} className="mb-4 w-full border p-2 text-sm"/>
   {custom.length?<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="py-3">Role</th><th>Access</th><th>Action</th></tr></thead><tbody>{visible.map(r=>{const assigned=member.custom_role_ids.includes(r.id);return <tr key={r.id} className="border-t"><td className="py-3 pr-2">{r.name}</td><td className="pr-2 text-xs">Memberships{r.permissions.includes("audit.read")?" · audit":""}{r.permissions.includes("staff.manage")?" · manage drivers/teams":r.permissions.includes("staff.read")?" · staff":""}{r.permissions.includes("attendance.manage")?" · record attendance":r.permissions.includes("attendance.read")?" · view attendance":""}</td><td><button disabled={saving} className={button} onClick={()=>change(r,!assigned)}>{saving?"Saving…":assigned?"Remove role":"Assign role"}</button></td></tr>;})}</tbody></table></div>:<EmptyState title="No matching custom roles" description="Try another search, or create a custom role in Role templates first."/>}
   <Pagination page={actualPage} pageSize={size} total={custom.length} totalPages={Math.max(1,Math.ceil(custom.length/size))} onPage={setPage} onPageSize={n=>{setSize(n);setPage(1);}}/>
  </Modal>
 </>;
}
