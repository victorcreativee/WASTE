"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {Pagination} from "@/components/ui/Pagination";
import {ComplianceNoticeDialog,type NoticeDraft} from "@/components/command-center/ComplianceNoticeDialog";
import {apiRequest} from "@/lib/api";
import {useHasRole} from "@/lib/session";
import {day,useServerList} from "@/lib/factory";
import {FacilityTotal,PERIODS,Period,Rules,STANDING,STATE,Summary,Ticket,Trip,rate,reasonLabel,tonnes} from "@/lib/disposal";

type Company=Summary&{id:string;name:string;permit_number:string|null;explanations_waiting:number};
type Overview={period:Period;rules:Rules;city:Summary&{explanations_waiting:number};facilities:FacilityTotal[];companies:Company[]};
type Explanation={id:string;trip_id:string;organization_id:string;organization_name:string;trip_number:string|null;route_date:string;plate_number:string|null;reason:string;details:string;related_ticket_number:string|null;related_ticket_kg:string|null;submitted_at:string;submitted_by_name:string|null};
type View="explanations"|"trips"|"tickets";
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";

function noticeFor(company:Company,overview:Overview):NoticeDraft{
  const s=company.states,due=new Date(Date.now()+14*86400000).toISOString().slice(0,10);
  return {key:`${company.id}-${overview.period.from}`,organizationId:company.id,organizationName:company.name,category:"weighbridge",severity:company.standing==="action"?"warning":"advisory",
    title:`Collection trips without verified disposal (${overview.period.label.toLowerCase()})`,
    details:[`KCCA disposal verification, ${overview.period.from} to ${overview.period.to}:`,
      `- ${company.due_trips} completed trips were due at a KCCA weighbridge; ${rate(company.verification_rate)} were verified or explained (KCCA expects ${overview.rules.goodRate}%).`,
      s.unverified?`- ${s.unverified} trips have no disposal record at all.`:"",
      s.declared?`- ${s.declared} trips carry only a ticket number entered by the company that no KCCA weighbridge recorded.`:"",
      company.unlinked_tickets?`- ${company.unlinked_tickets} weighbridge tickets (${tonnes(company.unlinked_kg)}) are not linked to any trip.`:""].filter(Boolean).join("\n"),
    requiredAction:"Link each weighbridge ticket to its trip and explain every remaining trip in Disposal records, then make sure every load is weighed at a KCCA facility.",
    dueDate:due};
}

export default function DisposalOversightPage(){
  const [period,setPeriod]=useState("30d"),[data,setData]=useState<Overview|null>(null),[company,setCompany]=useState<string>("");
  const [view,setView]=useState<View>("explanations"),[error,setError]=useState(""),[notice,setNotice]=useState(""),[draft,setDraft]=useState<NoticeDraft|null>(null);
  const [reviewing,setReviewing]=useState<{item:Explanation;action:"accept"|"reject"}|null>(null),[accepting,setAccepting]=useState<Ticket|null>(null);
  const canAct=useHasRole("kcca_admin");
  const org=company?`&organizationId=${company}`:"";

  const load=useCallback(async()=>{
    setError("");
    try{setData((await apiRequest<{data:Overview}>(`/api/waste/disposal/city?period=${period}`)).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load disposal verification")}
  },[period]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  const explanations=useServerList<Explanation>(`/api/waste/disposal/explanations?status=submitted${org}`);
  const trips=useServerList<Trip>(`/api/waste/disposal/city/trips?period=${period}&state=exceptions${org}`);
  const tickets=useServerList<Ticket>(`/api/waste/disposal/city/tickets?period=${period}&unlinked=1${org}`);

  async function refresh(message:string){setReviewing(null);setAccepting(null);setNotice(message);await Promise.all([load(),explanations.reload(),trips.reload(),tickets.reload()]);}
  const c=data?.city,selected=useMemo(()=>data?.companies.find(x=>x.id===company),[data,company]);
  const focus=(id:string,next:View)=>{setCompany(id);setView(next);explanations.setPage(1);trips.setPage(1);tickets.setPage(1);document.getElementById("disposal-work")?.scrollIntoView({behavior:"smooth"})};

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow="City oversight" title="Disposal verification" description={`Every completed collection trip should be weighed at a KCCA facility within ${data?.rules.graceHours??48} hours. See which collectors account for their loads, review their explanations, and act on the gaps.`}
      action={<select aria-label="Period" value={period} onChange={e=>setPeriod(e.target.value)} className="border border-slate-300 bg-white px-3 py-2 text-sm">{PERIODS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}

    {c&&<div className="grid grid-cols-2 border border-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-6 rounded-[var(--ui-radius-lg)]">
      {([["City verification rate",rate(c.verification_rate),`${c.due_trips} trips due`],["Verified at weighbridges",tonnes(c.verified_kg),`${c.states.verified} trips`],["Trips without disposal",c.exceptions,`${c.states.unverified} none · ${c.states.declared} self-declared`],["Tickets without a trip",c.unlinked_tickets,tonnes(c.unlinked_kg)],["Explanations to review",c.explanations_waiting,`${c.states.explained} accepted`],["Within 48 hours",c.states.pending+c.states.weighing,"not yet due"]] as const).map(([label,value,hint],i)=>
        <div key={label} className={`px-4 py-3 ${i?"border-l border-slate-200":""}`}><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{value}</p><p className="text-xs text-slate-500">{hint}</p></div>)}
    </div>}

    {data&&(data.companies.length?<div className="table-wrap"><table className="w-full min-w-[980px] text-left">
      <thead><tr><th>Collector</th><th>Standing</th><th className="text-right">Trips due</th><th className="text-right">Verified or explained</th><th className="text-right">Without disposal</th><th className="text-right">Tickets without a trip</th><th className="text-right">Verified weight</th><th/></tr></thead>
      <tbody>{data.companies.map(x=><tr key={x.id} className={x.id===company?"bg-slate-50":""}>
        <td><p className="table-primary">{x.name}</p><p className="table-secondary">{x.permit_number||"No permit on record"}</p></td>
        <td><span className={STANDING[x.standing].className}>{STANDING[x.standing].label}</span></td>
        <td className="text-right tabular-nums">{x.due_trips}</td>
        <td className="text-right tabular-nums">{rate(x.verification_rate)}</td>
        <td className="text-right tabular-nums">{x.exceptions?<button onClick={()=>focus(x.id,"trips")} className="min-h-0 p-0 font-medium text-[var(--color-danger)] hover:underline">{x.exceptions}</button>:0}</td>
        <td className="text-right tabular-nums">{x.unlinked_tickets?<button onClick={()=>focus(x.id,"tickets")} className="min-h-0 p-0 font-medium text-[var(--color-warning)] hover:underline">{x.unlinked_tickets}</button>:0}</td>
        <td className="text-right tabular-nums">{tonnes(x.verified_kg)}</td>
        <td className="whitespace-nowrap text-right">{x.explanations_waiting>0&&<button onClick={()=>focus(x.id,"explanations")} className="mr-2 border border-slate-300 px-3 py-2 text-xs text-slate-700">Review {x.explanations_waiting}</button>}
          {canAct&&(x.standing==="action"||x.standing==="watch")&&<button onClick={()=>setDraft(noticeFor(x,data))} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Send notice</button>}</td>
      </tr>)}</tbody>
    </table></div>:<EmptyState title="No collection trips in this period" description="Collectors appear here once they complete trips on their service routes."/>)}
    {data&&data.facilities.length>0&&<p className="text-sm text-slate-600">Weighed this period: {data.facilities.map(f=>`${f.name} ${tonnes(f.net_kg)} (${f.tickets} tickets)`).join(" · ")}</p>}

    <section id="disposal-work" className="scroll-mt-20 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Work list" className="inline-flex overflow-hidden rounded-[var(--ui-radius)] border border-slate-300 bg-white text-sm">
          {([["explanations",`Explanations (${explanations.total})`],["trips",`Trips without disposal (${trips.total})`],["tickets",`Tickets without a trip (${tickets.total})`]] as const).map(([value,label],i)=>
            <button key={value} role="radio" aria-checked={view===value} onClick={()=>setView(value)} className={`min-h-0 rounded-none px-3 py-1.5 ${i?"border-l border-slate-300":""} ${view===value?"bg-slate-900 text-white":"text-slate-700 hover:bg-slate-50"}`}>{label}</button>)}
        </div>
        {selected?<p className="text-sm text-slate-600">{selected.name} <button onClick={()=>setCompany("")} className="ml-1 min-h-0 p-0 text-sm font-medium text-[var(--color-action)] hover:underline">Show all collectors</button></p>
          :data&&<select aria-label="Collector" value={company} onChange={e=>setCompany(e.target.value)} className="border border-slate-300 bg-white px-3 py-1.5 text-sm"><option value="">All collectors</option>{data.companies.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>}
      </div>

      {view==="explanations"&&<>{explanations.rows.length?<ul className="card divide-y divide-slate-100">{explanations.rows.map(x=><li key={x.id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4 text-sm">
        <div className="min-w-0 max-w-3xl"><p className="font-semibold text-slate-900">{x.organization_name} · {x.trip_number||"Trip"}</p>
          <p className="text-xs text-slate-500">{day(x.route_date)} · {x.plate_number||"no vehicle"} · sent {day(x.submitted_at)}{x.submitted_by_name?` by ${x.submitted_by_name}`:""}</p>
          <p className="mt-2 font-medium text-slate-800">{reasonLabel(x.reason)}{x.related_ticket_number?` — ticket ${x.related_ticket_number} (${tonnes(x.related_ticket_kg)})`:""}</p>
          <p className="mt-0.5 text-slate-600">{x.details}</p></div>
        {canAct&&<div className="flex gap-2"><button onClick={()=>setReviewing({item:x,action:"accept"})} className="bg-[var(--color-action)] px-3 py-2 text-xs font-semibold text-white">Accept</button><button onClick={()=>setReviewing({item:x,action:"reject"})} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Reject</button></div>}
      </li>)}</ul>:!explanations.loading&&<EmptyState title="No explanations waiting"/>}
      <Pagination page={explanations.page} pageSize={explanations.pageSize} total={explanations.total} totalPages={explanations.totalPages} onPage={explanations.setPage} onPageSize={explanations.setPageSize}/></>}

      {view==="trips"&&<>{trips.rows.length?<div className="table-wrap"><table className="w-full min-w-[860px] text-left">
        <thead><tr><th>Collector</th><th>Trip</th><th>Date</th><th>Vehicle</th><th>Disposal</th></tr></thead>
        <tbody>{trips.rows.map(t=><tr key={t.trip_id}>
          <td className="table-primary">{t.organization_name}</td>
          <td><p>{t.trip_number||"Trip"}</p><p className="table-secondary">{t.route_name}</p></td>
          <td>{day(t.route_date)}</td><td className="font-mono text-sm">{t.plate_number||"—"}</td>
          <td><span className={STATE[t.state].className}>{STATE[t.state].label}</span><p className="table-secondary">{t.declared_ticket?`Company entered ${t.declared_ticket}, ${tonnes(t.declared_kg)}`:t.explanation_status==="rejected"?"Explanation rejected":""}</p></td>
        </tr>)}</tbody>
      </table></div>:!trips.loading&&<EmptyState title="Every due trip is verified or explained"/>}
      <Pagination page={trips.page} pageSize={trips.pageSize} total={trips.total} totalPages={trips.totalPages} onPage={trips.setPage} onPageSize={trips.setPageSize}/></>}

      {view==="tickets"&&<>{tickets.rows.length?<div className="table-wrap"><table className="w-full min-w-[860px] text-left">
        <thead><tr><th>Collector</th><th>Ticket</th><th>Weighed</th><th>Vehicle</th><th className="text-right">Net weight</th><th/></tr></thead>
        <tbody>{tickets.rows.map(t=><tr key={t.id}>
          <td className="table-primary">{t.organization_name}</td>
          <td><p>{t.ticket_number}</p><p className="table-secondary">{t.facility}</p></td>
          <td>{day(t.operation_date)}</td><td className="font-mono text-sm">{t.registration}</td>
          <td className="text-right tabular-nums">{tonnes(t.net_kg)}</td>
          <td className="text-right">{canAct&&<button onClick={()=>setAccepting(t)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Accept without trip</button>}</td>
        </tr>)}</tbody>
      </table></div>:!tickets.loading&&<EmptyState title="Every ticket is linked to a trip"/>}
      <Pagination page={tickets.page} pageSize={tickets.pageSize} total={tickets.total} totalPages={tickets.totalPages} onPage={tickets.setPage} onPageSize={tickets.setPageSize}/></>}
    </section>

    <ReviewDialog state={reviewing} onClose={()=>setReviewing(null)} onDone={refresh}/>
    <AcceptTicketDialog ticket={accepting} onClose={()=>setAccepting(null)} onDone={refresh}/>
    <ComplianceNoticeDialog draft={draft} onClose={()=>setDraft(null)} onIssued={message=>{setDraft(null);setNotice(message)}}/>
  </div></AppShell>;
}

function ReviewDialog({state,onClose,onDone}:{state:{item:Explanation;action:"accept"|"reject"}|null;onClose:()=>void;onDone:(message:string)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!state)return;setBusy(true);setError("");
    try{const r=await apiRequest<{message:string}>(`/api/waste/disposal/explanations/${state.item.id}/review`,{method:"PATCH",body:JSON.stringify({action:state.action,note:new FormData(e.currentTarget).get("note")||undefined})});onDone(`${state.item.organization_name}: ${r.message}.`)}
    catch(err){setError(err instanceof Error?err.message:"Could not record the decision")}finally{setBusy(false)}
  }
  const reject=state?.action==="reject";
  return <Modal open={Boolean(state)} title={reject?"Reject explanation":"Accept explanation"} description={state?`${state.item.organization_name} · ${state.item.trip_number||"trip"} · ${reasonLabel(state.item.reason)}`:undefined} onClose={onClose}>
    <form onSubmit={submit} className="grid gap-4 text-sm">
      {error&&<Feedback tone="error">{error}</Feedback>}
      <p className="text-slate-600">{reject?"The trip counts against the company again until it links a ticket or explains it differently.":"The trip counts as accounted for in the company's verification rate."}</p>
      <label className="font-medium text-slate-700">{reject?"Reason (shown to the company)":"Note (optional)"}<textarea name="note" required={reject} minLength={reject?5:undefined} rows={3} className={field}/></label>
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="border border-slate-300 px-4 py-2.5 font-medium text-slate-700">Cancel</button><button disabled={busy} className={`px-4 py-2.5 font-semibold disabled:opacity-50 ${reject?"bg-[var(--color-danger)] text-white":"bg-[var(--color-action)] text-white"}`}>{busy?"Saving…":reject?"Reject":"Accept"}</button></div>
    </form>
  </Modal>;
}

function AcceptTicketDialog({ticket,onClose,onDone}:{ticket:Ticket|null;onClose:()=>void;onDone:(message:string)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!ticket)return;setBusy(true);setError("");
    try{await apiRequest(`/api/waste/disposal/tickets/${ticket.id}/accept-without-trip`,{method:"PATCH",body:JSON.stringify({reason:new FormData(e.currentTarget).get("reason")})});onDone(`${ticket.ticket_number} accepted as a load without a trip.`)}
    catch(err){setError(err instanceof Error?err.message:"Could not accept the ticket")}finally{setBusy(false)}
  }
  return <Modal open={Boolean(ticket)} title={`Accept ${ticket?.ticket_number||"ticket"} without a trip`} description={ticket?`${ticket.organization_name} · ${ticket.registration} · ${day(ticket.operation_date)} · ${tonnes(ticket.net_kg)}`:undefined} onClose={onClose}>
    <form onSubmit={submit} className="grid gap-4 text-sm">
      {error&&<Feedback tone="error">{error}</Feedback>}
      <p className="text-slate-600">Use this for loads that were not collection trips, such as a vehicle hired for a clean-up. The ticket can no longer be linked to a trip.</p>
      <label className="font-medium text-slate-700">Reason<textarea name="reason" required minLength={5} rows={3} className={field}/></label>
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="border border-slate-300 px-4 py-2.5 font-medium text-slate-700">Cancel</button><button disabled={busy} className="bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">{busy?"Saving…":"Accept ticket"}</button></div>
    </form>
  </Modal>;
}
