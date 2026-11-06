"use client";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {ExcelExportButton} from "@/components/reports/ExcelExportButton";
import {Pager,usePagination} from "@/components/ui/Pagination";
import {EmptyState,Feedback,PageHeader,Stat} from "@/components/ui/System";
import {apiRequest} from "@/lib/api";

type Day={date:string;purchases:number;purchasedKg:number;purchaseUgx:number;sales:number;soldKg:number;salesUgx:number;floatGivenUgx:number;floatSpentUgx:number;floatReturnedUgx:number;sortedKg:number;sortingWasteKg:number};
type Purchase={id:string;date:string;material:string;supplier:string;reference:string|null;quantity_kg:number;price_ugx:number;total_ugx:number;payment:string};
type Sale={id:string;date:string;material:string;buyer:string;invoice:string|null;delivered_kg:number;paid_kg:number;price_ugx:number;revenue_ugx:number;received_ugx:number;balance_ugx:number};
type FloatRow={id:string;date:string;type:string;amount_ugx:number;balance_ugx:number;reference:string|null;linked_to:string;notes:string|null;recorded_by:string|null};
type Sorting={id:string;date:string;input_material:string;output_material:string;input_kg:number;output_kg:number;rejected_kg:number;cost_ugx:number;inputStockKg:number;outputStockKg:number};
type Activity={days:Day[];purchases:Purchase[];sales:Sale[];float:FloatRow[];sorting:Sorting[]};
type Tab="days"|"purchases"|"sales"|"float"|"sorting";

const kampalaDay=(offsetDays=0)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Kampala"}).format(new Date(Date.now()+offsetDays*86400000));
const number=(value:number)=>Math.round(value*100)/100;
const kg=(value:number)=>`${number(value).toLocaleString("en-GB")} kg`;
const ugx=(value:number)=>`UGX ${Math.round(value).toLocaleString("en-GB")}`;
const dayName=(value:string)=>new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});
const sum=<T,>(rows:T[],value:(row:T)=>number)=>rows.reduce((total,row)=>total+value(row),0);
const field="mt-1 block border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal";
const right="text-right tabular-nums";
const head="text-right!";

function Table({minWidth,headers,children}:{minWidth:number;headers:[string,boolean?][];children:React.ReactNode}){
  return <table className="w-full text-left" style={{minWidth}}><thead><tr>{headers.map(([label,numeric])=><th key={label} className={numeric?head:""}>{label}</th>)}</tr></thead><tbody>{children}</tbody></table>;
}

export default function RecyclingDailyPage(){
  const [from,setFrom]=useState(()=>kampalaDay()),[to,setTo]=useState(()=>kampalaDay()),[tab,setTab]=useState<Tab>("days");
  const [data,setData]=useState<Activity|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true);
  const load=useCallback(async(start:string,end:string)=>{
    if(!start||!end||start>end){setError("The start date must be on or before the end date.");return}
    try{setLoading(true);setError("");setData((await apiRequest<{data:Activity}>(`/api/waste/reports/daily-records?from=${start}&to=${end}`)).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load the daily records")}finally{setLoading(false)}
  },[]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(kampalaDay(),kampalaDay()),0);return()=>window.clearTimeout(timer)},[load]);
  function choose(start:string,end:string){setFrom(start);setTo(end);void load(start,end)}
  const days=usePagination(data?.days??[]),purchases=usePagination(data?.purchases??[]),sales=usePagination(data?.sales??[]),float=usePagination(data?.float??[]),sorting=usePagination(data?.sorting??[]);
  const tabs:[Tab,string,number][]=[["days","Day totals",data?.days.length??0],["purchases","Purchases",data?.purchases.length??0],["sales","Sales",data?.sales.length??0],["float","Floating",data?.float.length??0],["sorting","Sorting",data?.sorting.length??0]];
  const empty=(what:string)=><EmptyState title={`No ${what} in this period`} description="Choose another date or a wider range."/>;

  return <AppShell><div className="mx-auto max-w-[1200px] space-y-5">
    <PageHeader eyebrow="Insights" title="Daily records" description="Choose a day or a date range to see purchases, sales, floating and sorting separately." action={<ExcelExportButton report="reports/daily-records" from={from} to={to} disabled={!data||loading||from>to}/>}/>
    <section className="flex flex-wrap items-end gap-3 border border-slate-200 bg-white p-4">
      <label className="text-sm font-medium">From<input type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)} className={field}/></label>
      <label className="text-sm font-medium">To<input type="date" value={to} min={from} max={kampalaDay()} onChange={e=>setTo(e.target.value)} className={field}/></label>
      <button onClick={()=>void load(from,to)} disabled={loading} className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{loading?"Loading…":"Show"}</button>
      <div className="flex flex-wrap gap-2">{([["Today",0,0],["Yesterday",-1,-1],["Last 7 days",-6,0],["Last 30 days",-29,0]] as const).map(([label,start,end])=><button key={label} onClick={()=>choose(kampalaDay(start),kampalaDay(end))} className="border border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-700">{label}</button>)}</div>
    </section>
    {error&&<Feedback tone="error">{error}</Feedback>}
    {data&&<>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Purchases" value={ugx(sum(data.purchases,row=>row.total_ugx))} hint={kg(sum(data.purchases,row=>row.quantity_kg))}/>
        <Stat label="Sales" value={ugx(sum(data.sales,row=>row.revenue_ugx))} hint={`${kg(sum(data.sales,row=>row.paid_kg))} paid for`}/>
        <Stat label="Float spent" value={ugx(sum(data.float.filter(row=>row.type==="spent"),row=>row.amount_ugx))} hint={`${ugx(sum(data.float.filter(row=>row.type==="given"),row=>row.amount_ugx))} given`}/>
        <Stat label="Sorted" value={kg(sum(data.sorting,row=>row.output_kg))} hint={`${kg(sum(data.sorting,row=>row.rejected_kg))} lost`}/>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Record types">{tabs.map(([key,label,count])=><button key={key} onClick={()=>setTab(key)} aria-current={tab===key?"page":undefined} className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold ${tab===key?"border-[var(--color-action)] text-[var(--color-action)]":"border-transparent text-slate-600"}`}>{label} ({count})</button>)}</nav>

      {tab==="days"&&(data.days.length?<div className="table-wrap"><Table minWidth={880} headers={[["Date"],["Bought",true],["Purchases",true],["Sold",true],["Sales",true],["Float spent",true],["Sorted",true],["Lost",true]]}>
        {days.paged.map(row=><tr key={row.date}><td className="whitespace-nowrap"><button onClick={()=>choose(row.date,row.date)} className="font-medium text-[var(--color-action)]">{dayName(row.date)}</button></td><td className={right}>{kg(row.purchasedKg)}</td><td className={right}>{ugx(row.purchaseUgx)}</td><td className={right}>{kg(row.soldKg)}</td><td className={right}>{ugx(row.salesUgx)}</td><td className={right}>{ugx(row.floatSpentUgx)}</td><td className={right}>{kg(row.sortedKg)}</td><td className={right}>{kg(row.sortingWasteKg)}</td></tr>)}
      </Table><Pager of={days}/></div>:empty("activity"))}

      {tab==="purchases"&&(data.purchases.length?<div className="table-wrap"><Table minWidth={860} headers={[["Date"],["Material"],["Supplier"],["Payment"],["Weight",true],["Price per kg",true],["Total",true]]}>
        {purchases.paged.map(row=><tr key={row.id}><td className="whitespace-nowrap">{dayName(row.date)}</td><td className="table-primary">{row.material}</td><td>{row.supplier}{row.reference&&<p className="table-secondary">{row.reference}</p>}</td><td>{row.payment}</td><td className={right}>{kg(row.quantity_kg)}</td><td className={right}>{ugx(row.price_ugx)}</td><td className={right}>{ugx(row.total_ugx)}</td></tr>)}
      </Table><Pager of={purchases}/></div>:empty("purchases"))}

      {tab==="sales"&&(data.sales.length?<div className="table-wrap"><Table minWidth={920} headers={[["Date"],["Material"],["Customer"],["Delivered",true],["Paid for",true],["Price per kg",true],["Revenue",true],["Balance",true]]}>
        {sales.paged.map(row=><tr key={row.id}><td className="whitespace-nowrap">{dayName(row.date)}</td><td className="table-primary">{row.material}</td><td>{row.buyer}{row.invoice&&<p className="table-secondary">{row.invoice}</p>}</td><td className={right}>{kg(row.delivered_kg)}</td><td className={right}>{kg(row.paid_kg)}</td><td className={right}>{ugx(row.price_ugx)}</td><td className={right}>{ugx(row.revenue_ugx)}</td><td className={right}>{ugx(row.balance_ugx)}</td></tr>)}
      </Table><Pager of={sales}/></div>:empty("sales"))}

      {tab==="float"&&(data.float.length?<div className="table-wrap"><Table minWidth={860} headers={[["Date"],["Type"],["For"],["Details"],["Amount",true],["Float after",true]]}>
        {float.paged.map(row=><tr key={row.id}><td className="whitespace-nowrap">{dayName(row.date)}</td><td className="table-primary capitalize">{row.type}</td><td>{row.linked_to||"—"}</td><td>{row.notes||row.reference||"—"}{row.recorded_by&&<p className="table-secondary">{row.recorded_by}</p>}</td><td className={right}>{ugx(row.amount_ugx)}</td><td className={right}>{ugx(row.balance_ugx)}</td></tr>)}
      </Table><Pager of={float}/></div>:empty("float entries"))}

      {tab==="sorting"&&(data.sorting.length?<><div className="table-wrap"><Table minWidth={920} headers={[["Date"],["Sorted"],["Taken",true],["Sorted out",true],["Lost",true],["Stock after: source",true],["Stock after: sorted",true]]}>
        {sorting.paged.map(row=><tr key={row.id}><td className="whitespace-nowrap">{dayName(row.date)}</td><td className="table-primary">{row.input_material} → {row.output_material}</td><td className={right}>{kg(row.input_kg)}</td><td className={right}>{kg(row.output_kg)}</td><td className={right}>{kg(row.rejected_kg)}</td><td className={right}>{kg(row.inputStockKg)}</td><td className={right}>{kg(row.outputStockKg)}</td></tr>)}
      </Table><Pager of={sorting}/></div><p className="text-xs text-slate-500">Stock after follows the order entries were recorded, which can differ from their dates when older work was entered later.</p></>:empty("sorting"))}
    </>}
  </div></AppShell>;
}
