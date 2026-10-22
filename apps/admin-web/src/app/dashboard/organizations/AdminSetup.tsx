"use client";
import { useState } from 'react';
import { Modal } from '@/components/ui/System';
import { apiRequest } from '@/lib/api';
type Invite={expired:boolean;id:string;email:string;expires_at:string;accepted_at:string|null;revoked_at:string|null};
type Setup={hasAdministrator:boolean;invitations:Invite[]};
export function AdminSetup({organization}:{organization:{id:string;name:string}}){
 const [open,setOpen]=useState(false),[data,setData]=useState<Setup|null>(null),[email,setEmail]=useState(''),[link,setLink]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const path=`/api/auth/organization-onboarding/${organization.id}`;
 async function load(){setBusy(true);setError('');try{setData((await apiRequest<{data:Setup}>(path)).data);}catch(e){setData(null);setError(e instanceof Error?e.message:'Could not load onboarding.');}finally{setBusy(false);}}
 async function issue(event:React.FormEvent){event.preventDefault();setBusy(true);setError('');setLink('');try{
  const result=await apiRequest<{data:{token:string}}>(path+'/invitations',{method:'POST',body:JSON.stringify({email})});
  setLink(`${window.location.origin}/setup/company-admin#${result.data.token}`);setEmail('');setNotice('Link created. It expires in 24 hours. No email has been sent.');await load();
 }catch(e){setError(e instanceof Error?e.message:'Could not issue setup link.');}finally{setBusy(false);}}
 async function revoke(id:string){setBusy(true);setError('');try{await apiRequest(path+'/invitations/'+id,{method:'DELETE'});setLink('');setNotice('Invitation revoked.');await load();}catch(e){setError(e instanceof Error?e.message:'Could not revoke invitation.');}finally{setBusy(false);}}
 return <><button type="button" className="border px-3 py-2 text-xs" onClick={()=>{setOpen(true);setLink('');setEmail('');setNotice('');void load();}}>Administrator setup</button>
  <Modal open={open} title={`Administrator setup · ${organization.name}`} description="For the first company administrator only. Existing accounts are never replaced." onClose={()=>{if(!busy){setOpen(false);setLink('');}}}>
   {error&&<p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="mb-4 text-sm">{notice}</p>}
   {busy&&<p role="status" className="text-sm">Working…</p>}
   {data?.hasAdministrator?<p className="text-sm">An administrator already exists. Contact the system administrator for account recovery; first-admin setup is unavailable.</p>:data&&<form onSubmit={issue} className="space-y-4"><label className="block text-sm">New administrator email<input type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} className="mt-2 block w-full border p-2"/></label><p className="text-xs text-slate-600">Issuing a new link revokes any previous pending link. Share it only with the intended administrator through a trusted channel. Anyone holding the link and invited email can set up this account.</p><button disabled={busy} className="bg-[var(--color-action)] px-4 py-2 text-sm text-white disabled:opacity-50">Issue 24-hour setup link</button></form>}
   {link&&<div className="mt-5"><label className="block text-sm">Copy this link before closing<input readOnly value={link} onFocus={e=>e.currentTarget.select()} className="mt-2 w-full border p-2 text-xs"/></label><button type="button" className="mt-2 border px-3 py-2 text-xs" onClick={()=>navigator.clipboard.writeText(link).then(()=>setNotice('Copied. Share only with the intended administrator.')).catch(()=>setError('Copy failed. Select the link and copy it manually.'))}>Copy link</button></div>}
   {!!data?.invitations.length&&<div className="mt-6 overflow-x-auto"><p className="mb-2 text-xs text-slate-500">Latest 10 invitations</p><table className="w-full text-left text-xs"><thead><tr><th className="py-2">Email</th><th>State</th><th>Action</th></tr></thead><tbody>{data.invitations.map(i=><tr key={i.id} className="border-t"><td className="py-3">{i.email}</td><td>{i.accepted_at?'Accepted':i.revoked_at?'Revoked':i.expired?'Expired':'Pending'}</td><td>{!i.accepted_at&&!i.revoked_at&&<button disabled={busy} onClick={()=>void revoke(i.id)} className="border px-2 py-1">Revoke</button>}</td></tr>)}</tbody></table></div>}
  </Modal>
 </>;
}
