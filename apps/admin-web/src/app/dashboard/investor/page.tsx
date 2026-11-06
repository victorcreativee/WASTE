"use client";
import {useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,PageHeader,Stat} from "@/components/ui/System";
import {apiRequest} from "@/lib/api";
import {useHasRole} from "@/lib/session";

type Month={month:string;revenueUgx:number;grossProfitUgx:number;operatingProfitUgx:number;marginPercent:number;purchasedKg:number;soldKg:number};
type Concentration={count:number;largestPercent:number;topThreePercent:number};
type Investor={id:string;name:string;sharePercent:number|null;investedUgx:number;paidOutUgx:number;stillInvestedUgx:number;paidBackPercent:number|null;estimatedValueUgx:number|null};
type Overview={
  organization:{name:string};generatedAt:string;range:{from:string;to:string};basis:string;warnings:string[];
  totals:{revenueUgx:number;grossProfitUgx:number;operatingProfitUgx:number;marginPercent:number};
  growth:{percent:number|null;month:string|null;previousMonth:string|null};
  months:Month[];
  position:{cashUgx:number;stockValueUgx:number;stockKg:number;receivablesUgx:number;payablesUgx:number;loansOwedUgx:number;ownedUgx:number;owedUgx:number;netPositionUgx:number};
  buyers:Concentration;suppliers:Concentration;
  materials:{material:string;revenueUgx:number;soldKg:number;revenuePercent:number}[];
  impact:{collectedKg:number;deliveredKg:number;soldKg:number;sortingWasteKg:number;refusedByBuyersKg:number};
  updates:{id:string;title:string;body:string;created_at:string;posted_by_name:string|null}[];
  investors:Investor[];
  transactions:{id:string;transaction_type:"investment"|"payout";amount_ugx:string;transaction_date:string;reference:string;reversed_at:string|null;balanceUgx:number}[];
};

const ugx=(value:number|string)=>`UGX ${Math.round(Number(value)).toLocaleString("en-GB")}`;
const kg=(value:number)=>`${Math.round(value).toLocaleString("en-GB")} kg`;
const monthName=(month:string,style:"short"|"long"="short")=>new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB",{month:style,timeZone:"UTC",...(style==="long"?{year:"numeric"}:{})});
const day=(value:string)=>new Date(value).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
const section="report-section rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white p-5";
/** Short money for chart scales: 1.8M, 450K. */
const compact=(value:number)=>new Intl.NumberFormat("en-GB",{notation:"compact",maximumFractionDigits:1}).format(value);

/** One measure by month. Bars grow from a shared zero line, so a loss drops below it. */
function MonthBars({title,months,value}:{title:string;months:Month[];value:(month:Month)=>number}){
  const values=months.map(value),high=Math.max(...values,0),low=Math.min(...values,0),span=high-low||1;
  return <figure className={section}>
    <figcaption className="flex items-baseline justify-between gap-3"><h2 className="font-semibold text-slate-950">{title}</h2><span className="text-xs text-slate-500">UGX, highest {compact(high)}</span></figcaption>
    <div role="img" aria-label={`${title}. The figures are in the monthly results table.`} className="mt-4 grid h-44 gap-1.5" style={{gridTemplateColumns:`repeat(${months.length},minmax(0,1fr))`}}>
      {months.map((month,index)=>{const amount=values[index],height=Math.abs(amount)/span*100,above=high/span*100;
        return <div key={month.month} className="group relative h-full" title={`${monthName(month.month,"long")}: ${ugx(amount)}`}>
          <div className="absolute inset-x-0 border-t border-slate-300" style={{top:`${above}%`}}/>
          {amount!==0&&<div className={`absolute inset-x-[12%] bg-[var(--color-action)] group-hover:opacity-80 ${amount>0?"rounded-t":"rounded-b"}`} style={{printColorAdjust:"exact",WebkitPrintColorAdjust:"exact",...(amount>0?{bottom:`${100-above}%`,height:`${height}%`}:{top:`${above}%`,height:`${height}%`})}}/>}
        </div>})}
    </div>
    <div className="mt-1.5 grid gap-1.5 text-center text-[11px] text-slate-500" style={{gridTemplateColumns:`repeat(${months.length},minmax(0,1fr))`}}>{months.map(month=><span key={month.month}>{monthName(month.month)}</span>)}</div>
  </figure>;
}

function Line({label,value,strong}:{label:string;value:string;strong?:boolean}){
  return <div className={`flex justify-between gap-4 py-2.5 text-sm ${strong?"font-semibold text-slate-950":"text-slate-700"}`}><span>{label}</span><span className="whitespace-nowrap tabular-nums">{value}</span></div>;
}

export default function InvestorPage(){
  const isInvestor=useHasRole("company_investor");
  const [data,setData]=useState<Overview|null>(null),[error,setError]=useState("");
  useEffect(()=>{apiRequest<{data:Overview}>("/api/waste/recycling/investor-overview").then(result=>setData(result.data)).catch(e=>setError(e instanceof Error?e.message:"Could not load the investor overview"))},[]);
  const mine=isInvestor?data?.investors[0]:undefined,hasTrading=Boolean(data?.months.some(month=>month.revenueUgx||month.purchasedKg));

  return <AppShell><div className="report-document mx-auto max-w-[1100px] space-y-5">
    <PageHeader eyebrow="Investor overview" title={data?.organization.name??"Investor overview"}
      description={data?`Business performance for the 12 months from ${day(data.range.from)} to ${day(data.range.to)}.`:"How the business is performing."}
      action={data?<button onClick={()=>window.print()} className="no-print border border-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-[var(--color-action)]">Print or save as PDF</button>:undefined}/>
    {error&&<Feedback tone="error">{error}</Feedback>}
    {!data&&!error&&<p className="py-8 text-sm text-slate-500">Loading the overview…</p>}
    {data&&<>
      {data.warnings.map(warning=><Feedback key={warning} tone="warning">{warning}</Feedback>)}
      <div className="report-section grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Sales, 12 months" value={ugx(data.totals.revenueUgx)}/>
        <Stat label="Operating profit, 12 months" value={ugx(data.totals.operatingProfitUgx)} hint="Estimate before tax"/>
        <Stat label="Operating margin" value={`${data.totals.marginPercent}%`} hint="Profit from each shilling of sales"/>
        <Stat label="Sales growth" value={data.growth.percent===null?"—":`${data.growth.percent>0?"+":""}${data.growth.percent}%`} hint={data.growth.percent===null?"Needs sales in two finished months":`${monthName(data.growth.month??"","long")} against ${monthName(data.growth.previousMonth??"","long")}`}/>
      </div>

      {mine&&<section className={section}>
        <h2 className="font-semibold text-slate-950">Your investment</h2>
        <div className="mt-3 grid gap-x-8 sm:grid-cols-2">
          <div className="divide-y divide-slate-100">
            <Line label="Invested" value={ugx(mine.investedUgx)}/>
            <Line label="Paid out to you" value={ugx(mine.paidOutUgx)}/>
            <Line label="Invested less payouts" value={ugx(mine.stillInvestedUgx)} strong/>
          </div>
          <div className="divide-y divide-slate-100">
            <Line label="Your share" value={mine.sharePercent===null?"Not set":`${mine.sharePercent}%`}/>
            {mine.paidBackPercent!==null&&<Line label="Paid back so far" value={`${mine.paidBackPercent}%`}/>}
            {mine.estimatedValueUgx!==null&&<Line label="Your share of the net position" value={ugx(mine.estimatedValueUgx)} strong/>}
          </div>
        </div>
        {mine.estimatedValueUgx!==null&&<p className="mt-2 text-xs text-slate-500">An estimate from the company’s records, not a valuation or a price for your share.</p>}
        {data.transactions.length>0&&<div className="table-wrap mt-4"><table className="w-full text-left text-sm"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th className="text-right!">Amount</th><th className="text-right!">Invested less payouts</th></tr></thead>
          <tbody>{data.transactions.map(row=><tr key={row.id} className={row.reversed_at?"text-slate-400":""}><td className="whitespace-nowrap">{day(row.transaction_date)}</td><td>{row.transaction_type==="investment"?"Investment":"Payout"}{row.reversed_at?" (cancelled)":""}</td><td>{row.reference}</td><td className={`text-right tabular-nums ${row.reversed_at?"line-through":""}`}>{ugx(row.amount_ugx)}</td><td className="text-right tabular-nums">{ugx(row.balanceUgx)}</td></tr>)}</tbody></table></div>}
      </section>}
      {isInvestor&&!mine&&<Feedback tone="info">Your investment record has not been set up yet. The company can add it for you.</Feedback>}
      {!isInvestor&&data.investors.length>0&&<section className={section}>
        <h2 className="font-semibold text-slate-950">Investors</h2>
        <div className="table-wrap mt-3"><table className="w-full text-left text-sm"><thead><tr><th>Investor</th><th className="text-right!">Share</th><th className="text-right!">Invested</th><th className="text-right!">Paid out</th><th className="text-right!">Invested less payouts</th></tr></thead>
          <tbody>{data.investors.map(row=><tr key={row.id}><td className="table-primary">{row.name}</td><td className="text-right tabular-nums">{row.sharePercent===null?"—":`${row.sharePercent}%`}</td><td className="text-right tabular-nums">{ugx(row.investedUgx)}</td><td className="text-right tabular-nums">{ugx(row.paidOutUgx)}</td><td className="text-right tabular-nums">{ugx(row.stillInvestedUgx)}</td></tr>)}</tbody></table></div>
      </section>}

      {hasTrading?<div className="grid gap-5 lg:grid-cols-2">
        <MonthBars title="Sales by month" months={data.months} value={month=>month.revenueUgx}/>
        <MonthBars title="Operating profit by month" months={data.months} value={month=>month.operatingProfitUgx}/>
      </div>:<EmptyState title="No trading recorded yet" description="Monthly results appear here once purchases and sales are recorded."/>}

      <section className={section}>
        <h2 className="font-semibold text-slate-950">What the company owns and owes</h2>
        <div className="mt-3 grid gap-x-8 sm:grid-cols-2">
          <div className="divide-y divide-slate-100">
            <Line label="Cash" value={ugx(data.position.cashUgx)}/>
            <Line label={`Stock at cost (${kg(data.position.stockKg)})`} value={ugx(data.position.stockValueUgx)}/>
            <Line label="Owed by buyers" value={ugx(data.position.receivablesUgx)}/>
            <Line label="Total owned" value={ugx(data.position.ownedUgx)} strong/>
          </div>
          <div className="divide-y divide-slate-100">
            <Line label="Owed to suppliers" value={ugx(data.position.payablesUgx)}/>
            <Line label="Loans still owed" value={ugx(data.position.loansOwedUgx)}/>
            <Line label="Total owed" value={ugx(data.position.owedUgx)} strong/>
            <Line label="Net position" value={ugx(data.position.netPositionUgx)} strong/>
          </div>
        </div>
      </section>

      <section className={section}>
        <h2 className="font-semibold text-slate-950">Monthly results</h2>
        <div className="table-wrap mt-3"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr><th>Month</th><th className="text-right!">Sales</th><th className="text-right!">Gross profit</th><th className="text-right!">Operating profit</th><th className="text-right!">Margin</th><th className="text-right!">Sold</th></tr></thead>
          <tbody>{[...data.months].reverse().map(row=><tr key={row.month}><td>{monthName(row.month,"long")}</td><td className="text-right tabular-nums">{ugx(row.revenueUgx)}</td><td className="text-right tabular-nums">{ugx(row.grossProfitUgx)}</td><td className="text-right tabular-nums">{ugx(row.operatingProfitUgx)}</td><td className="text-right tabular-nums">{row.revenueUgx?`${row.marginPercent}%`:"—"}</td><td className="text-right tabular-nums">{kg(row.soldKg)}</td></tr>)}</tbody></table></div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className={section}>
          <h2 className="font-semibold text-slate-950">Trade concentration</h2>
          <p className="mt-1 text-xs text-slate-500">How much depends on a few partners, over 12 months.</p>
          <div className="mt-2 divide-y divide-slate-100">
            <Line label="Buyers" value={data.buyers.count.toLocaleString("en-GB")}/>
            <Line label="Largest buyer’s share of sales" value={`${data.buyers.largestPercent}%`}/>
            <Line label="Top three buyers’ share" value={`${data.buyers.topThreePercent}%`}/>
            <Line label="Suppliers" value={data.suppliers.count.toLocaleString("en-GB")}/>
            <Line label="Largest supplier’s share of purchases" value={`${data.suppliers.largestPercent}%`}/>
          </div>
        </section>
        <section className={section}>
          <h2 className="font-semibold text-slate-950">Sales by material</h2>
          <p className="mt-1 text-xs text-slate-500">Over 12 months.</p>
          {data.materials.length?<div className="mt-2 divide-y divide-slate-100">{data.materials.slice(0,6).map(item=><Line key={item.material} label={`${item.material} (${kg(item.soldKg)})`} value={`${item.revenuePercent}%`}/>)}</div>:<p className="mt-3 text-sm text-slate-500">No sales in this period.</p>}
        </section>
      </div>

      <section className={section}>
        <h2 className="font-semibold text-slate-950">Environmental impact</h2>
        <p className="mt-1 text-xs text-slate-500">Weighed material over 12 months.</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div><p className="text-2xl font-semibold text-slate-950">{kg(data.impact.collectedKg)}</p><p className="text-sm text-slate-600">Waste material bought in and kept out of landfill</p></div>
          <div><p className="text-2xl font-semibold text-slate-950">{kg(data.impact.soldKg)}</p><p className="text-sm text-slate-600">Sold to industry for recycling</p></div>
          <div><p className="text-2xl font-semibold text-slate-950">{kg(data.impact.sortingWasteKg+data.impact.refusedByBuyersKg)}</p><p className="text-sm text-slate-600">Could not be recycled (sorting waste and weight refused by buyers)</p></div>
        </div>
      </section>

      <section className={section}>
        <h2 className="font-semibold text-slate-950">Updates from the company</h2>
        {data.updates.length?<div className="mt-3 space-y-4">{data.updates.map(update=><article key={update.id} className="border-t border-slate-100 pt-3 first:border-0 first:pt-0">
          <p className="font-medium text-slate-900">{update.title}</p>
          <p className="text-xs text-slate-500">{day(update.created_at)}</p>
          <p className="mt-1.5 whitespace-pre-line text-sm text-slate-700">{update.body}</p>
        </article>)}</div>:<p className="mt-2 text-sm text-slate-500">No updates yet.</p>}
      </section>

      <p className="text-xs text-slate-500">{data.basis} Generated {day(data.generatedAt)}.</p>
    </>}
  </div></AppShell>;
}
