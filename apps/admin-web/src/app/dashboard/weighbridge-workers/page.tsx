"use client";
import {FormEvent,useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {Feedback,Modal,PageHeader,Status} from "@/components/ui/System";
import {apiRequest} from "@/lib/api";

type Worker={id:string;full_name:string;email:string;phone:string|null;status:string;role:string;last_login_at:string|null};
type Result={data:{users:Worker[]}};

export default function WeighbridgeWorkersPage(){
 const[workers,setWorkers]=useState<Worker[]>([]),[open,setOpen]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(""),[formError,setFormError]=useState(""),[message,setMessage]=useState("");
 const load=useCallback(async()=>{try{setError("");const result=await apiRequest<Result>("/api/auth/platform-users");setWorkers(result.data.users.filter(user=>user.role==="weighbridge_operator"))}catch(e){setError(e instanceof Error?e.message:"Could not load weighbridge workers")}},[]);
 useEffect(()=>{void load()},[load]);
 async function create(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,data=new FormData(form);if(data.get("password")!==data.get("confirmation")){setFormError("Passwords do not match");return}try{setSaving(true);setFormError("");await apiRequest("/api/auth/platform-users",{method:"POST",body:JSON.stringify({fullName:data.get("fullName"),email:data.get("email"),phone:data.get("phone")||undefined,password:data.get("password"),role:"weighbridge_operator"})});form.reset();setOpen(false);setMessage("Weighbridge worker account created");await load()}catch(e){setFormError(e instanceof Error?e.message:"Could not create worker") }finally{setSaving(false)}}
 async function changeStatus(worker:Worker){try{setSaving(true);setError("");await apiRequest(`/api/auth/platform-users/${worker.id}/status`,{method:"PATCH",body:JSON.stringify({status:worker.status==="active"?"suspended":"active"})});await load()}catch(e){setError(e instanceof Error?e.message:"Could not update worker") }finally{setSaving(false)}}
 return <AppShell>
  <div className="mx-auto max-w-6xl">
   <PageHeader eyebrow="KCCA access control" title="Weighbridge workers" description="Create restricted KCCA accounts for workers who record official vehicle weights. These accounts cannot access permits, organizations or platform administration." action={<button onClick={()=>{setFormError("");setOpen(true)}} className="bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white">Add worker</button>}/>
   {error&&<Feedback tone="error">{error}</Feedback>}
   {message&&<Feedback tone="success">{message}</Feedback>}
   <div className="mt-7 overflow-x-auto border-y"><table className="w-full min-w-[760px] text-left"><thead><tr><th>Worker</th><th>Phone</th><th>Last login</th><th>Status</th><th className="text-right">Action</th></tr></thead><tbody>{workers.map(worker=><tr key={worker.id}><td><p className="table-primary">{worker.full_name}</p><p className="table-secondary">{worker.email}</p></td><td>{worker.phone||"—"}</td><td>{worker.last_login_at?new Date(worker.last_login_at).toLocaleString("en-GB"):"Never"}</td><td><Status value={worker.status}/></td><td className="text-right"><button disabled={saving} onClick={()=>void changeStatus(worker)} className="border px-3 py-2 text-xs font-semibold">{worker.status==="active"?"Suspend":"Restore"}</button></td></tr>)}{!workers.length&&<tr><td colSpan={5} className="py-10 text-center text-sm text-slate-500">No weighbridge worker accounts yet.</td></tr>}</tbody></table></div>
  </div>
  <Modal open={open} onClose={()=>{if(!saving){setOpen(false);setFormError("")}}} title="Add weighbridge worker" description="This account opens directly into KCCA weighbridge operations.">
   <form onSubmit={create} className="grid gap-4">
    {formError&&<Feedback tone="error">{formError}</Feedback>}
    <Field name="fullName" label="Full name"/>
    <Field name="email" label="Work email" type="email"/>
    <label className="text-sm font-semibold">Phone <span className="font-normal text-slate-500">(optional)</span><input name="phone" type="tel" inputMode="tel" pattern="\+256[0-9]{9}" placeholder="+256782390653" title="Use format +256782390653" className="mt-1 w-full border p-3 font-normal"/><span className="mt-1 block text-xs font-normal text-slate-500">Use the format +256782390653.</span></label>
    <Field name="password" label="Temporary password" type="password"/>
    <Field name="confirmation" label="Confirm password" type="password"/>
    <p className="text-xs text-slate-500">Use at least 12 characters with uppercase, lowercase, a number and a symbol.</p>
    <button disabled={saving} className="bg-[#3156a3] px-4 py-3 font-semibold text-white disabled:opacity-50">{saving?"Creating…":"Create worker account"}</button>
   </form>
  </Modal>
 </AppShell>
}
function Field({name,label,type="text",required=true}:{name:string;label:string;type?:string;required?:boolean}){return <label className="text-sm font-semibold">{label}<input name={name} type={type} required={required} autoComplete={type==="password"?"new-password":undefined} className="mt-1 w-full border p-3 font-normal"/></label>}
