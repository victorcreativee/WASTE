"use client";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,PageHeader} from "@/components/ui/System";
import {apiRequest} from "@/lib/api";
import {useHasRole} from "@/lib/session";

type Sums={trips:number;shared:number;not_shared:number;no_points:number;without_gaps:number;avg_coverage_pct:string|null;longest_gap_minutes:string;gaps:number};
type Quality={thresholdMinutes:number;totals:Sums;groups:(Sums&{id:string|null;name:string})[];
  trips:{trip_id:string;trip_number:string|null;route_name:string;organization:string;plate_number:string|null;started_local:string;trip_minutes:string;sharing:string;points:number;gaps:number;gap_minutes:string;longest_gap_minutes:string;coverage_pct:string|null}[]};
type Driver={id:string;full_name:string;phone:string|null;status:string;trips_completed:number;trips_cancelled:number;trips_verified:number;last_trip:string|null;
  stops_due:number;stops_completed:number;stops_missed:number;top_reason:string|null;receipts:number};

const field="mt-1 w-full border border-slate-300 px-3 py-2.5 font-normal";
const kampalaDay=(offset=0)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Kampala"}).format(new Date(Date.now()+offset*86400000));
const share=(a:number,b:number)=>b?Math.round(a/b*100):null;
const n=(v:number|string)=>Number(v).toLocaleString("en-GB",{maximumFractionDigits:1});
const day=(v:string)=>new Date(v.replace(" ","T")).toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});

function Pct({a,b,low}:{a:number;b:number;low:number}){
  const v=share(a,b);return v===null?<span className="text-slate-400">—</span>:<span className={v<low?"font-semibold text-[var(--color-warning)]":""}>{v}%</span>;
}

export default function FleetQualityPage(){
  const kcca=useHasRole("kcca_admin"),systemAdmin=useHasRole("system_admin"),regulator=kcca||systemAdmin;
  const [from,setFrom]=useState(()=>kampalaDay(-29)),[to,setTo]=useState(()=>kampalaDay());
  const [quality,setQuality]=useState<Quality|null>(null),[drivers,setDrivers]=useState<Driver[]|null>(null),[error,setError]=useState("");
  const load=useCallback(async()=>{
    try{
      const q=`from=${from}&to=${to}`;
      setQuality((await apiRequest<{data:Quality}>(`/api/waste/fleet/gps-quality?${q}`)).data);
      if(!regulator)setDrivers((await apiRequest<{data:Driver[]}>(`/api/waste/fleet/driver-scorecards?${q}`)).data);
    }catch(e){setError(e instanceof Error?e.message:"Could not load fleet records")}
  },[from,to,regulator]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  const t=quality?.totals,tracked=t?t.trips-t.not_shared:0;

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow={regulator?"City oversight":"Service delivery"} title={regulator?"GPS data completeness":"GPS and driver records"}
      description={regulator?"Whether each operator's trips are fully tracked. The pilot target is no gap longer than 5 minutes between positions on a trip. Trips whose driver has not agreed to location sharing are counted apart, never as gaps.":"How completely your trips are tracked, and each driver's collection and disposal record. Driver records use collections, receipts and weighbridge tickets only: location data is not used to rate drivers, because the location notice drivers agreed to does not name that purpose."}/>
    {error&&<Feedback tone="error">{error}</Feedback>}
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <label className="font-medium text-slate-700">From<input type="date" value={from} max={to} onChange={e=>e.target.value&&setFrom(e.target.value)} className={`${field} w-44`}/></label>
      <label className="font-medium text-slate-700">To<input type="date" value={to} min={from} onChange={e=>e.target.value&&setTo(e.target.value)} className={`${field} w-44`}/></label>
    </div>

    {quality&&t&&<>
      <div className="grid grid-cols-2 rounded-[var(--ui-radius-lg)] border border-slate-200 bg-white lg:grid-cols-4">
        <Tile label={`Trips with no gap over ${quality.thresholdMinutes} min`} value={share(t.without_gaps,tracked)===null?"—":`${share(t.without_gaps,tracked)}%`} note={`${n(t.without_gaps)} of ${n(tracked)} tracked trips`} warn={tracked>0&&t.without_gaps<tracked}/>
        <Tile label="Average coverage" value={t.avg_coverage_pct===null?"—":`${n(t.avg_coverage_pct)}%`} note="share of trip time without a long gap" border/>
        <Tile label="Longest gap" value={`${n(t.longest_gap_minutes)} min`} note={`${n(t.gaps)} gaps over ${quality.thresholdMinutes} min in all`} border warn={Number(t.longest_gap_minutes)>quality.thresholdMinutes}/>
        <Tile label="Trips without sharing" value={n(t.not_shared)} note={`driver had not agreed · ${n(t.no_points)} agreed but sent nothing`} border/>
      </div>

      <section><h2 className="mb-2 text-lg font-semibold text-slate-950">{regulator?"By operator":"By vehicle"}</h2>
        {quality.groups.length?<div className="table-wrap"><table className="w-full min-w-[760px] text-left">
          <thead><tr><th>{regulator?"Operator":"Vehicle"}</th><th className="text-right">Trips</th><th className="text-right">No gap over {quality.thresholdMinutes} min</th><th className="text-right">Average coverage</th><th className="text-right">Longest gap</th><th className="text-right">Not shared</th></tr></thead>
          <tbody>{quality.groups.map(g=><tr key={g.id??g.name}><td className="table-primary">{g.name}</td><td className="text-right tabular-nums">{g.trips}</td>
            <td className="text-right tabular-nums"><Pct a={g.without_gaps} b={g.trips-g.not_shared} low={95}/></td>
            <td className="text-right tabular-nums">{g.avg_coverage_pct===null?"—":`${n(g.avg_coverage_pct)}%`}</td>
            <td className="text-right tabular-nums">{n(g.longest_gap_minutes)} min</td><td className="text-right tabular-nums">{g.not_shared}</td></tr>)}</tbody></table></div>
          :<EmptyState title="No ended trips in this period" description="Trips are summarised within an hour of ending."/>}
      </section>

      <section><h2 className="mb-2 text-lg font-semibold text-slate-950">Trips with gaps</h2>
        {quality.trips.length?<div className="table-wrap"><table className="w-full min-w-[900px] text-left">
          <thead><tr><th>Trip</th>{regulator&&<th>Operator</th>}<th>Vehicle</th><th>Started</th><th className="text-right">Length</th><th className="text-right">Gaps</th><th className="text-right">Longest</th><th className="text-right">Coverage</th></tr></thead>
          <tbody>{quality.trips.map(x=><tr key={x.trip_id}><td><p className="table-primary">{x.trip_number??"—"}</p><p className="table-secondary">{x.route_name}</p></td>
            {regulator&&<td>{x.organization}</td>}<td>{x.plate_number??"—"}</td><td>{day(x.started_local)}</td><td className="text-right tabular-nums">{n(x.trip_minutes)} min</td>
            <td className="text-right tabular-nums">{x.sharing==="no_points"?<span className="text-[var(--color-danger)]">no positions</span>:`${x.gaps} · ${n(x.gap_minutes)} min`}</td>
            <td className="text-right tabular-nums">{n(x.longest_gap_minutes)} min</td><td className="text-right tabular-nums">{x.coverage_pct===null?"—":`${n(x.coverage_pct)}%`}</td></tr>)}</tbody></table></div>
          :<p className="text-sm text-slate-600">No tracked trip had a gap over {quality.thresholdMinutes} minutes.</p>}
        <p className="mt-2 text-xs text-slate-500">A gap is any stretch over {quality.thresholdMinutes} minutes without a position, including at the start or end of the trip. Common causes: the phone lost signal or battery, the app was closed, or the driver withdrew location sharing mid-trip. Summaries are kept after positions are deleted under the retention period.</p>
      </section>
    </>}

    {!regulator&&drivers&&<section><h2 className="mb-2 text-lg font-semibold text-slate-950">Drivers</h2>
      {drivers.length?<div className="table-wrap"><table className="w-full min-w-[900px] text-left">
        <thead><tr><th>Driver</th><th className="text-right">Trips</th><th className="text-right">Collections done</th><th className="text-right">Missed</th><th>Most common reason</th><th className="text-right">Trips weighed at KCCA</th><th className="text-right">Receipts</th></tr></thead>
        <tbody>{drivers.map(d=><tr key={d.id}><td><p className="table-primary">{d.full_name}</p><p className="table-secondary">{d.last_trip?`last trip ${new Date(`${d.last_trip}T00:00:00`).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}`:"no trips in period"}</p></td>
          <td className="text-right tabular-nums">{d.trips_completed}{d.trips_cancelled?<p className="table-secondary">{d.trips_cancelled} cancelled</p>:null}</td>
          <td className="text-right tabular-nums"><Pct a={d.stops_completed} b={d.stops_due} low={90}/><p className="table-secondary">{d.stops_completed} of {d.stops_due}</p></td>
          <td className={`text-right tabular-nums ${d.stops_missed?"text-[var(--color-danger)]":""}`}>{d.stops_missed}</td>
          <td>{d.top_reason?d.top_reason.replace(/_/g," "):<span className="text-slate-400">—</span>}</td>
          <td className="text-right tabular-nums"><Pct a={d.trips_verified} b={d.trips_completed} low={95}/><p className="table-secondary">{d.trips_verified} of {d.trips_completed}</p></td>
          <td className="text-right tabular-nums">{d.receipts}</td></tr>)}</tbody></table></div>
        :<EmptyState title="No drivers" description="Drivers appear here once they are added under Trips & drivers."/>}
      <p className="mt-2 text-xs text-slate-500">Collections done: completed stops of those due on jobs assigned to the driver. Trips weighed at KCCA: completed trips with a completed weighbridge ticket (disposal verification).</p>
    </section>}
  </div></AppShell>;
}

function Tile({label,value,note,border=false,warn=false}:{label:string;value:string;note:string;border?:boolean;warn?:boolean}){
  return <div className={`px-4 py-3 ${border?"border-l border-slate-200":""}`}><p className="text-xs font-medium text-slate-500">{label}</p>
    <p className={`mt-1 text-xl font-semibold tabular-nums ${warn?"text-[var(--color-warning)]":"text-slate-900"}`}>{value}</p><p className="text-xs text-slate-500">{note}</p></div>;
}
