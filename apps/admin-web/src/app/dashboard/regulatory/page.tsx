"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {AppShell} from "@/components/layout/AppShell";
import {Feedback,PageHeader,Status} from "@/components/ui/System";
import {apiRequest} from "@/lib/api";
import {RETURN_STATE,monthName,shortDate} from "@/lib/returns";

type Portal={
  organization:{name:string;type:string};today:string;
  permit:null|{permit_number:string;status:string;effective_status:string;valid_until:string|null;renewal_pending:boolean};
  compliance:{open:Array<{id:string;case_number:string;title:string;severity:string;status:string;due_date:string|null}>;overdue:number};
  returns:{outstanding:Array<{period:string;due_on:string;state:string}>;overdue:number;queried:number};
  unread_notices:number;
};

const days=(from:string,to:string)=>Math.round((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/86400000);

function Panel({title,href,action,children}:{title:string;href:string;action:string;children:React.ReactNode}){
  return <section className="card flex flex-col">
    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3"><h2 className="text-sm font-semibold text-slate-900">{title}</h2><Link href={href} className="text-sm font-medium text-[var(--color-action)] hover:underline">{action} →</Link></div>
    <div className="flex-1 px-5 py-4">{children}</div>
  </section>;
}

export default function RegulatoryOverviewPage(){
  const [data,setData]=useState<Portal|null>(null),[error,setError]=useState("");
  useEffect(()=>{apiRequest<{data:Portal}>("/api/waste/regulatory/portal").then(r=>setData(r.data)).catch(e=>setError(e instanceof Error?e.message:"Could not load your regulatory overview"))},[]);

  const p=data?.permit,left=p?.valid_until&&data?days(data.today,p.valid_until):null;
  const actions:string[]=[];
  if(data){
    if(!p)actions.push("No KCCA permit is linked to your organization.");
    else if(p.effective_status!=="approved")actions.push(`Your permit is ${p.effective_status}.`);
    else if(left!==null&&left<=90&&!p.renewal_pending)actions.push(`Your permit expires in ${left} days. Renewal is open.`);
    if(data.returns.overdue)actions.push(`${data.returns.overdue} monthly return${data.returns.overdue===1?" is":"s are"} overdue.`);
    if(data.returns.queried)actions.push(`KCCA queried ${data.returns.queried} return${data.returns.queried===1?"":"s"}.`);
    if(data.compliance.overdue)actions.push(`${data.compliance.overdue} compliance case${data.compliance.overdue===1?" is":"s are"} past due.`);
  }

  return <AppShell><div className="mx-auto max-w-5xl space-y-6">
    <PageHeader eyebrow="KCCA regulation" title="Regulatory overview" description="Your obligations to KCCA in one place. This part of the platform is available to every licensed company, whatever your subscription."/>
    {error&&<Feedback tone="error">{error}</Feedback>}
    {data&&(actions.length?<Feedback tone="warning"><p className="font-semibold">Needs your attention</p><ul className="mt-1 list-disc pl-4 font-normal">{actions.map(a=><li key={a}>{a}</li>)}</ul></Feedback>:<Feedback tone="success">You are up to date with KCCA: permit in force, no overdue returns and no overdue compliance cases.</Feedback>)}

    {data&&<div className="grid gap-5 md:grid-cols-2">
      <Panel title="Permit" href="/dashboard/permit" action="Open permit">
        {p?<div className="space-y-2 text-sm"><div className="flex items-center justify-between"><span className="font-medium text-slate-900">{p.permit_number}</span><Status value={p.effective_status}/></div>
          <p className="text-slate-600">Valid until {shortDate(p.valid_until)}{left!==null&&p.effective_status==="approved"?` · ${left} days left`:""}</p>
          {p.renewal_pending&&<p className="text-slate-600">Renewal request waiting for KCCA.</p>}</div>
          :<p className="text-sm text-slate-600">No permit on record. Ask KCCA to issue or link your permit.</p>}
        {data.unread_notices>0&&<p className="mt-3 text-sm text-[var(--color-warning)]">{data.unread_notices} unread KCCA notice{data.unread_notices===1?"":"s"}</p>}
      </Panel>

      <Panel title="Monthly returns" href="/dashboard/returns" action="Open returns">
        {data.returns.outstanding.length?<ul className="divide-y divide-slate-100 text-sm">{data.returns.outstanding.slice(0,4).map(r=><li key={r.period} className="flex items-center justify-between py-2 first:pt-0"><span>{monthName(r.period)}<span className="block text-xs text-slate-500">Due {shortDate(r.due_on)}</span></span><span className={RETURN_STATE[r.state].className}>{RETURN_STATE[r.state].label}</span></li>)}</ul>
          :<p className="text-sm text-slate-600">No returns outstanding. The next one is due on the 15th of next month.</p>}
      </Panel>

      <Panel title="Compliance cases" href="/dashboard/compliance" action="Open cases">
        {data.compliance.open.length?<ul className="divide-y divide-slate-100 text-sm">{data.compliance.open.map(c=><li key={c.id} className="py-2 first:pt-0"><p className="font-medium text-slate-900">{c.title}</p><p className="text-xs text-slate-500">{c.case_number} · {c.severity} · due {shortDate(c.due_date)}{c.due_date&&c.due_date<data.today&&c.status!=="remediation_submitted"?" · past due":""}</p></li>)}</ul>
          :<p className="text-sm text-slate-600">No open compliance cases.</p>}
      </Panel>

      <section className="card px-5 py-4 text-sm text-slate-600">
        <h2 className="font-semibold text-slate-900">What KCCA expects</h2>
        <ul className="mt-2 space-y-1.5">
          <li>— Keep your permit in force and renew from 90 days before it expires.</li>
          <li>— File a return for each month by the 15th of the following month.</li>
          <li>— Respond to compliance cases by their due date.</li>
        </ul>
      </section>
    </div>}
  </div></AppShell>;
}
