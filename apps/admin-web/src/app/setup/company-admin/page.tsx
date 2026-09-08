"use client";
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiRequest } from '@/lib/api';
export default function CompanyAdminSetup(){
 const [token,setToken]=useState(''),[ready,setReady]=useState(false),[email,setEmail]=useState(''),[name,setName]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
 const captured=useRef<string|null>(null);
 useEffect(()=>{
  if(captured.current===null)captured.current=window.location.hash.slice(1);
  window.history.replaceState(null,'',window.location.pathname);
  // Synchronize the external URL once after hydration; keep capture stable under Strict Mode replay.
  setToken(captured.current);setReady(true);
 },[]);
 async function submit(event:React.FormEvent){event.preventDefault();setError('');if(password!==confirmation){setError('The passwords do not match.');return;}setBusy(true);try{
  await apiRequest('/api/auth/organization-onboarding/accept',{method:'POST',body:JSON.stringify({token,email,fullName:name,password})});setDone(true);captured.current='';setToken('');setPassword('');setConfirmation('');
 }catch(e){setError(e instanceof Error?e.message:'Could not complete setup.');}finally{setBusy(false);}}
 return <main className="min-h-screen bg-[#f7f7f5] px-5 py-16 text-slate-900"><section className="mx-auto max-w-md border-t-2 border-[#3156a3] bg-white p-7"><p className="text-xs font-semibold text-[#3156a3]">Kampala WMS</p><h1 className="mt-3 text-2xl font-semibold">Set up your company account</h1>
  {done?<div role="status" className="mt-5"><p>Your administrator account is ready.</p><Link href="/login" className="mt-5 inline-block text-[#3156a3] underline">Continue to sign in</Link></div>:!ready?<p className="mt-5">Loading setup…</p>:!token?<p className="mt-5 text-sm">Open the setup link shared by your administrator. If you refreshed this page, reopen the original link.</p>:<form onSubmit={submit} className="mt-5 space-y-4"><p className="text-sm text-slate-600">Use the invited email address and choose your own password.</p>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}<label className="block text-sm">Full name<input required minLength={2} maxLength={150} autoComplete="name" value={name} onChange={e=>setName(e.target.value)} className="mt-1 w-full border p-2"/></label><label className="block text-sm">Invited email<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 w-full border p-2"/></label><label className="block text-sm">Password (12–72 characters)<input required type="password" minLength={12} maxLength={72} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} className="mt-1 w-full border p-2"/></label><label className="block text-sm">Confirm password<input required type="password" autoComplete="new-password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} className="mt-1 w-full border p-2"/></label><button disabled={busy} className="w-full bg-[#3156a3] px-4 py-3 text-sm text-white disabled:opacity-50">{busy?'Creating account…':'Create administrator account'}</button></form>}
 </section></main>;
}
