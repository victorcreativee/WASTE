"use client";

import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState, Feedback, PageHeader } from "@/components/ui/System";
import { apiRequest } from "@/lib/api";

type Daily={date:string;purchases:number;purchased_kg:string;sales:number;sold_kg:string;sales_value_ugx:string};
type Report={
  organizationType:string|null;
  workforce:{records:number;present:number;late:number;absent:number};
  finance:{received:string;operating_expenses:string;supplier_payments:string};
  recycling:{purchases:number;purchased_kg:string;purchase_cost_ugx:string;sorting_batches:number;sorted_output_kg:string;rejected_kg:string;sales:number;sold_kg:string;sales_value_ugx:string;float_given_ugx:string;float_spent_ugx:string};
  recyclingDaily:Daily[];
};

const money=(value:string|number)=>`UGX ${Number(value||0).toLocaleString("en-UG")}`;
const percentage=(part:number,total:number)=>total?Math.round(part/total*100):0;

export default function RecyclingReportsPage(){
  const now=new Date();
  const [from,setFrom]=useState(()=>new Date(now.getFullYear(),now.getMonth(),1).toISOString().slice(0,10));
  const [to,setTo]=useState(()=>now.toISOString().slice(0,10));
  const [report,setReport]=useState<Report|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");

  async function load(start=from,end=to){
    try{setLoading(true);setError("");const result=await apiRequest<{data:Report}>(`/api/waste/reports/organization?from=${start}&to=${end}`);if(result.data.organizationType!=="recycling_company")throw new Error("This report is available only to recycling companies.");setReport(result.data)}
    catch(cause){setError(cause instanceof Error?cause.message:"Could not load recycling report")}
    finally{setLoading(false)}
  }
  useEffect(()=>{void load()},[]);// eslint-disable-line react-hooks/exhaustive-deps

  function applyRange(event:FormEvent){event.preventDefault();void load()}
  function exportCsv(){
    if(!report)return;
    const rows=[["Date","Purchases","Purchased kg","Sales","Sold kg","Sales value UGX"],...report.recyclingDaily.map(item=>[item.date,item.purchases,item.purchased_kg,item.sales,item.sold_kg,item.sales_value_ugx])];
    const csv=rows.map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(",")).join("\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"})),anchor=document.createElement("a");
    anchor.href=url;anchor.download=`recycling-operations-${from}-${to}.csv`;anchor.click();URL.revokeObjectURL(url);
  }

  const attendance=report?percentage(report.workforce.present+report.workforce.late,report.workforce.records):0;
  const recovery=report?percentage(Number(report.recycling.sorted_output_kg),Number(report.recycling.sorted_output_kg)+Number(report.recycling.rejected_kg)):0;
  return <AppShell><div className="mx-auto max-w-7xl">
    <PageHeader eyebrow="Recycling insights" title="Operational performance" description="Review material purchasing, sorting, sales, field money and workforce outcomes for a selected period." action={<button disabled={!report} onClick={exportCsv} className="border border-[#3156a3] px-4 py-2.5 text-sm font-semibold text-[#3156a3] disabled:opacity-40">Export CSV</button>}/>
    {error&&<Feedback tone="error">{error}</Feedback>}
    <form onSubmit={applyRange} className="mt-6 flex flex-wrap items-end gap-3 border-y bg-white py-4"><DateField label="From" value={from} set={setFrom}/><DateField label="To" value={to} set={setTo}/><button disabled={loading} className="bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{loading?"Loading…":"Apply range"}</button></form>
    {report&&<>
      <section className="mt-8 grid border-y sm:grid-cols-2 xl:grid-cols-4"><Metric label="Material received" value={`${Number(report.recycling.purchased_kg).toLocaleString()} kg`} help={`${report.recycling.purchases} purchases`}/><Metric label="Saleable output" value={`${Number(report.recycling.sorted_output_kg).toLocaleString()} kg`} help={`${recovery}% sorting recovery`}/><Metric label="Material sold" value={`${Number(report.recycling.sold_kg).toLocaleString()} kg`} help={`${report.recycling.sales} sales`}/><Metric label="Workforce attendance" value={`${attendance}%`} help={`${report.workforce.absent} absences`}/></section>
      <section className="mt-8 grid gap-8 lg:grid-cols-2"><Block title="Material operations"><Row label="Purchase transactions" value={report.recycling.purchases}/><Row label="Purchased material" value={`${Number(report.recycling.purchased_kg).toLocaleString()} kg`}/><Row label="Sorting batches" value={report.recycling.sorting_batches}/><Row label="Saleable sorted output" value={`${Number(report.recycling.sorted_output_kg).toLocaleString()} kg`}/><Row label="Rejected material" value={`${Number(report.recycling.rejected_kg).toLocaleString()} kg`}/><Row label="Sales transactions" value={report.recycling.sales}/></Block><Block title="Field money and trade"><Row label="Material purchase cost" value={money(report.recycling.purchase_cost_ugx)}/><Row label="Sales value" value={money(report.recycling.sales_value_ugx)}/><Row label="Field float allocated" value={money(report.recycling.float_given_ugx)}/><Row label="Field float used" value={money(report.recycling.float_spent_ugx)}/><Row label="Confirmed receipts" value={money(report.finance.received)}/><Row label="Operating expenses" value={money(report.finance.operating_expenses)}/></Block></section>
      <section className="mt-8"><div className="border-b pb-3"><h2 className="text-xl font-semibold">Daily recycling activity</h2><p className="mt-1 text-sm text-slate-500">Purchases and sales recorded by operating date.</p></div>{report.recyclingDaily.length?<div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b"><tr><th className="p-3">Date</th><th className="text-right">Purchases</th><th className="text-right">Received</th><th className="text-right">Sales</th><th className="text-right">Sold</th><th className="pr-3 text-right">Sales value</th></tr></thead><tbody className="divide-y">{report.recyclingDaily.map(item=><tr key={item.date}><td className="p-3 font-semibold">{new Date(`${item.date}T00:00:00`).toLocaleDateString("en-GB")}</td><td className="text-right">{item.purchases}</td><td className="text-right">{Number(item.purchased_kg).toLocaleString()} kg</td><td className="text-right">{item.sales}</td><td className="text-right">{Number(item.sold_kg).toLocaleString()} kg</td><td className="pr-3 text-right font-semibold">{money(item.sales_value_ugx)}</td></tr>)}</tbody></table></div>:<EmptyState title="No recycling activity in this period" description="Choose another date range or begin recording material purchases and sales."/>}</section>
    </>}
  </div></AppShell>;
}

function DateField({label,value,set}:{label:string;value:string;set:(value:string)=>void}){return <label className="text-sm font-semibold">{label}<input type="date" value={value} onChange={event=>set(event.target.value)} className="mt-1 block border px-3 py-2"/></label>}
function Metric({label,value,help}:{label:string;value:string;help:string}){return <div className="border-b py-5 pr-5 sm:border-r xl:border-b-0"><p className="text-sm font-semibold text-slate-500">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p><p className="mt-1 text-xs text-slate-500">{help}</p></div>}
function Block({title,children}:{title:string;children:React.ReactNode}){return <section className="border-t-2 border-[#3156a3]"><h2 className="border-b py-3 text-lg font-semibold">{title}</h2><dl>{children}</dl></section>}
function Row({label,value}:{label:string;value:string|number}){return <div className="flex justify-between gap-5 border-b py-3 text-sm"><dt className="text-slate-500">{label}</dt><dd className="font-semibold">{value}</dd></div>}
