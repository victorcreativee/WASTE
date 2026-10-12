"use client";
import Link from "next/link";
import { useEffect,useMemo,useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import {Feedback,PageHeader,Status} from "@/components/ui/System";
import { apiRequest } from "@/lib/api";

type Organization={id:string;name:string;email:string|null;phone:string|null;address:string|null;is_active:boolean};
type Summary={jobs_today:number;completed_jobs:number;missed_jobs:number;active_routes:number;available_trucks:number;active_drivers:number;zones_covered:number;pending_citizen_issues:number;service_completion_percentage:number;total_customers:number;open_driver_problems:number;active_route_progress:{id:string;name:string;driver_name:string|null;status:string;stop_count:number;completed_stop_count:number}[];recent_unresolved_issues:{id:string;title:string;status:string;address:string|null}[]};
type Billing={subscriptions:{status:string}[];invoices:{amount_ugx:string;balance_ugx:string;status:string;invoice_number:string;customer_name:string;due_on:string}[];payments:{amount_ugx:string;status:string}[]};
type Staff={id:string;status:string;roles:string[];full_name:string};
type Response<T>={data:T};
function money(value:number){return `UGX ${new Intl.NumberFormat("en-UG",{maximumFractionDigits:0}).format(value)}`;}

export default function CompanyDashboard(){
 const [organization,setOrganization]=useState<Organization|null>(null),[summary,setSummary]=useState<Summary|null>(null),[billing,setBilling]=useState<Billing>({subscriptions:[],invoices:[],payments:[]}),[staff,setStaff]=useState<Staff[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState("");
 useEffect(()=>{Promise.all([
  apiRequest<Response<Organization[]>>("/api/organizations"),apiRequest<Response<Summary>>("/api/waste/command-center/summary"),
  apiRequest<Response<Billing>>("/api/waste/billing/overview"),apiRequest<Response<Staff[]>>("/api/auth/organization-users"),
 ]).then(([o,s,b,t])=>{setOrganization(o.data[0]||null);setSummary(s.data);setBilling(b.data);setStaff(t.data);}).catch((e:unknown)=>setError(e instanceof Error?e.message:"Failed to load organization operations")).finally(()=>setLoading(false));},[]);
 const finance=useMemo(()=>({outstanding:billing.invoices.reduce((n,i)=>n+Number(i.balance_ugx),0),billed:billing.invoices.reduce((n,i)=>n+Number(i.amount_ugx),0),received:billing.payments.filter(p=>p.status==="successful").reduce((n,p)=>n+Number(p.amount_ugx),0),pending:billing.payments.filter(p=>p.status==="pending").length}),[billing]);
 const activeStaff=staff.filter(p=>p.status==="active"),drivers=staff.filter(p=>p.roles.includes("driver")),supervisors=staff.filter(p=>p.roles.includes("supervisor"));
 const attentionItems=[
  ["Missed collections",summary?.missed_jobs||0,"/dashboard/waste"],
  ["Driver alerts",summary?.open_driver_problems||0,"/dashboard/driver-mobile"],
  ["Customer issues",summary?.pending_citizen_issues||0,"/dashboard/citizen-issues"],
  ["Pending payments",finance.pending,"/dashboard/billing"],
 ] as const;
 if(loading)return <AppShell><div className="mx-auto max-w-7xl py-16 text-center text-slate-500">Preparing your organization workspace...</div></AppShell>;
 return <AppShell><div className="mx-auto max-w-7xl">
  <PageHeader eyebrow="Organization overview" title={organization?.name||"Your organization"} description="See today’s service delivery, workforce readiness, customer revenue, and items requiring action." action={<div className="text-right"><p className="mb-1 text-xs font-semibold text-slate-500">Operating status</p><Status value={organization?.is_active?"active":"pending"}/></div>}/>
  {error&&<Feedback tone="error">{error}</Feedback>}

  <section className="mt-8 grid border-y border-slate-300 sm:grid-cols-2 xl:grid-cols-4">{[
   ["Service completion",`${summary?.service_completion_percentage||0}%`,`${summary?.completed_jobs||0} of ${summary?.jobs_today||0} jobs today`],
   ["Active routes",summary?.active_routes||0,`${summary?.open_driver_problems||0} driver alerts`],
   ["Customers",summary?.total_customers||0,`${billing.subscriptions.filter(s=>s.status==="active").length} active subscriptions`],
   ["Outstanding",money(finance.outstanding),`${finance.pending} payments awaiting confirmation`],
  ].map(([label,value,note])=><div key={label} className="border-b border-slate-200 py-5 pr-5 sm:border-r xl:border-b-0"><p className="text-sm font-bold text-slate-500">{label}</p><p className="mt-2 text-3xl font-semibold text-slate-950">{value}</p><p className="mt-2 text-xs font-semibold text-slate-500">{note}</p></div>)}</section>

  <section className="mt-8 grid gap-8 xl:grid-cols-[1.3fr_.7fr]">
   <div className="space-y-8">
    <div className="border-y border-slate-300 bg-white"><div className="flex items-center justify-between border-b p-5"><div><h2 className="text-xl font-semibold">Active trips</h2><p className="mt-1 text-sm text-slate-500">Monitor routes already dispatched today.</p></div><Link href="/dashboard/waste" className="text-sm font-semibold text-[#3156a3]">Open daily operations →</Link></div>
     {summary?.active_route_progress.length?<div className="table-wrap"><table className="text-left"><thead><tr><th>Route</th><th>Driver</th><th>Stops</th><th className="text-right">Progress</th></tr></thead><tbody>{summary.active_route_progress.map(route=>{const p=route.stop_count?Math.round(route.completed_stop_count/route.stop_count*100):0;return <tr key={route.id}><td className="table-primary">{route.name}</td><td>{route.driver_name||"Not assigned"}</td><td>{route.completed_stop_count} of {route.stop_count}</td><td className="text-right font-semibold text-[#3156a3]">{p}%</td></tr>})}</tbody></table></div>:<p className="p-5 text-sm text-slate-500">No routes are currently active.</p>}
    </div>

    <div className="border-y border-slate-300 bg-white"><div className="flex items-center justify-between border-b p-5"><div><h2 className="text-xl font-semibold">Outstanding invoices</h2><p className="mt-1 text-sm text-slate-500">Customer balances that still require payment.</p></div><Link href="/dashboard/billing" className="text-sm font-semibold text-[#3156a3]">Open income & billing →</Link></div><div className="p-5">{billing.invoices.filter(i=>Number(i.balance_ugx)>0).slice(0,4).map(i=><div key={i.invoice_number} className="flex justify-between gap-4 border-b py-3 last:border-0"><div><p className="font-semibold">{i.customer_name}</p><p className="text-sm text-slate-500">{i.invoice_number} · due {new Date(i.due_on).toLocaleDateString("en-GB")}</p></div><p className="font-semibold">{money(Number(i.balance_ugx))}</p></div>)}{!billing.invoices.some(i=>Number(i.balance_ugx)>0)&&<p className="text-sm text-slate-500">No outstanding customer invoices.</p>}</div></div>
   </div>

   <aside className="space-y-8">
    <div className="border-y border-slate-300 bg-white"><div className="flex items-center justify-between border-b p-5"><h2 className="text-xl font-semibold">Workforce readiness</h2><Link href="/dashboard/team" className="text-sm font-semibold text-[#3156a3]">Manage staff →</Link></div><dl className="divide-y divide-slate-200">{[["Active staff",activeStaff.length],["Available drivers",drivers.length],["Supervisors",supervisors.length]].map(([label,value])=><div key={label} className="flex justify-between px-5 py-3 text-sm"><dt className="text-slate-600">{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl></div>
    <div className="border-y border-slate-300 bg-white"><div className="border-b p-5"><h2 className="text-xl font-semibold">Attention required</h2><p className="mt-1 text-sm text-slate-500">Only queues with outstanding work are shown.</p></div>{attentionItems.some(([,value])=>value>0)?<div className="table-wrap"><table className="text-left"><thead><tr><th>Queue</th><th className="text-right">Open</th><th className="text-right">Action</th></tr></thead><tbody>{attentionItems.filter(([,value])=>value>0).map(([l,v,h])=><tr key={l}><td className="table-primary">{l}</td><td className="text-right font-semibold">{v}</td><td className="text-right"><Link href={h} className="font-semibold text-[#3156a3]">Review</Link></td></tr>)}</tbody></table></div>:<div className="p-5"><p className="font-semibold text-slate-800">No action required</p><p className="mt-1 text-sm text-slate-500">Operational and customer queues are clear.</p></div>}</div>
   </aside>
  </section>
 </div></AppShell>;
}
