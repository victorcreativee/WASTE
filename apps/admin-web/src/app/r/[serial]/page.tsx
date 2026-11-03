"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {useParams} from "next/navigation";
import {apiRequest} from "@/lib/api";
import {PublicReceipt,dateTime,kg} from "@/lib/receipts";

// The page a receipt SMS links to. Anyone with the number can check it is genuine; the phone number is never shown
// and the household's name is shortened.
export default function ReceiptPage(){
  const {serial}=useParams<{serial:string}>();
  const [receipt,setReceipt]=useState<PublicReceipt|null>(null),[error,setError]=useState("");
  useEffect(()=>{
    let cancelled=false;
    apiRequest<{data:PublicReceipt}>(`/api/waste/public/receipts/${encodeURIComponent(serial)}`)
      .then(r=>{if(!cancelled)setReceipt(r.data)})
      .catch(e=>{if(!cancelled)setError(e instanceof Error&&/No receipt/.test(e.message)?"No receipt has this number. Check the number, or treat the receipt as not genuine.":"The receipt could not be checked right now. Try again shortly.")});
    return()=>{cancelled=true};
  },[serial]);

  const verdict=!receipt?null:!receipt.intact?{title:"Receipt record altered",tone:"border-red-200 bg-red-50 text-red-900",text:"This receipt no longer matches the record made when it was issued. Report it to KCCA."}
    :receipt.status==="voided"?{title:"Receipt voided",tone:"border-amber-200 bg-amber-50 text-amber-900",text:`The collection company cancelled this receipt on ${dateTime(receipt.voided_at)}: ${receipt.void_reason}`}
    :{title:"Genuine receipt",tone:"border-green-200 bg-green-50 text-green-900",text:"This collection is recorded in the KCCA receipt ledger."};

  return <main className="min-h-screen bg-[var(--background)] print:bg-white">
    <header className="border-b border-slate-200 bg-white print:hidden"><div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4"><Link href="/" className="text-sm font-semibold text-slate-900">Kampala Smart Waste</Link><span className="text-xs text-slate-500">Collection receipt</span></div></header>
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Waste collection receipt</h1>
      <p className="mt-1 font-mono text-[15px] text-slate-600">{serial}</p>
      {error&&<div role="alert" className="feedback feedback-error mt-6"><div>{error}</div></div>}
      {!receipt&&!error&&<p className="mt-6 text-sm text-slate-500">Checking the receipt…</p>}
      {receipt&&verdict&&<section className="mt-6 overflow-hidden rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white">
        <div className={`border-b px-5 py-4 ${verdict.tone}`}><p className="font-semibold">{verdict.title}</p><p className="mt-0.5 text-sm">{verdict.text}</p></div>
        <dl className="grid gap-x-6 gap-y-4 px-5 py-5 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-medium text-slate-500">Collection company</dt><dd className="mt-1 font-medium text-slate-900">{receipt.company_name}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Collected</dt><dd className="mt-1">{dateTime(receipt.collected_at)}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Household</dt><dd className="mt-1">{receipt.customer_name}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Location</dt><dd className="mt-1">{receipt.location_label}{receipt.zone_name?`, ${receipt.zone_name}`:""}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Weight</dt><dd className="mt-1">{receipt.collected_weight_kg===null?"Not weighed":kg(receipt.collected_weight_kg)}</dd></div>
          <div><dt className="text-xs font-medium text-slate-500">Vehicle</dt><dd className="mt-1 font-mono">{receipt.truck_plate||"—"}</dd></div>
        </dl>
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          <span>Issued {dateTime(receipt.issued_at)} (Kampala time)</span>
          <button onClick={()=>window.print()} className="border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 print:hidden">Print or save as PDF</button>
        </div>
      </section>}
      <p className="mt-6 text-xs leading-5 text-slate-500 print:hidden">Licensed waste collectors in Kampala must give an electronic receipt for every collection. If you were charged for a collection that did not happen, or a receipt looks wrong, raise it with your collection company or KCCA.</p>
    </div>
  </main>;
}
