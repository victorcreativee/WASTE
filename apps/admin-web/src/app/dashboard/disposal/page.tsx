"use client";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {Pagination} from "@/components/ui/Pagination";
import {apiRequest} from "@/lib/api";
import {day,useServerList} from "@/lib/factory";
import {FacilityTotal,PERIODS,REASONS,Rules,STANDING,STATE,Summary,Ticket,Trip,plateKey,rate,reasonLabel,tonnes} from "@/lib/disposal";
import {TrackPanel} from "@/components/tracks/TrackPanel";
import {STATE as TRACK_STATE,TrackCheck,TrackDetail,km} from "@/lib/tracks";

type View="action"|"review"|"all"|"tickets"|"gps";
const VIEWS:Array<[View,string]>=[["action","Needs action"],["review","With KCCA"],["all","All trips"],["tickets","Tickets without a trip"],["gps","GPS checks"]];
const STATES:Record<Exclude<View,"tickets"|"gps">,string>={action:"exceptions",review:"explanation_review",all:""};
const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";

export default function DisposalRecordsPage(){
  const [period,setPeriod]=useState("30d"),[view,setView]=useState<View>("action");
  const [summary,setSummary]=useState<(Summary&{rules:Rules;facilities:FacilityTotal[]})|null>(null);
  const [error,setError]=useState(""),[notice,setNotice]=useState("");
  const [explaining,setExplaining]=useState<Trip|null>(null),[linking,setLinking]=useState<Ticket|null>(null),[track,setTrack]=useState<TrackDetail|null>(null);

  const tripList=useServerList<Trip>(`/api/waste/disposal/trips?period=${period}${view!=="tickets"&&view!=="gps"&&STATES[view]?`&state=${STATES[view]}`:""}`);
  const trackList=useServerList<TrackCheck>(`/api/waste/tracks/checks?period=${period}&view=exceptions`);
  async function openTrack(id:string){try{setTrack((await apiRequest<{data:TrackDetail}>(`/api/waste/tracks/checks/${id}`)).data)}catch(e){setError(e instanceof Error?e.message:"Could not open the GPS check")}}
  const ticketList=useServerList<Ticket>(`/api/waste/disposal/tickets?period=${period}&unlinked=1`);
  const loadSummary=useCallback(async()=>{
    try{setSummary((await apiRequest<{data:Summary&{rules:Rules;facilities:FacilityTotal[]}}>(`/api/waste/disposal/summary?period=${period}`)).data)}
    catch(e){setError(e instanceof Error?e.message:"Could not load disposal records")}
  },[period]);
  useEffect(()=>{const timer=window.setTimeout(()=>void loadSummary(),0);return()=>window.clearTimeout(timer)},[loadSummary]);

  async function done(message:string){setExplaining(null);setLinking(null);setNotice(message);await Promise.all([loadSummary(),tripList.reload(),ticketList.reload()]);}
  const s=summary;

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow="KCCA regulation" title="Disposal records" description={`Every completed trip should be weighed at a KCCA weighbridge within ${s?.rules.graceHours??48} hours. Link tickets to their trips, and explain any trip that had no ticket.`}
      action={<select aria-label="Period" value={period} onChange={e=>{setPeriod(e.target.value);tripList.setPage(1);ticketList.setPage(1)}} className="border border-slate-300 bg-white px-3 py-2 text-sm">{PERIODS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{notice&&<Feedback tone="success">{notice}</Feedback>}

    {s&&<div className="grid grid-cols-2 border border-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-5 rounded-[var(--ui-radius-lg)]">
      <div className="px-4 py-3"><p className="text-xs font-medium text-slate-500">Verification rate</p><p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{rate(s.verification_rate)}</p><span className={STANDING[s.standing].className}>{STANDING[s.standing].label}</span></div>
      {([["Verified at the weighbridge",tonnes(s.verified_kg),`${s.states.verified} trips`],["Need action",s.exceptions,"trips without a KCCA ticket"],["Tickets without a trip",s.unlinked_tickets,tonnes(s.unlinked_kg)],["Within 48 hours",s.states.pending+s.states.weighing,"not yet due"]] as const).map(([label,value,hint])=>
        <div key={label} className="border-l border-slate-200 px-4 py-3"><p className="text-xs font-medium text-slate-500">{label}</p><p className={`mt-1 text-xl font-semibold tabular-nums ${label==="Need action"&&Number(value)>0?"text-[var(--color-danger)]":"text-slate-900"}`}>{value}</p><p className="text-xs text-slate-500">{hint}</p></div>)}
    </div>}

    <section>
      <div role="radiogroup" aria-label="Show" className="mb-3 inline-flex overflow-hidden rounded-[var(--ui-radius)] border border-slate-300 bg-white text-sm">
        {VIEWS.map(([value,label],i)=><button key={value} role="radio" aria-checked={view===value} onClick={()=>{setView(value);tripList.setPage(1)}} className={`min-h-0 rounded-none px-3 py-1.5 ${i?"border-l border-slate-300":""} ${view===value?"bg-slate-900 text-white":"text-slate-700 hover:bg-slate-50"}`}>{label}{value==="tickets"&&s?.unlinked_tickets?` (${s.unlinked_tickets})`:value==="action"&&s?.exceptions?` (${s.exceptions})`:""}</button>)}
      </div>

      {view==="gps"?<>
        <p className="mb-3 text-sm text-slate-600">KCCA compares each trip's GPS track with the disposal facilities and the weighbridge ticket once the trip's 6-hour disposal leg is over. Drivers should keep location sharing on until the truck is weighed.</p>
        {trackList.error&&<Feedback tone="error">{trackList.error}</Feedback>}
        {trackList.rows.length?<div className="table-wrap"><table className="w-full min-w-[820px] text-left">
          <thead><tr><th>Trip</th><th>Truck</th><th>Result</th><th>Ticket</th><th/></tr></thead>
          <tbody>{trackList.rows.map(c=><tr key={c.trip_id}>
            <td><p className="table-primary">{c.trip_number||"Trip"}</p><p className="table-secondary">{c.route_name} · {day(c.route_date)}</p></td>
            <td className="font-mono text-sm">{c.plate_number||"—"}</td>
            <td><span className={TRACK_STATE[c.state].className}>{TRACK_STATE[c.state].label}</span></td>
            <td>{c.ticket_number?<><p>{c.ticket_number}</p>{c.ticket_gps_distance_m!==null&&<p className="table-secondary">GPS {km(c.ticket_gps_distance_m)} away</p>}</>:"—"}</td>
            <td className="text-right"><button onClick={()=>void openTrack(c.trip_id)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Map</button></td>
          </tr>)}</tbody>
        </table></div>:!trackList.loading&&<EmptyState title="No GPS findings in this period"/>}
        <Pagination page={trackList.page} pageSize={trackList.pageSize} total={trackList.total} totalPages={trackList.totalPages} onPage={trackList.setPage} onPageSize={trackList.setPageSize}/>
      </>:view==="tickets"?<>
        {ticketList.error&&<Feedback tone="error">{ticketList.error}</Feedback>}
        {ticketList.rows.length?<div className="table-wrap"><table className="w-full min-w-[820px] text-left">
          <thead><tr><th>Ticket</th><th>Weighed</th><th>Vehicle</th><th className="text-right">Net weight</th><th/></tr></thead>
          <tbody>{ticketList.rows.map(t=><tr key={t.id}>
            <td><p className="table-primary">{t.ticket_number}</p><p className="table-secondary">{t.facility}</p></td>
            <td>{day(t.operation_date)}<p className="table-secondary">{t.driver_name}</p></td>
            <td className="font-mono text-sm">{t.registration}</td>
            <td className="text-right tabular-nums">{tonnes(t.net_kg)}</td>
            <td className="text-right"><button onClick={()=>setLinking(t)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Link to trip</button></td>
          </tr>)}</tbody>
        </table></div>:!ticketList.loading&&<EmptyState title="Every weighbridge ticket is linked to a trip"/>}
        <Pagination page={ticketList.page} pageSize={ticketList.pageSize} total={ticketList.total} totalPages={ticketList.totalPages} onPage={ticketList.setPage} onPageSize={ticketList.setPageSize}/>
      </>:<>
        {tripList.error&&<Feedback tone="error">{tripList.error}</Feedback>}
        {tripList.rows.length?<div className="table-wrap"><table className="w-full min-w-[900px] text-left">
          <thead><tr><th>Trip</th><th>Date</th><th>Vehicle</th><th>Disposal</th><th/></tr></thead>
          <tbody>{tripList.rows.map(t=><tr key={t.trip_id}>
            <td><p className="table-primary">{t.trip_number||"Trip"}</p><p className="table-secondary">{t.route_name}</p></td>
            <td>{day(t.route_date)}</td>
            <td className="font-mono text-sm">{t.plate_number||"—"}</td>
            <td><span className={STATE[t.state].className}>{STATE[t.state].label}</span>
              <p className="table-secondary max-w-[320px]">{t.ticket_number?`${t.ticket_number} · ${tonnes(t.net_kg)} · ${t.facility}`
                :t.declared_ticket?`Your entry ${t.declared_ticket} (${tonnes(t.declared_kg)}) is not on any KCCA weighbridge record`
                :t.explanation_status==="rejected"?`KCCA rejected the explanation: ${t.explanation_review_note}`
                :t.explanation_reason?reasonLabel(t.explanation_reason):""}</p></td>
            <td className="text-right">{(t.state==="unverified"||t.state==="declared")&&<button onClick={()=>setExplaining(t)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Explain</button>}</td>
          </tr>)}</tbody>
        </table></div>:!tripList.loading&&<EmptyState title={view==="action"?"No trips need action":view==="review"?"No explanations waiting for KCCA":"No completed trips in this period"}/>}
        <Pagination page={tripList.page} pageSize={tripList.pageSize} total={tripList.total} totalPages={tripList.totalPages} onPage={tripList.setPage} onPageSize={tripList.setPageSize}/>
      </>}
    </section>

    {s&&s.facilities.length>0&&<section className="text-sm text-slate-600"><p className="font-medium text-slate-800">Weighed this period</p>
      <ul className="mt-1 space-y-0.5">{s.facilities.map(f=><li key={f.code}>{f.name}: {tonnes(f.net_kg)} on {f.tickets} ticket{f.tickets===1?"":"s"}</li>)}</ul></section>}

    <ExplainDialog trip={explaining} period={period} onClose={()=>setExplaining(null)} onDone={done}/>
    <LinkDialog ticket={linking} period={period} onClose={()=>setLinking(null)} onDone={done}/>
    {track&&<TrackPanel check={track} onClose={()=>setTrack(null)}/>}
  </div></AppShell>;
}

function ExplainDialog({trip,period,onClose,onDone}:{trip:Trip|null;period:string;onClose:()=>void;onDone:(message:string)=>void}){
  const [reason,setReason]=useState("no_load"),[tickets,setTickets]=useState<Ticket[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{if(trip&&reason==="combined_load")apiRequest<{data:Ticket[]}>(`/api/waste/disposal/tickets?period=${period}&pageSize=200`).then(r=>setTickets(r.data.filter(t=>t.status==="completed"))).catch(()=>setTickets([]))},[trip,reason,period]);
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!trip)return;const form=new FormData(e.currentTarget);setBusy(true);setError("");
    try{await apiRequest(`/api/waste/disposal/trips/${trip.trip_id}/explanation`,{method:"POST",body:JSON.stringify({reason,details:form.get("details"),relatedTicketId:reason==="combined_load"?form.get("ticket"):undefined})});onDone(`Explanation for ${trip.trip_number||"the trip"} sent to KCCA.`)}
    catch(err){setError(err instanceof Error?err.message:"Could not send the explanation")}finally{setBusy(false)}
  }
  return <Modal open={Boolean(trip)} title={`Explain ${trip?.trip_number||"trip"}`} description={trip?`${day(trip.route_date)} · ${trip.plate_number||"no vehicle"} · ${trip.route_name}. KCCA reviews every explanation.`:undefined} onClose={onClose}>
    <form onSubmit={submit} className="grid gap-4 text-sm">
      {error&&<Feedback tone="error">{error}</Feedback>}
      <label className="font-medium text-slate-700">What happened<select value={reason} onChange={e=>setReason(e.target.value)} className={field}>{REASONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      {reason==="combined_load"&&<label className="font-medium text-slate-700">Ticket that carried this load<select name="ticket" required className={field}><option value="">Choose a ticket</option>{tickets.map(t=><option key={t.id} value={t.id}>{t.ticket_number} · {t.registration} · {day(t.operation_date)} · {tonnes(t.net_kg)}</option>)}</select></label>}
      <label className="font-medium text-slate-700">Details<textarea name="details" required minLength={5} rows={4} placeholder="Where the load went, who can confirm it, and any reference numbers." className={field}/></label>
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="border border-slate-300 px-4 py-2.5 font-medium text-slate-700">Cancel</button><button disabled={busy} className="bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">{busy?"Sending…":"Send to KCCA"}</button></div>
    </form>
  </Modal>;
}

function LinkDialog({ticket,period,onClose,onDone}:{ticket:Ticket|null;period:string;onClose:()=>void;onDone:(message:string)=>void}){
  const [trips,setTrips]=useState<Trip[]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{
    if(!ticket)return;
    apiRequest<{data:Trip[]}>(`/api/waste/disposal/trips?period=${period}&state=unverified,declared,pending,explanation_review&pageSize=200`)
      .then(r=>setTrips(r.data.filter(t=>plateKey(t.plate_number)===plateKey(ticket.registration)))).catch(()=>setTrips([]));
  },[ticket,period]);
  async function submit(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();if(!ticket)return;setBusy(true);setError("");
    try{await apiRequest(`/api/waste/disposal/tickets/${ticket.id}/link`,{method:"PATCH",body:JSON.stringify({tripId:new FormData(e.currentTarget).get("trip")})});onDone(`${ticket.ticket_number} linked; the trip is verified.`)}
    catch(err){setError(err instanceof Error?err.message:"Could not link the ticket")}finally{setBusy(false)}
  }
  return <Modal open={Boolean(ticket)} title={`Link ${ticket?.ticket_number||"ticket"}`} description={ticket?`${ticket.registration} weighed ${day(ticket.operation_date)} at ${ticket.facility}, ${tonnes(ticket.net_kg)}. Only trips by the same vehicle are listed.`:undefined} onClose={()=>{setTrips(null);onClose()}}>
    <form onSubmit={submit} className="grid gap-4 text-sm">
      {error&&<Feedback tone="error">{error}</Feedback>}
      {trips===null?<p className="text-slate-500">Loading trips…</p>:trips.length?<label className="font-medium text-slate-700">Trip<select name="trip" required className={field}>{trips.map(t=><option key={t.trip_id} value={t.trip_id}>{t.trip_number||"Trip"} · {day(t.route_date)} · {t.route_name} · {STATE[t.state].label}</option>)}</select></label>
        :<p className="text-slate-600">No trip by {ticket?.registration} needs a ticket in this period. If this load was not a collection trip, tell KCCA; they can accept it without a trip.</p>}
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="border border-slate-300 px-4 py-2.5 font-medium text-slate-700">Cancel</button>{trips?.length?<button disabled={busy} className="bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">{busy?"Linking…":"Link ticket"}</button>:null}</div>
    </form>
  </Modal>;
}
