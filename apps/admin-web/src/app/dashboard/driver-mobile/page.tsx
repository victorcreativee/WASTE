"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiRequest } from "@/lib/api";
import { OrganizationWorkspaceNav } from "@/components/layout/OrganizationWorkspaceNav";
import {PageHeader} from "@/components/ui/System";

type Driver = {
  id: string;
  full_name: string;
  phone: string | null;
  license_number: string | null;
  status: string;
};

type DriverJob = {
  id: string;
  zone_name: string | null;
  plate_number: string | null;
  truck_name: string | null;
  driver_name: string | null;
  job_date: string;
  status: string;
  waste_type: string;
  estimated_weight_kg: string | null;
  collected_weight_kg: string | null;
  notes: string | null;
};

type JobProblem = {
  id: string;
  job_id: string;
  category: string;
  description: string;
  status: string;
  zone_name: string | null;
  driver_name: string;
  plate_number: string | null;
};

type DriverRoute = {
  id: string; name: string; route_date: string; status: string;
  plate_number: string | null; driver_name?:string|null; total_distance_km: string | null;
  estimated_duration_minutes: number | null; stop_count: number; completed_stop_count: number;
};
type RouteStop = {
  id: string; stop_order: number; status: string; zone_name: string | null;
  latitude: string | null; longitude: string | null; waste_type: string;
  estimated_weight_kg: string | null; collected_weight_kg: string | null;
  customer_stops: { id:string; status:string; stop_order:number; customer_name:string; address:string; completed_at:string|null; collected_weight_kg:string|null; evidence_url:string|null; completion_notes:string|null; exception_reason:string|null; exception_notes:string|null }[];
};
type RouteDetails = DriverRoute & { stops: RouteStop[] };
type ApiResponse<T> = { success: boolean; message: string; data: T };

type ApiListResponse<T> = {
  success: boolean;
  message: string;
  data: T[];
};

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}
function StatusText({value}:{value:string}) { return <span className={`status status-${value.replaceAll('_','-')}`}>{formatLabel(value)}</span>; }

function formatJobDate(value: string) {
  if (!value) return "No date";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function statusClass(status: string) {
  if (status === "completed")
    return "bg-emerald-50 text-emerald-700 border-emerald-200";

  if (status === "in_progress")
    return "bg-blue-50 text-blue-700 border-blue-200";

  if (status === "assigned")
    return "bg-indigo-50 text-indigo-700 border-indigo-200";

  return "bg-slate-50 text-slate-700 border-slate-200";
}

function readStoredRole() {
  const storedUser = sessionStorage.getItem("currentUser");
  if (!storedUser) return "unknown";

  try {
    const roles: string[] = JSON.parse(storedUser).roles ?? [];
    return roles.includes("driver") ? "driver" : roles.includes("company_admin") ? "company_admin" : "dispatcher";
  } catch {
    return "unknown";
  }
}

function subscribeToStoredRole() {
  return () => undefined;
}

export default function DriverMobilePage() {
  const storedRole = useSyncExternalStore(
    subscribeToStoredRole,
    readStoredRole,
    () => "hydrating"
  );
  const isDriverAccount = storedRole === "driver";
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [jobs, setJobs] = useState<DriverJob[]>([]);
  const [problems, setProblems] = useState<JobProblem[]>([]);
  const [routes, setRoutes] = useState<DriverRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<RouteDetails | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [collectedWeights, setCollectedWeights] = useState<
    Record<string, string>
  >({});
  const [problemDrafts, setProblemDrafts] = useState<
    Record<string, { category: string; description: string }>
  >({});
  const [stopDrafts, setStopDrafts] = useState<Record<string, { weight: string; notes: string }>>({});
  const [skipTarget, setSkipTarget] = useState<{id:string;name:string}|null>(null);
  const [proofTarget,setProofTarget]=useState<{id:string;name:string}|null>(null);
  const [proofWeight,setProofWeight]=useState("");
  const [proofNotes,setProofNotes]=useState("");
  const [proofPhoto,setProofPhoto]=useState("");
  const [proofLocation,setProofLocation]=useState("");
  const [tripSummary,setTripSummary]=useState<{name:string;date:string;truck:string;driver:string;stops:number;collected:number;notCollected:number;weight:number}|null>(null);
  const [skipReason, setSkipReason] = useState("blocked_access");
  const [skipNotes, setSkipNotes] = useState("");
  const [locationSharing,setLocationSharing]=useState<"off"|"sharing"|"blocked">("off");
  const lastLocationSent=useRef(0);

  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedDriver = useMemo(() => {
    return drivers.find((driver) => driver.id === selectedDriverId);
  }, [drivers, selectedDriverId]);

  async function loadDriverJobs(
    driverId = "",
    driverAccount = isDriverAccount
  ) {
    if (!driverAccount && !driverId) {
      setJobs([]);
      return;
    }

    try {
      setLoadingJobs(true);
      setError("");

      const response = await apiRequest<ApiListResponse<DriverJob>>(
        driverAccount
          ? "/api/waste/driver/jobs"
          : `/api/waste/drivers/${driverId}/jobs`
      );

      setJobs(response.data);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to load driver jobs"
      );
    } finally {
      setLoadingJobs(false);
    }
  }

  async function startJob(jobId: string) {
    try {
      setSaving(true);
      setError("");

      await apiRequest(`/api/waste/driver-jobs/${jobId}/start`, {
        method: "PATCH",
      });

      await loadDriverJobs(selectedDriverId);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to start job");
    } finally {
      setSaving(false);
    }
  }

  async function completeJob(jobId: string) {
    const collectedWeight = collectedWeights[jobId];

    try {
      setSaving(true);
      setError("");

      await apiRequest(`/api/waste/driver-jobs/${jobId}/complete`, {
        method: "PATCH",
        body: JSON.stringify({
          collectedWeightKg: collectedWeight
            ? Number(collectedWeight)
            : undefined,
        }),
      });

      setCollectedWeights((current) => ({
        ...current,
        [jobId]: "",
      }));

      await loadDriverJobs(selectedDriverId);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to complete job"
      );
    } finally {
      setSaving(false);
    }
  }

  async function loadProblems() {
    const response = await apiRequest<ApiListResponse<JobProblem>>(
      "/api/waste/driver-job-problems"
    );
    setProblems(response.data);
  }

  async function loadRoutes(driverId = "", driverAccount = isDriverAccount) {
    if (!driverAccount && !driverId) { setRoutes([]); setSelectedRoute(null); return; }
    const response = await apiRequest<ApiListResponse<DriverRoute>>(
      driverAccount ? "/api/waste/driver/routes" : `/api/waste/drivers/${driverId}/routes`
    );
    setRoutes(response.data);
    if (response.data.length) await loadRouteDetails(response.data[0].id);
    else setSelectedRoute(null);
  }

  async function loadRouteDetails(routeId: string) {
    const response = await apiRequest<ApiResponse<RouteDetails>>(`/api/waste/driver-routes/${routeId}`);
    setSelectedRoute(response.data);
  }

  async function startRoute(routeId: string) {
    try {
      setSaving(true); setError("");
      await apiRequest(`/api/waste/driver-routes/${routeId}/start`, { method: "PATCH" });
      await loadRoutes(selectedDriverId);
    } catch (routeError) { setError(routeError instanceof Error ? routeError.message : "Failed to start route"); }
    finally { setSaving(false); }
  }

  useEffect(()=>{
    if(!isDriverAccount||selectedRoute?.status!=="in_progress"||!navigator.geolocation)return;
    const watch=navigator.geolocation.watchPosition(position=>{
      setLocationSharing("sharing");
      if(Date.now()-lastLocationSent.current<15000)return;
      lastLocationSent.current=Date.now();
      void apiRequest("/api/waste/fleet/live/location",{method:"POST",body:JSON.stringify({routeId:selectedRoute.id,latitude:position.coords.latitude,longitude:position.coords.longitude,accuracyM:position.coords.accuracy,speedKph:position.coords.speed===null?undefined:position.coords.speed*3.6,headingDegrees:position.coords.heading??undefined,recordedAt:new Date(position.timestamp).toISOString()})}).catch(()=>setLocationSharing("blocked"));
    },()=>setLocationSharing("blocked"),{enableHighAccuracy:true,maximumAge:10000,timeout:20000});
    return()=>navigator.geolocation.clearWatch(watch);
  },[isDriverAccount,selectedRoute?.id,selectedRoute?.status]);

  async function arriveAtStop(stopId: string) {
    try {
      setSaving(true); setError("");
      await apiRequest(`/api/waste/driver-route-stops/${stopId}/arrive`, { method: "PATCH" });
      if (selectedRoute) await loadRouteDetails(selectedRoute.id);
    } catch (stopError) { setError(stopError instanceof Error ? stopError.message : "Failed to record arrival"); }
    finally { setSaving(false); }
  }

  async function completeStop(stopId: string) {
    const draft = stopDrafts[stopId] || { weight: "", notes: "" };
    try {
      setSaving(true); setError("");
      const response=await apiRequest<ApiResponse<{route_completed:boolean}>>(`/api/waste/driver-route-stops/${stopId}/complete`, {
        method: "PATCH",
        body: JSON.stringify({
          collectedWeightKg: draft.weight ? Number(draft.weight) : undefined,
          completionNotes: draft.notes || undefined,
        }),
      });
      setStopDrafts((current) => ({ ...current, [stopId]: { weight: "", notes: "" } }));
      if(response.data.route_completed&&selectedRoute){
        const customers=selectedRoute.stops.flatMap(stop=>stop.customer_stops||[]);
        setTripSummary({name:selectedRoute.name,date:selectedRoute.route_date,truck:selectedRoute.plate_number||"Not recorded",driver:selectedRoute.driver_name||"Assigned driver",stops:customers.length,collected:customers.filter(customer=>customer.status==='completed').length,notCollected:customers.filter(customer=>customer.status==='skipped').length,weight:selectedRoute.stops.reduce((sum,stop)=>sum+Number(stop.collected_weight_kg||0),0)+Number(draft.weight||0)});
      }
      await loadRoutes(selectedDriverId);
    } catch (stopError) { setError(stopError instanceof Error ? stopError.message : "Failed to complete stop"); }
    finally { setSaving(false); }
  }

  async function updateCustomerStop(stopId:string,action:"arrive"|"complete"|"skip",details:Record<string,unknown>={}) {
    try {
      setSaving(true); setError("");
      await apiRequest(`/api/waste/customer-collection-stops/${stopId}`, {method:"PATCH",body:JSON.stringify({action,...details})});
      if(action==='skip'){setSkipTarget(null);setSkipReason('blocked_access');setSkipNotes('');}
      if(action==='complete'){setProofTarget(null);setProofWeight('');setProofNotes('');setProofPhoto('');setProofLocation('');}
      if (selectedRoute) await loadRouteDetails(selectedRoute.id);
    } catch (stopError) { setError(stopError instanceof Error ? stopError.message : "Failed to update household stop"); }
    finally { setSaving(false); }
  }

  function openCollectionProof(id:string,name:string){
    setProofTarget({id,name});setProofWeight("");setProofNotes("");setProofPhoto("");setProofLocation("Locating…");
    if(!navigator.geolocation){setProofLocation("GPS unavailable on this device");return;}
    navigator.geolocation.getCurrentPosition(position=>setProofLocation(`${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)} · ±${Math.round(position.coords.accuracy)} m`),()=>setProofLocation("GPS permission not available"),{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
  }

  function readProofPhoto(file:File|undefined){
    if(!file)return;
    if(!file.type.startsWith("image/")){setError("Collection proof must be an image.");return;}
    if(file.size>2*1024*1024){setError("Collection proof image must be 2 MB or smaller.");return;}
    const reader=new FileReader();reader.onload=()=>setProofPhoto(String(reader.result||""));reader.onerror=()=>setError("Could not read the collection proof image.");reader.readAsDataURL(file);
  }

  async function reportProblem(jobId: string) {
    const draft = problemDrafts[jobId] || { category: "blocked_access", description: "" };
    try {
      setSaving(true);
      setError("");
      await apiRequest(`/api/waste/driver-jobs/${jobId}/problems`, {
        method: "POST",
        body: JSON.stringify(draft),
      });
      setProblemDrafts((current) => ({
        ...current,
        [jobId]: { category: "blocked_access", description: "" },
      }));
      await loadProblems();
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : "Failed to report problem");
    } finally {
      setSaving(false);
    }
  }

  async function updateProblem(problemId: string, status: "acknowledged" | "resolved") {
    try {
      setSaving(true);
      setError("");
      await apiRequest(`/api/waste/driver-job-problems/${problemId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await loadProblems();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update problem");
    } finally {
      setSaving(false);
    }
  }

  // Session role changes are the only boundary that should reload this operational workspace.
  useEffect(() => {
    apiRequest<ApiListResponse<JobProblem>>("/api/waste/driver-job-problems")
      .then((response) => setProblems(response.data))
      .catch((loadError: unknown) =>
        setError(loadError instanceof Error ? loadError.message : "Failed to load job problems")
      );
    if (storedRole === "driver") {
      apiRequest<ApiListResponse<DriverRoute>>("/api/waste/driver/routes")
        .then(async (response) => {
          setRoutes(response.data);
          if (response.data.length) {
            const details = await apiRequest<ApiResponse<RouteDetails>>(
              `/api/waste/driver-routes/${response.data[0].id}`
            );
            setSelectedRoute(details.data);
          }
        })
        .catch((routeError: unknown) =>
          setError(routeError instanceof Error ? routeError.message : "Failed to load routes")
        );
      apiRequest<ApiListResponse<DriverJob>>("/api/waste/driver/jobs")
        .then((response) => setJobs(response.data))
        .catch((error: unknown) =>
          setError(
            error instanceof Error ? error.message : "Failed to load driver jobs"
          )
        )
        .finally(() => {
          setLoadingDrivers(false);
          setLoadingJobs(false);
        });
    }

    if (storedRole === "dispatcher") {
      apiRequest<ApiListResponse<Driver>>("/api/waste/drivers")
        .then((response) => {setDrivers(response.data);const first=response.data[0];if(first){setSelectedDriverId(first.id);void loadDriverJobs(first.id,false);void loadRoutes(first.id,false);}})
        .catch((error: unknown) =>
          setError(
            error instanceof Error ? error.message : "Failed to load drivers"
          )
        )
        .finally(() => setLoadingDrivers(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedRole]);

  function selectDriver(driverId: string) {
    setSelectedDriverId(driverId);
    void loadDriverJobs(driverId, false);
    void loadRoutes(driverId, false);
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl">
        {!isDriverAccount&&<OrganizationWorkspaceNav/>}
        <PageHeader eyebrow={isDriverAccount?"Driver workspace":"Field operations"} title={isDriverAccount?"Today’s route":"Trips & drivers"} description={isDriverAccount?"Follow the assigned route in order, record every collection outcome, and report blockers to dispatch.":"Check driver readiness, inspect assigned routes, and respond to operational blockers."}/>

        {error && (
          <div className="mt-6 border-l-4 border-red-600 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <section className="mt-8 border border-slate-200 bg-white">
          <div className="flex flex-col justify-between gap-4 border-b border-slate-200 p-5 md:flex-row md:items-center">
            <div><h2 className="text-xl font-black text-slate-950">Assigned route</h2><p className="mt-1 text-sm text-slate-500">Follow stops in order so dispatch receives reliable progress.</p></div>
            {routes.length > 1 && <select value={selectedRoute?.id || ""} onChange={(event)=>loadRouteDetails(event.target.value)} className="border border-slate-300 px-3 py-2 text-sm">{routes.map((route)=><option key={route.id} value={route.id}>{route.name}</option>)}</select>}
          </div>
          {!selectedRoute ? <p className="p-5 text-sm text-slate-500">No active route assigned.</p> : <div className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div><h3 className="text-2xl font-black">{selectedRoute.name}</h3><p className="mt-2 text-sm text-slate-500">{formatJobDate(selectedRoute.route_date)} · Truck {selectedRoute.plate_number || "not assigned"}{selectedRoute.total_distance_km ? ` · ${selectedRoute.total_distance_km} km` : ""}{selectedRoute.estimated_duration_minutes ? ` · ${selectedRoute.estimated_duration_minutes} min` : ""}</p>{isDriverAccount&&selectedRoute.status==="in_progress"&&<p className={`mt-2 text-xs font-semibold ${locationSharing==="sharing"?"text-[#3156a3]":locationSharing==="blocked"?"text-red-700":"text-slate-500"}`}>{locationSharing==="sharing"?"Live location sharing is active":locationSharing==="blocked"?"Location sharing is blocked. Allow location access to help dispatch monitor this route.":"Starting location sharing…"}</p>}</div>
              {isDriverAccount && ["planned","dispatched"].includes(selectedRoute.status) && <button disabled={saving} type="button" onClick={()=>startRoute(selectedRoute.id)} className="bg-[#3156a3] px-5 py-3 text-sm font-bold text-white">Start route</button>}
            </div>
            <div className="mt-5 h-1 overflow-hidden bg-slate-200"><div className="h-full bg-[#3156a3]" style={{width:`${selectedRoute.stops.length ? Math.round(selectedRoute.stops.filter((stop)=>stop.status==="completed").length / selectedRoute.stops.length * 100) : 0}%`}} /></div>
            <p className="mt-2 text-xs font-bold text-slate-500">{selectedRoute.stops.filter((stop)=>stop.status==="completed").length} of {selectedRoute.stops.length} stops completed</p>
            {isDriverAccount&&<div className="mt-5 grid border-y border-slate-200 text-sm sm:grid-cols-3"><div className={`px-4 py-3 ${["planned","dispatched"].includes(selectedRoute.status)?"border-l-2 border-[#3156a3] bg-blue-50":"text-slate-500"}`}><p className="text-xs font-semibold uppercase tracking-wide">1 · Begin</p><p className="mt-1 font-semibold">Start assigned route</p></div><div className={`border-t border-slate-200 px-4 py-3 sm:border-l sm:border-t-0 ${selectedRoute.status==="in_progress"?"border-l-2 border-[#3156a3] bg-blue-50":"text-slate-500"}`}><p className="text-xs font-semibold uppercase tracking-wide">2 · Collect</p><p className="mt-1 font-semibold">Arrive and record each pickup</p></div><div className="border-t border-slate-200 px-4 py-3 text-slate-500 sm:border-l sm:border-t-0"><p className="text-xs font-semibold uppercase tracking-wide">3 · Finish</p><p className="mt-1 font-semibold">Complete every route stop</p></div></div>}
            <div className="mt-5 divide-y border-y border-slate-200">{selectedRoute.stops.map((stop,index)=>{
              const previousComplete = index === 0 || ["completed","skipped"].includes(selectedRoute.stops[index-1].status);
              return <article key={stop.id} className={`grid gap-4 py-5 md:grid-cols-[48px_1fr_220px] ${!previousComplete && stop.status === "pending" ? "opacity-50" : ""}`}>
                <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-black ${stop.status === "completed" ? "bg-emerald-700 text-white" : stop.status === "arrived" ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-700"}`}>{stop.status === "completed" ? "✓" : stop.stop_order}</div>
                <div><h4 className="font-black text-slate-950">{stop.zone_name || "Unknown collection point"}</h4><p className="mt-1 text-sm capitalize text-slate-500">{formatLabel(stop.waste_type)} waste{stop.estimated_weight_kg ? ` · est. ${stop.estimated_weight_kg} kg` : ""}</p>{stop.latitude && stop.longitude && <a href={`https://www.openstreetmap.org/directions?to=${stop.latitude},${stop.longitude}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-[#3156a3]">Open navigation ↗</a>}{stop.customer_stops?.length>0&&<div className="mt-4 border-t border-slate-200"><p className="py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Household pickups</p>{stop.customer_stops.map(customer=><div key={customer.id} className="flex items-start justify-between gap-3 border-t border-slate-100 py-3"><div><p className="text-sm font-semibold">{customer.customer_name}</p><p className="text-xs text-slate-500">{customer.address}</p>{customer.status==='skipped'&&<p className="mt-1 text-xs text-amber-800">Not collected: {formatLabel(customer.exception_reason||'issue reported')}</p>}{customer.status==='completed'&&<div className="mt-2 space-y-1 text-xs text-slate-600"><p>{customer.completed_at?new Date(customer.completed_at).toLocaleString("en-GB"):"Completion time recorded"}{customer.collected_weight_kg?" · "+Number(customer.collected_weight_kg).toLocaleString()+" kg":""}</p>{customer.completion_notes&&<p className="whitespace-pre-line">{customer.completion_notes}</p>}{customer.evidence_url&&<a href={customer.evidence_url} target="_blank" rel="noreferrer" className="inline-block font-semibold text-blue-700">View collection photo ↗</a>}</div>}</div><div className="flex flex-wrap items-center justify-end gap-2">{isDriverAccount&&selectedRoute.status==='in_progress'&&stop.status==='arrived'&&customer.status==='pending'&&<button disabled={saving} onClick={()=>updateCustomerStop(customer.id,'arrive')} className="border border-[#3156a3] px-2 py-1 text-xs font-semibold text-[#3156a3]">Arrived</button>}{isDriverAccount&&['pending','arrived'].includes(customer.status)&&<button disabled={saving} onClick={()=>setSkipTarget({id:customer.id,name:customer.customer_name})} className="border border-amber-500 px-2 py-1 text-xs font-semibold text-amber-800">Could not collect</button>}{isDriverAccount&&customer.status==='arrived'&&<button disabled={saving} onClick={()=>openCollectionProof(customer.id,customer.customer_name)} className="bg-[#3156a3] px-2 py-1 text-xs font-semibold text-white">Collected</button>}<StatusText value={customer.status}/></div></div>)}</div>}</div>
                <div>{isDriverAccount && selectedRoute.status === "in_progress" && stop.status === "pending" && previousComplete && <button disabled={saving} type="button" onClick={()=>arriveAtStop(stop.id)} className="w-full border border-blue-700 px-3 py-2 text-sm font-black text-blue-800">I have arrived</button>}{isDriverAccount && stop.status === "arrived" && <div className="space-y-2"><input type="number" min="0" step="any" value={stopDrafts[stop.id]?.weight || ""} onChange={(event)=>setStopDrafts((current)=>({...current,[stop.id]:{weight:event.target.value,notes:current[stop.id]?.notes||""}}))} placeholder="Collected kg" className="w-full border p-2 text-sm" /><input value={stopDrafts[stop.id]?.notes || ""} onChange={(event)=>setStopDrafts((current)=>({...current,[stop.id]:{weight:current[stop.id]?.weight||"",notes:event.target.value}}))} placeholder="Completion note" className="w-full border p-2 text-sm" /><button disabled={saving} type="button" onClick={()=>completeStop(stop.id)} className="w-full bg-emerald-700 px-3 py-2 text-sm font-black text-white">Complete stop</button></div>}{stop.status === "completed" && <p className="text-sm font-black text-emerald-700">Collection completed{stop.collected_weight_kg ? ` · ${stop.collected_weight_kg} kg` : ""}</p>}</div>
              </article>;
            })}</div>
          </div>}
        </section>

        {!isDriverAccount && <section className="mt-8 grid gap-6 lg:grid-cols-[320px_1fr]">
          {!isDriverAccount && <aside className="border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-black text-slate-950">Select driver</h2>

            <p className="mt-2 text-sm leading-6 text-slate-500">
              Choose a driver to view assigned and active jobs.
            </p>

            <select
              disabled={loadingDrivers}
              value={selectedDriverId}
              onChange={(event) => selectDriver(event.target.value)}
              className="mt-5 w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
            >
              <option value="">Select driver</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.full_name}
                </option>
              ))}
            </select>

            {selectedDriver && (
              <div className="mt-6 border-t border-slate-200 pt-5">
                <p className="text-sm font-black text-slate-950">
                  {selectedDriver.full_name}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedDriver.phone || "No phone number"}
                </p>
                <p className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  License: {selectedDriver.license_number || "not set"}
                </p>
              </div>
            )}
          </aside>}

          <main className="border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-black text-slate-950">
                Current jobs
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Assigned and in-progress collection jobs.
              </p>
            </div>

            {!isDriverAccount && !selectedDriverId ? (
              <p className="px-5 py-8 text-sm text-slate-500">
                Select a driver to view jobs.
              </p>
            ) : loadingJobs ? (
              <p className="px-5 py-8 text-sm text-slate-500">
                Loading driver jobs...
              </p>
            ) : jobs.length ? (
              <div className="divide-y divide-slate-200">
                {jobs.map((job) => (
                  <article key={job.id} className="p-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-3">
                          <p className="text-lg font-black text-slate-950">
                            {job.zone_name || "Unknown zone"}
                          </p>

                          <span
                            className={`border px-3 py-1 text-xs font-black ${statusClass(
                              job.status
                            )}`}
                          >
                            {formatLabel(job.status)}
                          </span>
                        </div>

                        <p className="mt-2 text-sm text-slate-500">
                          {formatJobDate(job.job_date)} ·{" "}
                          {formatLabel(job.waste_type)} waste
                        </p>

                        <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                          Truck: {job.plate_number || "Not assigned"}
                        </p>

                        {job.estimated_weight_kg && (
                          <p className="mt-2 text-sm text-slate-500">
                            Estimated weight: {job.estimated_weight_kg} kg
                          </p>
                        )}

                        {job.notes && (
                          <p className="mt-3 text-sm leading-6 text-slate-600">
                            {job.notes}
                          </p>
                        )}
                      </div>

                      <div className="w-full md:w-56">
                        {job.status === "assigned" && (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => startJob(job.id)}
                            className="w-full border border-emerald-700 px-4 py-3 text-sm font-black text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
                          >
                            Start job
                          </button>
                        )}

                        {job.status === "in_progress" && (
                          <div className="space-y-3">
                            <input
                              value={collectedWeights[job.id] || ""}
                              onChange={(event) =>
                                setCollectedWeights((current) => ({
                                  ...current,
                                  [job.id]: event.target.value,
                                }))
                              }
                              placeholder="Collected weight kg"
                              className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                            />

                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => completeJob(job.id)}
                              className="w-full bg-emerald-700 px-4 py-3 text-sm font-black text-white hover:bg-emerald-800 disabled:opacity-60"
                            >
                              Complete job
                            </button>

                            {isDriverAccount && (
                              <details className="border border-amber-200 bg-amber-50 p-3">
                                <summary className="cursor-pointer text-sm font-black text-amber-900">
                                  Report a problem
                                </summary>
                                <div className="mt-3 space-y-3">
                                  <select
                                    value={problemDrafts[job.id]?.category || "blocked_access"}
                                    onChange={(event) =>
                                      setProblemDrafts((current) => ({
                                        ...current,
                                        [job.id]: {
                                          category: event.target.value,
                                          description: current[job.id]?.description || "",
                                        },
                                      }))
                                    }
                                    className="w-full border border-amber-300 bg-white px-3 py-2 text-sm"
                                  >
                                    <option value="blocked_access">Blocked access</option>
                                    <option value="truck_problem">Truck problem</option>
                                    <option value="unsafe_site">Unsafe site</option>
                                    <option value="waste_mismatch">Waste mismatch</option>
                                    <option value="other">Other</option>
                                  </select>
                                  <textarea
                                    value={problemDrafts[job.id]?.description || ""}
                                    onChange={(event) =>
                                      setProblemDrafts((current) => ({
                                        ...current,
                                        [job.id]: {
                                          category: current[job.id]?.category || "blocked_access",
                                          description: event.target.value,
                                        },
                                      }))
                                    }
                                    placeholder="Describe what is blocking the collection"
                                    className="min-h-24 w-full border border-amber-300 bg-white px-3 py-2 text-sm"
                                  />
                                  <button
                                    type="button"
                                    disabled={saving || (problemDrafts[job.id]?.description.trim().length || 0) < 5}
                                    onClick={() => reportProblem(job.id)}
                                    className="w-full bg-amber-700 px-3 py-2 text-sm font-black text-white disabled:opacity-50"
                                  >
                                    Send to dispatch
                                  </button>
                                </div>
                              </details>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="px-5 py-8 text-sm text-slate-500">
                No assigned or in-progress jobs for this driver.
              </p>
            )}
          </main>
        </section>}

        <section className="mt-8 border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-black text-slate-950">Operational problems</h2>
            <p className="mt-1 text-sm text-slate-500">
              {isDriverAccount ? "Problems you have reported." : "Driver blockers requiring dispatch attention."}
            </p>
          </div>
          {problems.length ? (
            <div className="divide-y divide-slate-200">
              {problems.map((problem) => (
                <article key={problem.id} className="flex flex-col justify-between gap-4 p-5 md:flex-row">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="font-black text-slate-950">{formatLabel(problem.category)}</p>
                      <span className="border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-black uppercase text-amber-800">
                        {problem.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-700">{problem.description}</p>
                    <p className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                      {problem.zone_name || "Unknown zone"} · {problem.driver_name} · {problem.plate_number || "No truck"}
                    </p>
                  </div>
                  {!isDriverAccount && problem.status !== "resolved" && (
                    <div className="flex gap-2">
                      {problem.status === "open" && (
                        <button type="button" disabled={saving} onClick={() => updateProblem(problem.id, "acknowledged")} className="border border-slate-300 px-3 py-2 text-sm font-black">
                          Acknowledge
                        </button>
                      )}
                      <button type="button" disabled={saving} onClick={() => updateProblem(problem.id, "resolved")} className="bg-emerald-700 px-3 py-2 text-sm font-black text-white">
                        Resolve
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="p-5 text-sm text-slate-500">No operational problems reported.</p>
          )}
        </section>
        {tripSummary&&<div role="dialog" aria-modal="true" aria-labelledby="trip-summary-title" className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-6">
          <section className="w-full max-w-xl bg-white p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#3156a3]">Trip completed</p>
            <h2 id="trip-summary-title" className="mt-2 text-2xl font-semibold text-slate-950">{tripSummary.name}</h2>
            <p className="mt-2 text-sm text-slate-600">The vehicle and driver are available for their next assignment. This trip is ready for KCCA weighbridge verification.</p>
            <dl className="mt-6 divide-y border-y text-sm">{[["Date",formatJobDate(tripSummary.date)],["Truck",tripSummary.truck],["Driver",tripSummary.driver],["Customer outcomes",tripSummary.stops||"No household stops"],["Collected",tripSummary.collected],["Not collected",tripSummary.notCollected],["Driver-recorded weight",`${tripSummary.weight.toLocaleString()} kg`]].map(([label,value])=><div key={String(label)} className="flex justify-between gap-6 py-3"><dt className="text-slate-500">{label}</dt><dd className="text-right font-semibold">{value}</dd></div>)}</dl>
            <div className="mt-6 flex justify-end"><button type="button" onClick={()=>setTripSummary(null)} className="bg-[#3156a3] px-5 py-3 text-sm font-semibold text-white">Finish and return to today</button></div>
          </section>
        </div>}
        {proofTarget&&<div role="dialog" aria-modal="true" aria-labelledby="proof-title" className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-6">
          <form onSubmit={(event)=>{event.preventDefault();void updateCustomerStop(proofTarget.id,'complete',{collectedWeightKg:proofWeight?Number(proofWeight):undefined,notes:[proofNotes,proofLocation?`GPS: ${proofLocation}`:""].filter(Boolean).join("\n")||undefined,evidenceUrl:proofPhoto||undefined});}} className="max-h-[92vh] w-full max-w-lg overflow-y-auto bg-white p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#3156a3]">Proof of collection</p>
            <h2 id="proof-title" className="mt-2 text-xl font-semibold text-slate-950">Confirm collection for {proofTarget.name}</h2>
            <p className="mt-2 text-sm text-slate-600">Record only what was collected at this customer. The time and signed-in driver are saved automatically.</p>
            <label className="mt-5 block text-sm font-semibold">Collected weight (kg) <span className="font-normal text-slate-400">(optional)</span><input type="number" min="0" step="0.01" value={proofWeight} onChange={event=>setProofWeight(event.target.value)} className="mt-2 w-full border border-slate-300 px-3 py-3 font-normal"/></label>
            <label className="mt-4 block text-sm font-semibold">Collection photo <span className="font-normal text-slate-400">(optional, maximum 2 MB)</span><input type="file" accept="image/*" capture="environment" onChange={event=>readProofPhoto(event.target.files?.[0])} className="mt-2 w-full border border-slate-300 px-3 py-3 font-normal"/></label>
            {proofPhoto&&<img src={proofPhoto} alt="Collection proof preview" className="mt-3 max-h-44 w-full object-contain"/>}
            <div className="mt-4 border-l-2 border-[#3156a3] pl-3"><p className="text-xs font-semibold text-slate-500">Collection location</p><p className="mt-1 text-sm text-slate-700">{proofLocation||"Not captured"}</p></div>
            <label className="mt-4 block text-sm font-semibold">Driver note <span className="font-normal text-slate-400">(optional)</span><textarea value={proofNotes} onChange={event=>setProofNotes(event.target.value)} rows={3} maxLength={700} className="mt-2 w-full resize-none border border-slate-300 px-3 py-3 font-normal" placeholder="Container condition, waste type, or customer instruction"/></label>
            <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4"><button type="button" onClick={()=>setProofTarget(null)} className="border border-slate-300 px-4 py-2.5 text-sm font-semibold">Go back</button><button disabled={saving} className="bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving?'Saving…':'Confirm collected'}</button></div>
          </form>
        </div>}
        {skipTarget&&<div role="dialog" aria-modal="true" aria-labelledby="skip-title" className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-6">
          <form onSubmit={(event)=>{event.preventDefault();void updateCustomerStop(skipTarget.id,'skip',{exceptionReason:skipReason,exceptionNotes:skipNotes});}} className="w-full max-w-lg bg-white p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Collection exception</p>
            <h2 id="skip-title" className="mt-2 text-xl font-semibold text-slate-950">Why could you not collect?</h2>
            <p className="mt-2 text-sm text-slate-600">{skipTarget.name} will be sent to operations for review. Choose the clearest reason so they can take the right next action.</p>
            <label className="mt-5 block text-sm font-semibold text-slate-800">Reason<select value={skipReason} onChange={event=>setSkipReason(event.target.value)} className="mt-2 w-full border border-slate-300 px-3 py-3 text-sm"><option value="blocked_access">Access was blocked</option><option value="customer_unavailable">Customer was unavailable</option><option value="waste_not_ready">Waste was not ready</option><option value="unsafe_conditions">Conditions were unsafe</option><option value="vehicle_access">Vehicle could not reach location</option><option value="other">Other reason</option></select></label>
            <label className="mt-4 block text-sm font-semibold text-slate-800">Driver note {skipReason==='other'?'(required)':'(optional)'}<textarea required={skipReason==='other'} value={skipNotes} onChange={event=>setSkipNotes(event.target.value)} rows={3} placeholder="Add useful details for dispatch" className="mt-2 w-full resize-none border border-slate-300 px-3 py-3 text-sm"/></label>
            <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4"><button type="button" onClick={()=>{setSkipTarget(null);setSkipNotes('');}} className="border border-slate-300 px-4 py-2.5 text-sm font-semibold">Go back</button><button disabled={saving} className="bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving?'Saving…':'Send to operations'}</button></div>
          </form>
        </div>}
      </div>
    </AppShell>
  );
}
