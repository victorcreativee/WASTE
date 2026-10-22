"use client";
import dynamic from "next/dynamic";
import type {ReactNode} from "react";
import {STATE,TrackDetail,km,time} from "@/lib/tracks";

const TrackMap=dynamic(()=>import("@/components/gis/TrackMap"),{ssr:false,loading:()=><div className="flex h-[360px] items-center justify-center bg-slate-50 text-sm text-slate-500">Loading map…</div>});
const day=(iso:string)=>new Date(`${iso.slice(0,10)}T00:00:00`).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});

/** Side panel with a trip's GPS check: the map, what was found and why; the caller supplies the actions its role may take. */
export function TrackPanel({check,onClose,actions}:{check:TrackDetail;onClose:()=>void;actions?:ReactNode}){
  return <div className="anim-fade fixed inset-0 z-[1500] flex justify-end bg-slate-900/40" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section className="h-full w-full max-w-3xl overflow-y-auto bg-white">
      <header className="sticky top-0 z-[1000] flex items-start justify-between gap-5 border-b border-slate-200 bg-white px-6 py-5">
        <div><p className="text-xs font-medium text-slate-500">{check.organization_name} · {check.plate_number||"truck"} · {day(check.route_date)}</p><h2 className="mt-1 text-xl font-semibold">{check.trip_number||"Trip"} · {check.route_name}</h2>
          <div className="mt-2"><span className={STATE[check.state].className}>{STATE[check.state].label}</span></div></div>
        <button onClick={onClose} className="text-sm font-medium text-slate-500 hover:text-slate-900">Close</button>
      </header>
      <div className="space-y-6 px-6 py-6 text-sm">
        <p className="text-slate-600">{STATE[check.state].help}</p>
        <div className="overflow-hidden border border-slate-200"><TrackMap track={check.points} facilities={check.facilities} stops={check.stops} routeLine={check.route_line} ticketFacilityCode={check.ticket_facility_code} height={360}/></div>
        <p className="text-xs text-slate-500">Black line: GPS track (green dot first point). Dashed grey: planned route. Circles: facility areas (blue where the ticket was recorded). Orange dots: stops of {check.rules.stopMinutes} minutes or more, red when off route.</p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          <div><dt className="text-xs text-slate-500">GPS points</dt><dd className="text-slate-900">{check.gps_points}{check.first_point_at?` · ${time(check.first_point_at)} to ${time(check.last_point_at)}`:""}</dd></div>
          <div><dt className="text-xs text-slate-500">Facility reached</dt><dd className="text-slate-900">{check.facility_name?`${check.facility_name} at ${time(check.facility_visit_at)}`:"None"}</dd></div>
          <div><dt className="text-xs text-slate-500">Weighbridge ticket</dt><dd className="text-slate-900">{check.ticket_number?`${check.ticket_number}, ${check.ticket_facility} at ${time(check.ticket_arrival_at)}`:"No ticket linked"}</dd></div>
          <div><dt className="text-xs text-slate-500">GPS at ticket time</dt><dd className={check.state==="ticket_mismatch"?"font-medium text-[var(--color-danger)]":"text-slate-900"}>{check.ticket_gps_distance_m===null?(check.ticket_number?`No GPS within ${check.rules.ticketToleranceMinutes} min of the ticket`:"—"):`${km(check.ticket_gps_distance_m)} from the facility`}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-slate-500">Long stops</dt><dd className="text-slate-900">{check.stops.length?check.stops.map(s=>`${s.minutes} min from ${time(s.from)}${s.offRoute?" (off route)":s.offRoute===null?" (route line unknown)":""}`).join("; "):"None"}</dd></div>
        </dl>
        {actions}
        <p className="text-xs text-slate-500">Checked {new Date(check.checked_at).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"})}. Trips are checked once their {check.rules.disposalLegHours}-hour disposal leg ends, and again for a few days if late GPS data arrives.</p>
      </div>
    </section>
  </div>;
}
