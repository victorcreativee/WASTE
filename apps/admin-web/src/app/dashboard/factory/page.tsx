"use client";
import {useCallback,useEffect,useState} from "react";
import Link from "next/link";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader,SectionHeading} from "@/components/ui/System";
import {IntakeForm} from "@/components/factory/IntakeForm";
import {apiRequest} from "@/lib/api";
import {Batch,Delivery,Intake,day,kg,materialLabel} from "@/lib/factory";

type Overview={stock:Array<{material_category:string;kg:number;intakes:number}>;month:Record<string,number|null>;expected_deliveries:Delivery[];recent_intakes:Intake[];recent_batches:Batch[]};

export default function FactoryOverviewPage(){
  const [data,setData]=useState<Overview|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[receiving,setReceiving]=useState<Delivery|null>(null);
  const load=useCallback(async()=>{try{setData((await apiRequest<{data:Overview}>("/api/waste/factory/overview")).data)}catch(e){setError(e instanceof Error?e.message:"Could not load the factory overview")}},[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);

  const m=data?.month;
  const figures:Array<[string,string]>=m?[["Accepted",kg(m.accepted_kg)],["Rejected at the gate",kg(m.rejected_kg)],["Processed",kg(m.input_kg)],["Product output",kg(m.output_kg)],["Yield",m.yield_rate===null?"—":`${m.yield_rate}%`],["Residue",kg(m.residue_kg)],["Dispatched",kg(m.dispatched_kg)]]:[];
  const maxStock=Math.max(1,...(data?.stock||[]).map(s=>s.kg));

  return <AppShell><div className="mx-auto max-w-6xl space-y-8">
    <PageHeader eyebrow="Recycling factory" title="Factory overview" description="Material coming in, stock waiting to be processed, and this month's output."
      action={<Link href="/dashboard/factory/intake" className="bg-[var(--color-action)] px-3 py-2 text-sm font-semibold text-white">Record intake</Link>}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}

    {m&&<section><SectionHeading title="This month"/>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--ui-radius-lg)] border border-slate-200 bg-slate-200 sm:grid-cols-4 lg:grid-cols-7">
        {figures.map(([label,value])=><div key={label} className="bg-white px-4 py-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{value}</dd></div>)}
      </dl>
    </section>}

    {data&&<section>
      <SectionHeading title="Expected deliveries" description="Sales licensed recyclers recorded to this factory, waiting to be received."/>
      {data.expected_deliveries.length?<div className="table-wrap"><table className="w-full text-left"><thead><tr><th>From</th><th>Material</th><th className="text-right">Sold</th><th>Sold on</th><th/></tr></thead><tbody>
        {data.expected_deliveries.map(d=><tr key={d.sale_id}>
          <td><p className="table-primary">{d.seller_name}</p>{d.invoice_number&&<p className="table-secondary">Invoice {d.invoice_number}</p>}</td>
          <td>{d.material_type}<p className="table-secondary">{materialLabel(d.material_category)}</p></td>
          <td className="text-right tabular-nums">{kg(d.sold_kg)}</td>
          <td>{day(d.sold_on)}{d.state==="overdue"&&<p className="table-secondary text-[var(--color-warning)]">Over 7 days — KCCA sees this as overdue</p>}</td>
          <td className="text-right"><button onClick={()=>setReceiving(d)} className="bg-[var(--color-action)] px-3 py-2 text-xs font-semibold text-white">Receive</button></td>
        </tr>)}
      </tbody></table></div>:<EmptyState title="No deliveries on the way" description="When a licensed recycler records a sale to this factory, it appears here to be received."/>}
    </section>}

    {data&&<div className="grid gap-8 lg:grid-cols-2">
      <section><SectionHeading title="Stock waiting to be processed"/>
        {data.stock.length?<ul className="card divide-y divide-slate-100">{data.stock.map(s=><li key={s.material_category} className="px-5 py-3">
          <div className="flex justify-between text-sm"><span className="font-medium text-slate-900">{materialLabel(s.material_category)}</span><span className="tabular-nums">{kg(s.kg)}</span></div>
          <div className="mt-2 h-1.5 bg-slate-100"><div className="h-full bg-[var(--color-action)]" style={{width:`${s.kg/maxStock*100}%`}}/></div>
          <p className="mt-1 text-xs text-slate-500">{s.intakes} intake{s.intakes===1?"":"s"} with material remaining</p>
        </li>)}</ul>:<EmptyState title="No unprocessed stock"/>}
      </section>
      <section><SectionHeading title="Recent processing" action={<Link href="/dashboard/factory/processing" className="text-sm font-medium text-[var(--color-action)] hover:underline">All batches →</Link>}/>
        {data.recent_batches.length?<ul className="card divide-y divide-slate-100">{data.recent_batches.map(b=><li key={b.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
          <div><p className="font-medium text-slate-900">{b.product_name}</p><p className="text-xs text-slate-500">{b.batch_number} · {day(b.processed_on)}</p></div>
          <div className="text-right tabular-nums"><p>{kg(b.output_kg)} from {kg(b.input_kg)}</p><p className="text-xs text-slate-500">{b.yield_rate===null?"—":`${b.yield_rate}% yield`}</p></div>
        </li>)}</ul>:<EmptyState title="No batches yet"/>}
      </section>
    </div>}

    <Modal open={!!receiving} onClose={()=>setReceiving(null)} title="Receive delivery" description="Weigh what actually arrived. Any difference from the sold weight is recorded for KCCA.">
      {receiving&&<IntakeForm key={receiving.sale_id} delivery={receiving} onDone={message=>{setReceiving(null);setNotice(message);void load()}}/>}
    </Modal>
  </div></AppShell>;
}
