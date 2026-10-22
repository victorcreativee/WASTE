"use client";
import dynamic from "next/dynamic";
import {useCallback,useEffect,useState} from "react";
import {AppShell} from "@/components/layout/AppShell";
import {EmptyState,Feedback,Modal,PageHeader} from "@/components/ui/System";
import {Pagination} from "@/components/ui/Pagination";
import {IssuePenaltyDialog,type PenaltyDraft} from "@/components/penalties/IssuePenaltyDialog";
import {TrackPanel} from "@/components/tracks/TrackPanel";
import {apiRequest} from "@/lib/api";
import {useHasRole} from "@/lib/session";
import {useServerList} from "@/lib/factory";
import {PERIODS} from "@/lib/disposal";
import {STATE,TrackCheck,TrackDetail,km} from "@/lib/tracks";

const TrackMap=dynamic(()=>import("@/components/gis/TrackMap"),{ssr:false,loading:()=><div className="flex h-[300px] items-center justify-center bg-slate-50 text-sm text-slate-500">Loading map…</div>});
type Facility={code:string;name:string;kind:string;is_active:boolean;radius_m:number;latitude:number|null;longitude:number|null};
type Company={id:string;name:string;checked:number;consistent:number;no_gps:number;no_facility_visit:number;ticket_mismatch:number;off_route_stops:number;consistent_rate:number|null;gps_coverage:number|null};
type Overview={rules:{disposalLegHours:number};facilities:{active:number;without_location:number};unchecked_trips:number;totals:{checked:number;consistent:number;no_gps:number;no_facility_visit:number;ticket_mismatch:number;off_route_stops:number};companies:Company[]};
const VIEWS:Array<[string,string]>=[["exceptions","To explain"],["ticket_mismatch","GPS contradicts ticket"],["no_facility_visit","Never reached a facility"],["stops","Off-route stops"],["no_gps","No GPS"],["consistent","Reached a facility"]];
const pct=(v:number|null)=>v===null?"—":`${v.toLocaleString("en-GB",{maximumFractionDigits:1})}%`;

export default function TrackChecksPage(){
  const [period,setPeriod]=useState("30d"),[data,setData]=useState<Overview|null>(null),[view,setView]=useState("exceptions"),[company,setCompany]=useState("");
  const [check,setCheck]=useState<TrackDetail|null>(null),[facilities,setFacilities]=useState<Facility[]>([]),[placing,setPlacing]=useState<Facility|null>(null),[penalty,setPenalty]=useState<PenaltyDraft|null>(null);
  const [error,setError]=useState(""),[message,setMessage]=useState("");
  const canAct=useHasRole("kcca_admin");
  const list=useServerList<TrackCheck>(`/api/waste/tracks/checks?period=${period}&view=${view}${company?`&organizationId=${company}`:""}`);
  const load=useCallback(async()=>{
    try{
      const [o,f]=await Promise.all([apiRequest<{data:Overview}>(`/api/waste/tracks/overview?period=${period}`),apiRequest<{data:Facility[]}>("/api/waste/tracks/facilities")]);
      setData(o.data);setFacilities(f.data);
    }catch(e){setError(e instanceof Error?e.message:"Could not load GPS checks")}
  },[period]);
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer)},[load]);
  async function open(id:string){try{setCheck((await apiRequest<{data:TrackDetail}>(`/api/waste/tracks/checks/${id}`)).data)}catch(e){setError(e instanceof Error?e.message:"Could not open the check")}}
  async function recheck(id:string){
    try{const r=await apiRequest<{data:{state:string}}>(`/api/waste/tracks/checks/${id}/recheck`,{method:"POST"});setMessage(`Trip checked again: ${STATE[r.data.state as keyof typeof STATE].label.toLowerCase()}.`);await Promise.all([load(),list.reload(),open(id)])}
    catch(e){setError(e instanceof Error?e.message:"Could not check the trip")}
  }
  const t=data?.totals,usable=t?t.checked-t.no_gps:0;

  return <AppShell><div className="mx-auto max-w-[1400px] space-y-6">
    <PageHeader eyebrow="City oversight" title="GPS track checks" description={`Each completed trip's GPS track compared with the disposal facilities and its weighbridge ticket, once its ${data?.rules.disposalLegHours??6}-hour disposal leg is over. Shows trips that never reached a facility, tickets recorded while the truck was elsewhere, and long stops off the route.`}
      action={<select aria-label="Period" value={period} onChange={e=>setPeriod(e.target.value)} className="border border-slate-300 bg-white px-3 py-2 text-sm">{PERIODS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}/>
    {error&&<Feedback tone="error">{error}</Feedback>}{message&&<Feedback tone="success">{message}</Feedback>}
    {data&&data.facilities.without_location>0&&<Feedback tone="warning">{data.facilities.without_location} of {data.facilities.active} active disposal facilities have no location yet. Trips can only be checked against facilities with a location; set them below.</Feedback>}

    {t&&<div className="grid grid-cols-2 border border-slate-200 bg-white sm:grid-cols-3 lg:grid-cols-6 rounded-[var(--ui-radius-lg)]">
      {([["Trips checked",t.checked,`${data!.unchecked_trips} not yet checked`],["GPS coverage",pct(t.checked?Math.round(usable/t.checked*1000)/10:null),`${t.no_gps} without a usable track`],["Reached a facility",pct(usable?Math.round(t.consistent/usable*1000)/10:null),`${t.consistent} of ${usable} tracked trips`],["Never reached a facility",t.no_facility_visit,"tracked trips"],["GPS contradicts ticket",t.ticket_mismatch,"tickets to question"],["Off-route stops",t.off_route_stops,"30 minutes or more"]] as const).map(([label,value,hint],i)=>
        <div key={label} className={`px-4 py-3 ${i?"border-l border-slate-200":""}`}><p className="text-xs font-medium text-slate-500">{label}</p><p className={`mt-1 text-xl font-semibold tabular-nums ${(label==="GPS contradicts ticket"||label==="Never reached a facility")&&Number(value)>0?"text-[var(--color-danger)]":"text-slate-900"}`}>{value}</p><p className="text-xs text-slate-500">{hint}</p></div>)}
    </div>}

    {data&&data.companies.length>0&&<div className="table-wrap"><table className="w-full min-w-[900px] text-left">
      <thead><tr><th>Collector</th><th className="text-right">Checked</th><th className="text-right">GPS coverage</th><th className="text-right">Reached a facility</th><th className="text-right">Never reached</th><th className="text-right">Contradicts ticket</th><th className="text-right">Off-route stops</th></tr></thead>
      <tbody>{data.companies.map(c=><tr key={c.id} className={c.id===company?"bg-slate-50":""}>
        <td><button onClick={()=>{setCompany(c.id===company?"":c.id);list.setPage(1)}} className="min-h-0 p-0 text-left font-medium text-slate-900 hover:underline">{c.name}</button></td>
        <td className="text-right tabular-nums">{c.checked}</td><td className="text-right tabular-nums">{pct(c.gps_coverage)}</td><td className="text-right tabular-nums">{pct(c.consistent_rate)}</td>
        <td className={`text-right tabular-nums ${c.no_facility_visit?"text-[var(--color-danger)]":""}`}>{c.no_facility_visit}</td><td className={`text-right tabular-nums ${c.ticket_mismatch?"font-medium text-[var(--color-danger)]":""}`}>{c.ticket_mismatch}</td><td className="text-right tabular-nums">{c.off_route_stops}</td>
      </tr>)}</tbody>
    </table></div>}

    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Show" className="inline-flex flex-wrap overflow-hidden rounded-[var(--ui-radius)] border border-slate-300 bg-white text-sm">
          {VIEWS.map(([value,label],i)=><button key={value} role="radio" aria-checked={view===value} onClick={()=>{setView(value);list.setPage(1)}} className={`min-h-0 rounded-none px-3 py-1.5 ${i?"border-l border-slate-300":""} ${view===value?"bg-slate-900 text-white":"text-slate-700 hover:bg-slate-50"}`}>{label}</button>)}
        </div>
        {company&&<button onClick={()=>setCompany("")} className="min-h-0 p-0 text-sm font-medium text-[var(--color-action)] hover:underline">Show all collectors</button>}
      </div>
      {list.error&&<Feedback tone="error">{list.error}</Feedback>}
      {list.rows.length?<div className="table-wrap"><table className="w-full min-w-[900px] text-left">
        <thead><tr><th>Collector</th><th>Trip</th><th>Truck</th><th>Result</th><th>Ticket</th><th/></tr></thead>
        <tbody>{list.rows.map(c=><tr key={c.trip_id}>
          <td className="table-primary">{c.organization_name}</td>
          <td><p>{c.trip_number||"Trip"}</p><p className="table-secondary">{c.route_name} · {c.route_date}</p></td>
          <td className="font-mono text-sm">{c.plate_number||"—"}</td>
          <td><span className={STATE[c.state].className}>{STATE[c.state].label}</span>{c.off_route_stops>0&&<p className="table-secondary">{c.off_route_stops} off-route stop{c.off_route_stops===1?"":"s"}, longest {c.longest_stop_minutes} min</p>}</td>
          <td>{c.ticket_number?<><p>{c.ticket_number}</p>{c.ticket_gps_distance_m!==null&&<p className={`table-secondary ${c.state==="ticket_mismatch"?"text-[var(--color-danger)]":""}`}>GPS {km(c.ticket_gps_distance_m)} away</p>}</>:"—"}</td>
          <td className="text-right"><button onClick={()=>void open(c.trip_id)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">Map</button></td>
        </tr>)}</tbody>
      </table></div>:!list.loading&&<EmptyState title="No trips in this view"/>}
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} totalPages={list.totalPages} onPage={list.setPage} onPageSize={list.setPageSize}/>
    </section>

    <section><h2 className="mb-2 font-semibold">Disposal facility areas</h2>
      <div className="table-wrap"><table className="w-full text-left"><thead><tr><th>Facility</th><th>Location</th><th className="text-right">Area radius</th><th/></tr></thead>
        <tbody>{facilities.map(f=><tr key={f.code} className={f.is_active?"":"text-slate-400"}><td><p className="table-primary">{f.name}</p><p className="table-secondary">{f.code}{f.is_active?"":" · not in use"}</p></td>
          <td>{f.latitude!==null?`${Number(f.latitude).toFixed(5)}, ${Number(f.longitude).toFixed(5)}`:<span className="text-[var(--color-warning)]">Not set</span>}</td><td className="text-right tabular-nums">{f.radius_m} m</td>
          <td className="text-right">{canAct&&<button onClick={()=>setPlacing(f)} className="border border-slate-300 px-3 py-2 text-xs text-slate-700">{f.latitude!==null?"Change":"Set location"}</button>}</td></tr>)}</tbody></table></div></section>

    {check&&<TrackPanel check={check} onClose={()=>setCheck(null)} actions={canAct?<div className="flex flex-wrap gap-2 border-y border-slate-100 py-4">
      <button onClick={()=>void recheck(check.trip_id)} className="border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Check again</button>
      {(check.state==="ticket_mismatch"||check.state==="no_facility_visit")&&<button onClick={()=>setPenalty({organizationId:check.organization_id,organizationName:check.organization_name,scheduleCode:"UNVERIFIED_DISPOSAL",source:`GPS check of ${check.trip_number||"trip"}`,
        grounds:check.state==="ticket_mismatch"?`Trip ${check.trip_number||""} (${check.plate_number||"truck"}, ${check.route_date}): weighbridge ticket ${check.ticket_number} was recorded at ${check.ticket_facility} while the truck's GPS placed it ${km(check.ticket_gps_distance_m)} from that facility.`
          :`Trip ${check.trip_number||""} (${check.plate_number||"truck"}, ${check.route_date}): the truck's GPS track (${check.gps_points} points) never entered a disposal facility's area during the trip or the following ${check.rules.disposalLegHours} hours.`})} className="border border-[var(--color-danger)] px-3 py-2 text-xs font-semibold text-[var(--color-danger)]">Issue penalty</button>}
    </div>:null}/>}
    <FacilityPlacement facility={placing} onClose={()=>setPlacing(null)} onSaved={text=>{setPlacing(null);setMessage(text);void load()}}/>
    <IssuePenaltyDialog draft={penalty} onClose={()=>setPenalty(null)} onIssued={text=>{setPenalty(null);setMessage(text)}}/>
  </div></AppShell>;
}

function FacilityPlacement({facility,onClose,onSaved}:{facility:Facility|null;onClose:()=>void;onSaved:(message:string)=>void}){
  const [point,setPoint]=useState<{latitude:number;longitude:number}|null>(null),[radius,setRadius]=useState(300),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{if(facility){setPoint(facility.latitude!==null?{latitude:Number(facility.latitude),longitude:Number(facility.longitude)}:null);setRadius(facility.radius_m);setError("")}},[facility]);
  async function save(){
    if(!facility||!point)return setError("Click the facility's gate on the map");
    setBusy(true);
    try{await apiRequest(`/api/waste/tracks/facilities/${facility.code}/location`,{method:"PUT",body:JSON.stringify({...point,radiusM:radius})});onSaved(`${facility.name}: location saved.`)}
    catch(e){setError(e instanceof Error?e.message:"Could not save")}finally{setBusy(false)}
  }
  return <Modal open={Boolean(facility)} title={`Where is ${facility?.name||"the facility"}?`} description="Click the weighbridge or gate. Trucks within the radius count as having reached the facility." onClose={onClose}>
    <div className="grid gap-4 text-sm">
      {error&&<Feedback tone="error">{error}</Feedback>}
      <div className="overflow-hidden border border-slate-200"><TrackMap facilities={point&&facility?[{code:facility.code,name:facility.name,latitude:point.latitude,longitude:point.longitude,radius_m:radius}]:[]} onPick={(latitude,longitude)=>setPoint({latitude,longitude})} height={300}/></div>
      <p className="text-xs text-slate-500">{point?`${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`:"No location chosen yet."}</p>
      <label className="font-medium text-slate-700">Area radius: {radius} m<input type="range" min={50} max={3000} step={50} value={radius} onChange={e=>setRadius(Number(e.target.value))} className="mt-2 block w-full"/></label>
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="border border-slate-300 px-4 py-2.5 font-medium text-slate-700">Cancel</button><button onClick={()=>void save()} disabled={busy} className="bg-[var(--color-action)] px-4 py-2.5 font-semibold text-white disabled:opacity-50">{busy?"Saving…":"Save location"}</button></div>
    </div>
  </Modal>;
}
