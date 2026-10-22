"use client";
import {Suspense,useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
import {apiRequest} from "@/lib/api";

type Verification={verification_code:string;company_name:string;permit_number:string;status:string;valid_from:string|null;valid_until:string|null;activities:string[];divisions:string[];checked_on:string};

const date=(v:string|null)=>v?new Date(`${v}T00:00:00`).toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"}):"No expiry";
const VERDICT:Record<string,{title:string;tone:string;text:string}>={
  approved:{title:"Valid permit",tone:"border-green-200 bg-green-50 text-green-900",text:"This company holds a KCCA permit that is in force today."},
  expired:{title:"Permit expired",tone:"border-red-200 bg-red-50 text-red-900",text:"This permit is no longer valid. The company is not currently authorized by KCCA."},
  suspended:{title:"Permit suspended",tone:"border-red-200 bg-red-50 text-red-900",text:"KCCA has suspended this permit. The company may not operate until it is reinstated."},
};

function VerifyForm(){
  const params=useSearchParams();
  const [code,setCode]=useState(params.get("code")||""),[result,setResult]=useState<Verification|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false);

  const check=useCallback(async(value:string)=>{
    setError("");setResult(null);
    if(value.replace(/[^0-9a-f]/gi,"").length!==12){setError("Enter the 12-character code printed on the certificate, for example 7F3A-91C2-B04E.");return;}
    setLoading(true);
    try{setResult((await apiRequest<{data:Verification}>(`/api/waste/public/permit-verification/${encodeURIComponent(value.trim())}`)).data)}
    catch(e){setError(e instanceof Error&&/match/.test(e.message)?"No KCCA permit matches this code. Check the code, or treat the certificate as not genuine.":e instanceof Error?e.message:"Verification is unavailable right now")}
    finally{setLoading(false)}
  },[]);

  useEffect(()=>{const initial=params.get("code");if(initial){const timer=window.setTimeout(()=>void check(initial),0);return()=>window.clearTimeout(timer);}},[params,check]);

  const verdict=result&&(VERDICT[result.status]||{title:"Not in force",tone:"border-red-200 bg-red-50 text-red-900",text:"This permit is not currently in force."});

  return <>
    <form onSubmit={e=>{e.preventDefault();void check(code)}} className="mt-8 flex flex-col gap-2 sm:flex-row">
      <label htmlFor="code" className="sr-only">Verification code</label>
      <input id="code" value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} className="w-full rounded-[var(--ui-radius)] border border-slate-300 px-3.5 py-2.5 font-mono text-base tracking-wider sm:max-w-xs"/>
      <button disabled={loading} className="bg-[var(--color-action)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{loading?"Checking…":"Verify"}</button>
    </form>
    {error&&<div role="alert" className="feedback feedback-error mt-6"><div>{error}</div></div>}
    {result&&verdict&&<section className="mt-8 overflow-hidden rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white">
      <div className={`border-b px-5 py-4 ${verdict.tone}`}><p className="font-semibold">{verdict.title}</p><p className="mt-0.5 text-sm">{verdict.text}</p></div>
      <dl className="grid gap-x-6 gap-y-4 px-5 py-5 text-sm sm:grid-cols-2">
        <div><dt className="text-xs font-medium text-slate-500">Company</dt><dd className="mt-1 font-medium text-slate-900">{result.company_name}</dd></div>
        <div><dt className="text-xs font-medium text-slate-500">Permit number</dt><dd className="mt-1">{result.permit_number}</dd></div>
        <div><dt className="text-xs font-medium text-slate-500">Valid from</dt><dd className="mt-1">{date(result.valid_from)}</dd></div>
        <div><dt className="text-xs font-medium text-slate-500">Valid until</dt><dd className="mt-1">{date(result.valid_until)}</dd></div>
        <div className="sm:col-span-2"><dt className="text-xs font-medium text-slate-500">Authorized activities</dt><dd className="mt-1">{result.activities.join(", ")||"Not recorded"}</dd></div>
        <div className="sm:col-span-2"><dt className="text-xs font-medium text-slate-500">Divisions</dt><dd className="mt-1">{result.status==="approved"?result.divisions.join(", ")||"None assigned yet":"None while the permit is not in force"}</dd></div>
      </dl>
      <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Checked against the KCCA register on {date(result.checked_on)} · code {result.verification_code}</p>
    </section>}
  </>;
}

export default function VerifyPermitPage(){
  return <main className="min-h-screen bg-[var(--background)]">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4"><Link href="/" className="text-sm font-semibold text-slate-900">Kampala Smart Waste</Link><span className="text-xs text-slate-500">KCCA permit register</span></div></header>
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Verify a waste management permit</h1>
      <p className="mt-2 text-[15px] leading-6 text-slate-600">Enter the verification code from a KCCA permit certificate, or scan its QR code. The result reflects the permit&rsquo;s status today, not the date it was printed.</p>
      <Suspense fallback={null}><VerifyForm/></Suspense>
    </div>
  </main>;
}
