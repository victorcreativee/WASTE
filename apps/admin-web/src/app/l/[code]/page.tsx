"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {useParams} from "next/navigation";
import {apiRequest} from "@/lib/api";
import {dateTime,kg} from "@/lib/receipts";

type Certificate={certificate_number:string;verification_code:string;organization_name:string;ticket_number:string;facility_name:string;facility_kind:string;
  registration:string;operation_date:string;gross_kg:string;tare_kg:string;net_kg:string;issued_at:string;revoked_at:string|null;revoked_reason:string|null;
  composition:{name:string;share_pct:number}[]|null;composition_method:string|null;intact:boolean};
const KIND:Record<string,string>={landfill:"Landfill disposal",transfer_station:"Transfer station",composting:"Composting, diverted from landfill",materials_recovery:"Materials recovery, diverted from landfill"};

// The page a load certificate's QR code opens. Shows the weighed load as KCCA holds it today.
export default function LoadCertificatePage(){
  const {code}=useParams<{code:string}>();
  const [certificate,setCertificate]=useState<Certificate|null>(null),[error,setError]=useState("");
  useEffect(()=>{
    let cancelled=false;
    apiRequest<{data:Certificate}>(`/api/waste/public/load-certificates/${encodeURIComponent(code)}`)
      .then(r=>{if(!cancelled)setCertificate(r.data)})
      .catch(e=>{if(!cancelled)setError(e instanceof Error&&/No load certificate/.test(e.message)?"No load certificate has this code. Check the code, or treat the certificate as not genuine.":"The certificate could not be checked right now. Try again shortly.")});
    return()=>{cancelled=true};
  },[code]);

  const c=certificate,verdict=!c?null:!c.intact?{title:"Certificate record altered",tone:"border-red-200 bg-red-50 text-red-900",text:"This certificate no longer matches the record made when it was issued. Report it to KCCA."}
    :c.revoked_at?{title:"Certificate revoked",tone:"border-amber-200 bg-amber-50 text-amber-900",text:`KCCA voided the weighbridge ticket on ${dateTime(c.revoked_at)}: ${c.revoked_reason}`}
    :{title:"Genuine load certificate",tone:"border-green-200 bg-green-50 text-green-900",text:"This load was weighed at a KCCA facility and is in the weighbridge record."};

  return <main className="min-h-screen bg-[var(--background)] print:bg-white">
    <header className="border-b border-slate-200 bg-white print:hidden"><div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4"><Link href="/" className="text-sm font-semibold text-slate-900">Kampala Smart Waste</Link><span className="text-xs text-slate-500">Load certificate</span></div></header>
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Load certificate</h1>
      <p className="mt-1 font-mono text-[15px] text-slate-600">{c?.certificate_number??code}</p>
      {error&&<div role="alert" className="feedback feedback-error mt-6"><div>{error}</div></div>}
      {!c&&!error&&<p className="mt-6 text-sm text-slate-500">Checking the certificate…</p>}
      {c&&verdict&&<section className="mt-6 overflow-hidden rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white">
        <div className={`border-b px-5 py-4 ${verdict.tone}`}><p className="font-semibold">{verdict.title}</p><p className="mt-0.5 text-sm">{verdict.text}</p></div>
        <dl className="grid gap-x-6 gap-y-4 px-5 py-5 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-medium text-slate-500">Waste company</dt><dd className="mt-1 font-medium text-slate-900">{c.organization_name}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Date</dt><dd className="mt-1">{new Date(`${c.operation_date}T00:00:00`).toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"})}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Facility</dt><dd className="mt-1">{c.facility_name}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Destination</dt><dd className="mt-1">{KIND[c.facility_kind]??c.facility_kind}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Weighbridge ticket</dt><dd className="mt-1 font-mono">{c.ticket_number}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Vehicle</dt><dd className="mt-1 font-mono">{c.registration}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Gross / tare</dt><dd className="mt-1 tabular-nums">{kg(c.gross_kg)} / {kg(c.tare_kg)}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Net waste received</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-slate-950">{kg(c.net_kg)}</dd></div>
        </dl>
        <div className="border-t border-slate-100 px-5 py-4 text-sm">
          <p className="text-xs font-medium text-slate-500">Composition{c.composition_method?` · ${c.composition_method==="sample_sort"?"sorted sample":"visual estimate"}`:""}</p>
          {c.composition?.length?<ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">{c.composition.map(s=><li key={s.name} className="flex justify-between"><span>{s.name}</span><span className="tabular-nums">{Number(s.share_pct)}%</span></li>)}</ul>
            :<p className="mt-1 text-slate-600">Not recorded for this load.</p>}
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          <span>Issued {dateTime(c.issued_at)} (Kampala time)</span>
          <button onClick={()=>window.print()} className="border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 print:hidden">Print or save as PDF</button>
        </div>
      </section>}
      <p className="mt-6 text-xs leading-5 text-slate-500 print:hidden">Every load weighed at a KCCA disposal facility gets a load certificate. The figures above come from the weighbridge record, so a voided ticket shows as revoked even on an older printed copy.</p>
    </div>
  </main>;
}
