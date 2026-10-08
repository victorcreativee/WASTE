"use client";

import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api";
import { Feedback } from "@/components/ui/System";

type Api<T> = { data: T; message: string };
type Ticket = { id:string; organization_id:string; organization_name:string; ticket_number:string; registration:string; operation_date:string; status:string; trip_id:string|null; trip_number:string|null; net_kg:string|null };
type Trip = { id:string; organization_id:string; trip_number:string; route_name:string; route_date:string; plate_number:string; status:string };

const plate = (value:string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function WeighbridgeReconciliation({roles}:{roles:string[]}) {
  const allowed=roles.some(role=>["kcca_admin","weighbridge_operator"].includes(role));
  const [tickets,setTickets]=useState<Ticket[]>([]),[trips,setTrips]=useState<Trip[]>([]);
  const [choices,setChoices]=useState<Record<string,string>>({}),[error,setError]=useState(""),[saving,setSaving]=useState("");
  async function load(){if(!allowed)return;try{setError("");const[ticketResult,tripResult]=await Promise.all([apiRequest<Api<Ticket[]>>("/api/waste/weighbridge/transactions"),apiRequest<Api<Trip[]>>("/api/waste/trips")]);setTickets(ticketResult.data);setTrips(tripResult.data)}catch(e){setError(e instanceof Error?e.message:"Could not load ticket reconciliation")}}
  useEffect(()=>{void load()},[allowed]);
  const unlinked=useMemo(()=>tickets.filter(ticket=>ticket.status!=="voided"&&!ticket.trip_id),[tickets]);
  const candidates=(ticket:Ticket)=>trips.filter(trip=>trip.organization_id===ticket.organization_id&&plate(trip.plate_number)===plate(ticket.registration)&&["planned","dispatched","in_progress","completed"].includes(trip.status));
  async function link(ticket:Ticket){const tripId=choices[ticket.id];if(!tripId)return;try{setSaving(ticket.id);setError("");await apiRequest(`/api/waste/weighbridge/transactions/${ticket.id}/link-trip`,{method:"PATCH",body:JSON.stringify({tripId})});await load();window.location.reload()}catch(e){setError(e instanceof Error?e.message:"Could not link this ticket")}finally{setSaving("")}}
  if(!allowed)return null;
  return <section className="mx-auto mt-10 max-w-7xl border-t border-slate-300 pt-7">
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-300 pb-3"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[#3156a3]">Data reconciliation</p><h2 className="mt-1 text-xl font-semibold">Unlinked official tickets</h2><p className="mt-1 text-sm text-slate-500">Connect a ticket only when its company and vehicle match the operational trip.</p></div><span className="text-sm font-semibold text-slate-500">{unlinked.length} requiring review</span></div>
    {error&&<div className="mt-4"><Feedback tone="error">{error}</Feedback></div>}
    {!unlinked.length?<p className="border-b py-7 text-sm text-slate-500">All current weighbridge tickets are linked to their operational trips.</p>:<div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left"><thead><tr><th>Ticket</th><th>Responsible company</th><th>Vehicle</th><th>Official net</th><th>Matching company trip</th><th>Action</th></tr></thead><tbody>{unlinked.map(ticket=>{const matches=candidates(ticket);return <tr key={ticket.id}><td><p className="table-primary">{ticket.ticket_number}</p><p className="table-secondary">{ticket.operation_date}</p></td><td>{ticket.organization_name}</td><td>{ticket.registration}</td><td className="font-semibold">{ticket.net_kg?`${Number(ticket.net_kg).toLocaleString()} kg`:"Tare pending"}</td><td>{matches.length?<select aria-label={`Trip for ${ticket.ticket_number}`} value={choices[ticket.id]||""} onChange={event=>setChoices({...choices,[ticket.id]:event.target.value})} className="w-full max-w-sm border px-3 py-2 text-sm"><option value="">Choose matching trip</option>{matches.map(trip=><option key={trip.id} value={trip.id}>{trip.trip_number} · {trip.route_name} · {trip.status.replaceAll("_"," ")}</option>)}</select>:<div><p className="text-sm font-semibold text-amber-700">No matching trip</p><p className="table-secondary">The company must use this vehicle on a WMS trip.</p></div>}</td><td><button disabled={!choices[ticket.id]||saving===ticket.id} onClick={()=>void link(ticket)} className="bg-[#3156a3] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{saving===ticket.id?"Linking…":"Link ticket"}</button></td></tr>})}</tbody></table></div>}
  </section>;
}
