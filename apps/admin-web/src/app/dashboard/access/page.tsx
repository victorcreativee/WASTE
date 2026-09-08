"use client";
import { ReviewRoles, MemberReviewRoles, AccessRole } from "./ReviewRoles";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader, Feedback, EmptyState, Modal } from "@/components/ui/System";
import { Pagination } from "@/components/ui/Pagination";
import { apiRequest } from "@/lib/api";

type Member={id:string;user_id:string;full_name:string;email:string;status:string;account_status:string;roles:string[];custom_role_ids:string[];protected:boolean};
type Audit={id:string;action:string;entity_type:string;entity_id:string;actor_name:string|null;created_at:string;previous_value:unknown;new_value:unknown};
type Result<T>={items:T[];total:number;page:number;pageSize:number};
type Overview={roles:AccessRole[];catalog:Array<{code:string;description:string}>;effectivePermissions:string[];currentUserId:string};
type View="members"|"roles"|"audit";
const empty={items:[],total:0,page:1,pageSize:10};
const words=(value:string)=>value.replaceAll("_"," ");

export default function AccessPage(){
 const [view,setView]=useState<View>("members"),[overview,setOverview]=useState<Overview|null>(null);
 const [members,setMembers]=useState<Result<Member>>(empty),[audit,setAudit]=useState<Result<Audit>>(empty);
 const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(10),[search,setSearch]=useState(""),[revision,setRevision]=useState(0);
 const [loading,setLoading]=useState(true),[error,setError]=useState(""),[message,setMessage]=useState("");
 const [pending,setPending]=useState<Member|null>(null),[saving,setSaving]=useState(false),[actionError,setActionError]=useState("");
 useEffect(()=>{
   let cancelled=false;
   apiRequest<{data:Overview}>("/api/auth/organization-access").then(r=>{if(!cancelled)setOverview(r.data);}).catch(e=>{if(!cancelled){setOverview(null);setError(e.message||"Could not load organization access.");}});
   return()=>{cancelled=true;};
 },[revision]);
 useEffect(()=>{
   if(view==="roles")return;
   let cancelled=false;
   const path=view==="members"?"memberships":"audit";
   const params=new URLSearchParams({page:String(page),pageSize:String(pageSize),search:view==="members"?search:""});
   apiRequest<{data:Result<Member>&Result<Audit>}>(`/api/auth/organization-access/${path}?${params}`).then(r=>{
     if(cancelled)return;
     if(view==="members")setMembers(r.data);else setAudit(r.data);
     setLoading(false);
   }).catch(e=>{if(!cancelled){setError(e.message||"Could not load access records.");setLoading(false);}});
   return()=>{cancelled=true;};
 },[view,page,pageSize,search,revision]);
 const navigate=(next:View)=>{setView(next);setPage(1);setError("");setLoading(true);};
 const changePage=(value:number)=>{setPage(value);setLoading(true);};
 const changeSize=(value:number)=>{setPageSize(value);setPage(1);setLoading(true);};
 async function confirm(){
   if(!pending)return;
   setSaving(true);setActionError("");
   try{
     const result=await apiRequest<{message:string}>(`/api/auth/organization-access/memberships/${pending.id}/status`,{method:"PATCH",body:JSON.stringify({status:pending.status==="active"?"suspended":"active"})});
     setMessage(result.message);setPending(null);setLoading(true);setRevision(n=>n+1);
   }catch(e){setActionError(e instanceof Error?e.message:"Could not update membership.");}finally{setSaving(false);}
 }
 const rows=view==="audit"?audit:members;
 const canManage=!!overview?.effectivePermissions.includes("access.manage");
 const saved=(message:string)=>{setMessage(message);setError("");setLoading(true);setRevision(n=>n+1);};
 return <AppShell><div className="mx-auto max-w-7xl">
   <PageHeader eyebrow="Organization administration" title="Access & permissions" description="Review who can enter your organization, inspect current permissions, and trace access changes."/>
   <p className="mt-4 text-sm text-slate-600">Membership controls access to this organization. Account status is managed separately by administrators in Staff management. Restoring membership does not reactivate a suspended account.</p>
   {error&&<Feedback tone="error">{error}</Feedback>}
   {message&&<p role="status" className="mt-4 border-l-2 border-[#3156a3] pl-3 text-sm">{message}</p>}
   <div className="mt-6 flex gap-6 border-b" aria-label="Access views">
     {(["members","roles",...(overview?.effectivePermissions.includes("audit.read")?["audit"]:[])] as View[]).map(v=><button key={v} type="button" aria-pressed={view===v} onClick={()=>navigate(v)} className={`min-h-11 border-b-2 py-3 text-sm font-semibold ${view===v?"border-[#3156a3] text-[#3156a3]":"border-transparent text-slate-600"}`}>{v==="members"?"Memberships":v==="roles"?"Role templates":"Audit history"}</button>)}
   </div>
   {view==="roles"?overview?<ReviewRoles roles={overview.roles} catalog={overview.catalog} canManage={canManage} onSaved={saved}/>:<p className="py-6 text-sm">Role information is unavailable or loading.</p>:<>
     <div className="flex flex-wrap items-center justify-between gap-3 border-b py-4">
       {view==="members"?<input aria-label="Search members" placeholder="Search name or email" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);setLoading(true);setError("");}} className="w-full max-w-md border border-slate-300 px-3 py-2 text-sm"/>:<p className="text-sm text-slate-500">Recorded membership, permission, staff-status and team changes. Earlier actions were not reconstructed.</p>}
       <button type="button" onClick={()=>{setError("");setLoading(true);setRevision(n=>n+1);}} className="border px-3 py-2 text-xs">Refresh</button>
     </div>
     {loading?<p role="status" className="py-8 text-sm text-slate-500">Loading records…</p>:error?null:view==="members"?members.items.length?<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b bg-slate-50 text-xs text-slate-500"><tr>{["Person","Roles","Account","Membership","Action"].map(h=><th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{members.items.map(m=><tr key={m.id} className="border-b"><td className="p-3"><p className="font-medium">{m.full_name}</p><p className="text-xs text-slate-500">{m.email}</p></td><td className="p-3 text-xs">{m.roles.map(words).join(", ")||"No roles"}</td><td className="p-3 text-xs">{m.account_status}</td><td className="p-3 text-xs">{m.status}</td><td className="p-3">{m.protected||m.user_id===overview?.currentUserId?<span className="text-xs text-slate-500">Protected administrator</span>:canManage?<div className="flex flex-wrap gap-2"><MemberReviewRoles member={m} roles={overview?.roles||[]} onSaved={saved}/><button type="button" onClick={()=>{setActionError("");setPending(m);}} className="border border-slate-300 px-3 py-2 text-xs font-medium">{m.status==="active"?"Suspend access":"Restore access"}</button></div>:<span className="text-xs text-slate-500">Read only</span>}</td></tr>)}</tbody></table></div>:<EmptyState title="No matching memberships" description="Try another search, or add a staff account in Staff management."/>:
       audit.items.length?<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b bg-slate-50 text-xs text-slate-500"><tr>{["Recorded","Actor","Action","Record","Details"].map(h=><th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{audit.items.map(a=><tr key={a.id} className="border-b align-top"><td className="p-3 text-xs whitespace-nowrap">{new Date(a.created_at).toLocaleString("en-GB")}</td><td className="p-3 text-xs">{a.actor_name||"System / migration"}</td><td className="p-3 text-xs">{words(a.action)}</td><td className="p-3 text-xs">{words(a.entity_type)}<span className="mt-1 block text-slate-500">{a.entity_id}</span></td><td className="p-3"><details><summary className="cursor-pointer text-xs text-[#3156a3]">View change</summary><pre className="mt-2 max-w-md whitespace-pre-wrap break-all text-xs">{JSON.stringify({before:a.previous_value,after:a.new_value},null,2)}</pre></details></td></tr>)}</tbody></table></div>:<EmptyState title="No recorded access changes" description="Membership and administration changes recorded from this release will appear here."/>}
     {!loading&&!error&&<Pagination page={rows.page} pageSize={pageSize} total={rows.total} totalPages={Math.max(1,Math.ceil(rows.total/pageSize))} onPage={changePage} onPageSize={changeSize}/>}
   </>}
   <Modal open={!!pending} title={pending?.status==="active"?"Suspend organization access":"Restore organization access"} description={pending?.status==="active"?`Stop ${pending.full_name}'s access on their next request. Their account, jobs and records will remain.`:`Restore ${pending?.full_name}'s membership. Their user account must also be active to sign in.`} onClose={()=>{if(!saving)setPending(null);}}>
     {actionError&&<p role="alert" className="mb-4 text-sm text-red-700">{actionError}</p>}
     <div className="flex justify-end gap-3"><button disabled={saving} onClick={()=>setPending(null)} className="border px-4 py-2 text-sm">Cancel</button><button disabled={saving} onClick={confirm} className="bg-[#3156a3] px-4 py-2 text-sm text-white disabled:opacity-50">{saving?"Saving…":pending?.status==="active"?"Suspend access":"Restore access"}</button></div>
   </Modal>
 </div></AppShell>;
}
