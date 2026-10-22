"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { AppShell } from "@/components/layout/AppShell";
import { apiRequest, queueDesktopOperation } from "@/lib/api";
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

type ManagementTrip = {
  id:string; trip_number:string; route_date:string; status:string; route_name:string;
  zone_name:string; division_name:string; plate_number:string; driver_name:string;
  supervisor_name:string; customer_count:number; collected_count:number; not_collected_count:number;
};

type DriverRoute = {
  id: string; name: string; route_date: string; status: string;
  plate_number: string | null; driver_name?:string|null; total_distance_km: string | null;
  estimated_duration_minutes: number | null; stop_count: number; completed_stop_count: number;
  customer_count?: number; collected_customer_count?: number;
  /** Completed within the last 6 hours and not yet weighed: location keeps being shared for the drive to the facility. */
  disposal_leg_open?: boolean;
};
type RouteStop = {
  id: string; stop_order: number; status: string; zone_name: string | null;
  latitude: string | null; longitude: string | null; waste_type: string;
  estimated_weight_kg: string | null; collected_weight_kg: string | null;
  customer_stops: { id:string; status:string; stop_order:number; customer_name:string; address:string; completed_at:string|null; collected_weight_kg:string|null; evidence_url:string|null; completion_notes:string|null; exception_reason:string|null; exception_notes:string|null }[];
};
type RouteDetails = DriverRoute & { stops: RouteStop[] };
type DriverDashboard={driver:{id:string;full_name:string;status:string};summary:{total_trips:number;trips_today:number;in_progress:number;completed_trips:number;verified_weight_kg:string;total_households:number;collected_households:number;not_collected_households:number;open_problems:number};recent_trips:Array<{id:string;trip_number:string;route_name:string;route_date:string;status:string;plate_number:string|null;verified_weight_kg:string|null;customer_count:number;collected_count:number;not_collected_count:number}>};
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
  const [driverDashboard,setDriverDashboard]=useState<DriverDashboard|null>(null);
  const [managementTrips,setManagementTrips]=useState<ManagementTrip[]>([]);
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
  const tripDetailsRef=useRef<HTMLElement|null>(null);

  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [syncNotice,setSyncNotice]=useState("");

  async function queueIfOffline(failure:unknown,endpoint:string,body:unknown={},method:"POST"|"PATCH"="PATCH"){
    const unavailable=failure instanceof Error&&failure.message.includes("temporarily unavailable");
    const desktop=await window.kwmsDesktop?.getState();
    const user=JSON.parse(sessionStorage.getItem("currentUser")||"{}");
    if(!unavailable||!desktop||!user.id||!user.organizationId)throw failure;
    await queueDesktopOperation({endpoint,method,body,organizationId:user.organizationId,userId:user.id});
    setSyncNotice("Saved securely on this computer. Dispatch will receive this update after synchronization.");
  }

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

  async function loadDriverDashboard(){
    if(!isDriverAccount)return;
    const response=await apiRequest<ApiResponse<DriverDashboard>>("/api/waste/driver/dashboard");
    setDriverDashboard(response.data);
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
    try {
      const user=JSON.parse(sessionStorage.getItem("currentUser")||"{}");
      if(user.id&&user.organizationId)void window.kwmsDesktop?.setSnapshot({key:"driver-route",organizationId:user.organizationId,userId:user.id,data:response.data}).catch(()=>undefined);
    } catch {/* The live route remains usable when desktop caching is unavailable. */}
    if (!isDriverAccount) requestAnimationFrame(() => tripDetailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function startRoute(routeId: string) {
    try {
      setSaving(true); setError("");
      await apiRequest(`/api/waste/driver-routes/${routeId}/start`, { method: "PATCH" });
      await loadRoutes(selectedDriverId);
      await loadDriverDashboard();
    } catch (routeError) {
      try{await queueIfOffline(routeError,`/api/waste/driver-routes/${routeId}/start`);setSelectedRoute(current=>current&&current.id===routeId?{...current,status:"in_progress"}:current);}
      catch(failure){setError(failure instanceof Error ? failure.message : "Failed to start route");}
    }
    finally { setSaving(false); }
  }

  useEffect(()=>{
    if(!isDriverAccount||!(selectedRoute?.status==="in_progress"||selectedRoute?.disposal_leg_open)||!navigator.geolocation)return;
    const watch=navigator.geolocation.watchPosition(position=>{
      setLocationSharing("sharing");
      if(Date.now()-lastLocationSent.current<15000)return;
      lastLocationSent.current=Date.now();
      void apiRequest("/api/waste/fleet/live/location",{method:"POST",body:JSON.stringify({routeId:selectedRoute.id,latitude:position.coords.latitude,longitude:position.coords.longitude,accuracyM:position.coords.accuracy,speedKph:position.coords.speed===null?undefined:position.coords.speed*3.6,headingDegrees:position.coords.heading??undefined,recordedAt:new Date(position.timestamp).toISOString()})}).catch(()=>setLocationSharing("blocked"));
    },()=>setLocationSharing("blocked"),{enableHighAccuracy:true,maximumAge:10000,timeout:20000});
    return()=>navigator.geolocation.clearWatch(watch);
  },[isDriverAccount,selectedRoute?.id,selectedRoute?.status,selectedRoute?.disposal_leg_open]);

  async function arriveAtStop(stopId: string) {
    try {
      setSaving(true); setError("");
      await apiRequest(`/api/waste/driver-route-stops/${stopId}/arrive`, { method: "PATCH" });
      if (selectedRoute) await loadRouteDetails(selectedRoute.id);
    } catch (stopError) {
      try{await queueIfOffline(stopError,`/api/waste/driver-route-stops/${stopId}/arrive`);setSelectedRoute(current=>current?{...current,stops:current.stops.map(stop=>stop.id===stopId?{...stop,status:"arrived"}:stop)}:current);}
      catch(failure){setError(failure instanceof Error ? failure.message : "Failed to record arrival");}
    }
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
      await loadDriverDashboard();
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
      await loadDriverDashboard();
    } catch (stopError) {
      try{
        const body={action,...details};
        await queueIfOffline(stopError,`/api/waste/customer-collection-stops/${stopId}`,body);
        setSelectedRoute(current=>current?{...current,stops:current.stops.map(stop=>({...stop,customer_stops:stop.customer_stops.map(customer=>customer.id===stopId?{...customer,status:action==='complete'?'completed':action==='skip'?'skipped':'arrived',completed_at:action==='complete'?new Date().toISOString():customer.completed_at,collected_weight_kg:action==='complete'&&details.collectedWeightKg!==undefined?String(details.collectedWeightKg):customer.collected_weight_kg,completion_notes:action==='complete'?String(details.notes||'')||null:customer.completion_notes,exception_reason:action==='skip'?String(details.exceptionReason||'other'):customer.exception_reason,exception_notes:action==='skip'?String(details.exceptionNotes||'')||null:customer.exception_notes}:customer)}))}:current);
        if(action==='skip'){setSkipTarget(null);setSkipReason('blocked_access');setSkipNotes('');}
        if(action==='complete'){setProofTarget(null);setProofWeight('');setProofNotes('');setProofPhoto('');setProofLocation('');}
      }catch(failure){setError(failure instanceof Error ? failure.message : "Failed to update household stop");}
    }
    finally { setSaving(false); }
  }

  function openCollectionProof(id:string,name:string){
    setError("");setProofTarget({id,name});setProofWeight("");setProofNotes("");setProofPhoto("");setProofLocation("Locating…");
    if(!navigator.geolocation){setProofLocation("GPS unavailable on this device");return;}
    navigator.geolocation.getCurrentPosition(position=>setProofLocation(`${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)} · ±${Math.round(position.coords.accuracy)} m`),()=>setProofLocation("GPS permission not available"),{enableHighAccuracy:true,timeout:12000,maximumAge:30000});
  }

  function readProofPhoto(file:File|undefined){
    if(!file)return;
    setError("");
    if(!["image/jpeg","image/png","image/webp"].includes(file.type)){setError("Collection proof must be a JPG, PNG or WebP image.");setProofPhoto("");return;}
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
      try{
        await queueIfOffline(reportError,`/api/waste/driver-jobs/${jobId}/problems`,draft,"POST");
        const job=jobs.find(item=>item.id===jobId);
        setProblems(current=>[{id:`offline-${Date.now()}`,job_id:jobId,category:draft.category,description:draft.description,status:"pending_sync",zone_name:job?.zone_name||null,driver_name:job?.driver_name||"Signed-in driver",plate_number:job?.plate_number||null},...current]);
        setProblemDrafts(current=>({...current,[jobId]:{category:"blocked_access",description:""}}));
      }catch(failure){setError(failure instanceof Error ? failure.message : "Failed to report problem");}
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
      apiRequest<ApiResponse<DriverDashboard>>("/api/waste/driver/dashboard")
        .then(response=>setDriverDashboard(response.data))
        .catch((dashboardError:unknown)=>setError(dashboardError instanceof Error?dashboardError.message:"Failed to load driver dashboard"));
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

    if (!["driver","unknown","hydrating"].includes(storedRole)) {
      Promise.all([apiRequest<ApiListResponse<Driver>>("/api/waste/drivers"),apiRequest<ApiListResponse<ManagementTrip>>("/api/waste/trips")])
        .then(([driverResponse,tripResponse]) => {setDrivers(driverResponse.data);setManagementTrips(tripResponse.data);})
        .catch((error: unknown) =>
          setError(
            error instanceof Error ? error.message : "Failed to load drivers"
          )
        )
        .finally(() => setLoadingDrivers(false));
    }
  }, [storedRole]);

  function selectDriver(driverId: string) {
    setSelectedDriverId(driverId);
    void loadDriverJobs(driverId, false);
    void loadRoutes(driverId, false);
  }

  const routeCustomers=selectedRoute?.stops.flatMap(stop=>stop.customer_stops||[])||[];
  const resolvedCustomers=routeCustomers.filter(customer=>["completed","skipped","cancelled"].includes(customer.status)).length;
  const collectedCustomers=routeCustomers.filter(customer=>customer.status==="completed").length;
  const nextStop=selectedRoute?.stops.find(stop=>!["completed","skipped"].includes(stop.status));
  const routeProgress=routeCustomers.length?Math.round(resolvedCustomers/routeCustomers.length*100):0;

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
        {syncNotice&&<div className="mt-6 flex items-start justify-between gap-4 border-l-4 border-amber-500 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-900"><span>{syncNotice}</span><button type="button" onClick={()=>setSyncNotice("")} className="shrink-0">Dismiss</button></div>}

        {isDriverAccount&&driverDashboard&&<DriverOverview data={driverDashboard}/>}

        {!isDriverAccount&&<ManagementTrips trips={managementTrips} drivers={drivers} onOpen={loadRouteDetails}/>}

        {(isDriverAccount||selectedRoute)&&<section ref={tripDetailsRef} className="mt-8 scroll-mt-24 border-y border-slate-300 bg-white">
          <div className="flex flex-col justify-between gap-4 border-b border-slate-200 p-5 md:flex-row md:items-center">
            <div><h2 className="text-xl font-semibold text-slate-950">{isDriverAccount?"Assigned route":"Trip details"}</h2><p className="mt-1 text-sm text-slate-500">{isDriverAccount?"Follow stops in order so dispatch receives reliable progress.":"Review the route sequence and every customer outcome without leaving this page."}</p></div>
            {routes.length > 1 && <select value={selectedRoute?.id || ""} onChange={(event)=>loadRouteDetails(event.target.value)} className="border border-slate-300 px-3 py-2 text-sm">{routes.map((route)=><option key={route.id} value={route.id}>{route.name}</option>)}</select>}
          </div>
          {!selectedRoute ? <div className="px-5 py-12 text-center"><p className="font-semibold text-slate-900">No route assigned today</p><p className="mt-2 text-sm text-slate-500">Your next dispatched route will appear here automatically.</p></div> : <div className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div><div className="flex flex-wrap items-center gap-3"><h3 className="text-2xl font-semibold">{selectedRoute.name}</h3><StatusText value={selectedRoute.status}/></div><p className="mt-2 text-sm text-slate-500">{formatJobDate(selectedRoute.route_date)} · Truck {selectedRoute.plate_number || "not assigned"}{selectedRoute.total_distance_km ? ` · ${selectedRoute.total_distance_km} km` : ""}{selectedRoute.estimated_duration_minutes ? ` · ${selectedRoute.estimated_duration_minutes} min` : ""}</p>{isDriverAccount&&selectedRoute.status==="in_progress"&&<p className={`mt-2 text-xs font-semibold ${locationSharing==="sharing"?"text-[var(--color-action)]":locationSharing==="blocked"?"text-red-700":"text-slate-500"}`}>{locationSharing==="sharing"?"Live location is being shared with dispatch":locationSharing==="blocked"?"Location is not sharing. Allow location access so dispatch can support you.":"Connecting live location…"}</p>}</div>
            </div>
            <div className="mt-5 grid border-y border-slate-200 text-sm sm:grid-cols-3"><div className="py-3 sm:border-r sm:pr-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customers</p><p className="mt-1 text-xl font-semibold">{routeCustomers.length}</p></div><div className="border-t py-3 sm:border-r sm:border-t-0 sm:px-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Collected</p><p className="mt-1 text-xl font-semibold">{collectedCustomers}</p></div><div className="border-t py-3 sm:border-t-0 sm:pl-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Remaining</p><p className="mt-1 text-xl font-semibold">{Math.max(routeCustomers.length-resolvedCustomers,0)}</p></div></div>
            <div className="mt-5 h-1 overflow-hidden bg-slate-200"><div className="h-full bg-[var(--color-action)]" style={{width:`${routeProgress}%`}} /></div>
            <div className="mt-2 flex justify-between text-xs font-semibold text-slate-500"><span>{resolvedCustomers} of {routeCustomers.length} customer outcomes recorded</span><span>{routeProgress}%</span></div>
            {isDriverAccount&&selectedRoute.disposal_leg_open&&<p className="mt-4 border-l-2 border-[var(--color-action)] bg-blue-50 px-4 py-3 text-sm text-slate-700">Trip complete. Keep this page open with location on until the truck is weighed at the disposal facility; KCCA checks the route to the weighbridge.</p>}
            {isDriverAccount&&<div className="mt-5 border-l-2 border-[var(--color-action)] bg-blue-50 px-4 py-4"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-action)]">Next action</p>{["planned","dispatched"].includes(selectedRoute.status)?<div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="font-semibold">Start the route when the vehicle and team are ready.</p><button disabled={saving} type="button" onClick={()=>startRoute(selectedRoute.id)} className="min-h-12 bg-[var(--color-action)] px-5 py-3 font-semibold text-white disabled:opacity-50">{saving?"Starting…":"Start route"}</button></div>:selectedRoute.status==="in_progress"&&nextStop?<div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">{nextStop.status==="arrived"?"Record every customer outcome at this stop.":`Travel to stop ${nextStop.stop_order}: ${nextStop.zone_name||"collection point"}.`}</p><p className="mt-1 text-xs text-slate-600">Follow the route in order so dispatch receives accurate progress.</p></div><a href="#current-stop" className="min-h-12 border border-[var(--color-action)] px-5 py-3 text-center font-semibold text-[var(--color-action)]">Open current stop ↓</a></div>:<p className="mt-2 font-semibold">All route work has been recorded.</p>}</div>}
            <div className="mt-5 divide-y border-y border-slate-200">{selectedRoute.stops.map((stop,index)=>{
              const previousComplete = index === 0 || ["completed","skipped"].includes(selectedRoute.stops[index-1].status);
              const unresolvedCustomers = (stop.customer_stops||[]).filter((customer)=>!["completed","skipped","cancelled"].includes(customer.status)).length;
              return <article id={nextStop?.id===stop.id?"current-stop":undefined} key={stop.id} className={`scroll-mt-24 grid gap-4 py-5 md:grid-cols-[48px_1fr_240px] ${!previousComplete && stop.status === "pending" ? "opacity-50" : ""}`}>
                <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-black ${stop.status === "completed" ? "bg-[var(--color-action)] text-white" : stop.status === "arrived" ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-700"}`}>{stop.status === "completed" ? "✓" : stop.stop_order}</div>
                <div><h4 className="font-black text-slate-950">{stop.zone_name || "Unknown collection point"}</h4><p className="mt-1 text-sm capitalize text-slate-500">{formatLabel(stop.waste_type)} waste{stop.estimated_weight_kg ? ` · est. ${stop.estimated_weight_kg} kg` : ""}</p>{stop.latitude && stop.longitude && <a href={`https://www.openstreetmap.org/directions?to=${stop.latitude},${stop.longitude}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-[var(--color-action)]">Open navigation ↗</a>}{stop.customer_stops?.length>0&&<div className="mt-4 border-t border-slate-200"><p className="py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Customer pickups</p>{stop.customer_stops.map(customer=><div key={customer.id} className="flex items-start justify-between gap-3 border-t border-slate-100 py-3"><div><p className="text-sm font-semibold">{customer.customer_name}</p><p className="text-xs text-slate-500">{customer.address}</p>{customer.status==='skipped'&&<p className="mt-1 text-xs text-amber-800">Not collected: {formatLabel(customer.exception_reason||'issue reported')}</p>}{customer.status==='completed'&&<div className="mt-2 space-y-1 text-xs text-slate-600"><p>✓ Collected{customer.completed_at?` · ${new Date(customer.completed_at).toLocaleString("en-GB")}`:""}{customer.collected_weight_kg?" · "+Number(customer.collected_weight_kg).toLocaleString()+" kg":""}</p>{customer.completion_notes&&<p className="whitespace-pre-line">{customer.completion_notes}</p>}{customer.evidence_url&&<a href={customer.evidence_url} target="_blank" rel="noreferrer" className="inline-block font-semibold text-blue-700">View collection photo ↗</a>}</div>}</div><div className="flex flex-wrap items-center justify-end gap-2">{isDriverAccount&&selectedRoute.status==='in_progress'&&stop.status==='arrived'&&['pending','arrived'].includes(customer.status)&&<><button disabled={saving} onClick={()=>openCollectionProof(customer.id,customer.customer_name)} className="bg-[var(--color-action)] px-2 py-1 text-xs font-semibold text-white">Mark collected</button><button disabled={saving} onClick={()=>setSkipTarget({id:customer.id,name:customer.customer_name})} className="border border-amber-500 px-2 py-1 text-xs font-semibold text-amber-800">Could not collect</button></>}<StatusText value={customer.status}/></div></div>)}</div>}</div>
                <div>{isDriverAccount && selectedRoute.status === "in_progress" && stop.status === "pending" && previousComplete && <button disabled={saving} type="button" onClick={()=>arriveAtStop(stop.id)} className="min-h-12 w-full border border-[var(--color-action)] px-3 py-3 text-sm font-semibold text-[var(--color-action)] disabled:opacity-50">{saving?"Recording arrival…":"I have arrived"}</button>}{isDriverAccount && stop.status === "arrived" && <div className="space-y-3">{unresolvedCustomers>0?<p className="border-l-2 border-amber-500 bg-amber-50 px-3 py-3 text-xs font-semibold text-amber-900">Record collected or not collected for {unresolvedCustomers} remaining customer {unresolvedCustomers===1?"pickup":"pickups"}.</p>:<><label className="block text-xs font-semibold text-slate-600">Total stop weight (kg)<input type="number" min="0" step="any" value={stopDrafts[stop.id]?.weight || ""} onChange={(event)=>setStopDrafts((current)=>({...current,[stop.id]:{weight:event.target.value,notes:current[stop.id]?.notes||""}}))} placeholder="Optional" className="mt-1 min-h-11 w-full border p-2 text-sm font-normal" /></label><label className="block text-xs font-semibold text-slate-600">Stop note<input value={stopDrafts[stop.id]?.notes || ""} onChange={(event)=>setStopDrafts((current)=>({...current,[stop.id]:{weight:current[stop.id]?.weight||"",notes:event.target.value}}))} placeholder="Optional" className="mt-1 min-h-11 w-full border p-2 text-sm font-normal" /></label><button disabled={saving} type="button" onClick={()=>completeStop(stop.id)} className="min-h-12 w-full bg-[var(--color-action)] px-3 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving?"Completing stop…":"Complete stop"}</button></>}</div>}{stop.status === "completed" && <p className="text-sm font-semibold text-[var(--color-action)]">Collection completed{stop.collected_weight_kg ? ` · ${stop.collected_weight_kg} kg` : ""}</p>}</div>
              </article>;
            })}</div>
          </div>}
        </section>}

        {isDriverAccount&&driverDashboard&&<DriverHistory trips={driverDashboard.recent_trips}/>}

        {false && !isDriverAccount && <section className="mt-8 grid gap-6 lg:grid-cols-[320px_1fr]">
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
                  {selectedDriver?.full_name}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedDriver?.phone || "No phone number"}
                </p>
                <p className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  License: {selectedDriver?.license_number || "not set"}
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

        <section className="mt-9 border-y border-slate-300 bg-white">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b px-1 py-4">
            <div><h2 className="text-xl font-semibold text-slate-950">{isDriverAccount?"My reported problems":"Exceptions from today’s work"}</h2><p className="mt-1 text-sm text-slate-500">{isDriverAccount?"Dispatch can see these reports and will update their status.":"Review each exception once in Service issues to avoid conflicting actions."}</p></div>
            {!isDriverAccount&&problems.some(problem=>problem.status!=="resolved")&&<a href="/dashboard/citizen-issues" className="text-sm font-semibold text-[var(--color-action)]">Open service issues →</a>}
          </div>
          {problems.length?<div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr><th>Problem</th><th>Location</th><th>Driver / vehicle</th><th>Status</th>{!isDriverAccount&&<th>Action</th>}</tr></thead><tbody>{problems.map(problem=><tr key={problem.id}><td><p className="table-primary">{formatLabel(problem.category)}</p><p className="table-secondary">{problem.description}</p></td><td>{problem.zone_name||"Unknown zone"}</td><td>{problem.driver_name} · {problem.plate_number||"No vehicle"}</td><td><StatusText value={problem.status}/></td>{!isDriverAccount&&<td><a href="/dashboard/citizen-issues" className="font-semibold text-[var(--color-action)]">Review →</a></td>}</tr>)}</tbody></table></div>:<p className="px-1 py-7 text-sm text-slate-500">No operational problems reported.</p>}
        </section>
        {tripSummary&&<div role="dialog" aria-modal="true" aria-labelledby="trip-summary-title" className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-6">
          <section className="w-full max-w-xl bg-white p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-action)]">Trip completed</p>
            <h2 id="trip-summary-title" className="mt-2 text-2xl font-semibold text-slate-950">{tripSummary.name}</h2>
            <p className="mt-2 text-sm text-slate-600">The vehicle and driver are available for their next assignment. This trip is ready for KCCA weighbridge verification.</p>
            <dl className="mt-6 divide-y border-y text-sm">{[["Date",formatJobDate(tripSummary.date)],["Truck",tripSummary.truck],["Driver",tripSummary.driver],["Customer outcomes",tripSummary.stops||"No household stops"],["Collected",tripSummary.collected],["Not collected",tripSummary.notCollected],["Driver-recorded weight",`${tripSummary.weight.toLocaleString()} kg`]].map(([label,value])=><div key={String(label)} className="flex justify-between gap-6 py-3"><dt className="text-slate-500">{label}</dt><dd className="text-right font-semibold">{value}</dd></div>)}</dl>
            <div className="mt-6 flex justify-end"><button type="button" onClick={()=>setTripSummary(null)} className="bg-[var(--color-action)] px-5 py-3 text-sm font-semibold text-white">Finish and return to today</button></div>
          </section>
        </div>}
        {proofTarget&&<div role="dialog" aria-modal="true" aria-labelledby="proof-title" className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-6">
          <form onSubmit={(event)=>{event.preventDefault();void updateCustomerStop(proofTarget.id,'complete',{collectedWeightKg:proofWeight?Number(proofWeight):undefined,notes:[proofNotes,proofLocation?`GPS: ${proofLocation}`:""].filter(Boolean).join("\n")||undefined,evidenceUrl:proofPhoto||undefined});}} className="max-h-[92vh] w-full max-w-lg overflow-y-auto bg-white p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-action)]">Proof of collection</p>
            <h2 id="proof-title" className="mt-2 text-xl font-semibold text-slate-950">Confirm collection for {proofTarget.name}</h2>
            <p className="mt-2 text-sm text-slate-600">Record only what was collected at this customer. The time and signed-in driver are saved automatically.</p>
            {error&&<p role="alert" className="mt-4 border-l-2 border-red-600 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{error}</p>}
            <label className="mt-5 block text-sm font-semibold">Collected weight (kg) <span className="font-normal text-slate-400">(optional)</span><input type="number" min="0" step="0.01" value={proofWeight} onChange={event=>setProofWeight(event.target.value)} className="mt-2 w-full border border-slate-300 px-3 py-3 font-normal"/></label>
            <label className="mt-4 block text-sm font-semibold">Collection photo <span className="font-normal text-slate-400">(optional, maximum 2 MB)</span><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event=>readProofPhoto(event.target.files?.[0])} className="mt-2 w-full border border-slate-300 px-3 py-3 font-normal"/></label>
            {proofPhoto&&<Image src={proofPhoto} alt="Collection proof preview" width={800} height={440} unoptimized className="mt-3 max-h-44 w-full object-contain"/>}
            <div className="mt-4 border-l-2 border-[var(--color-action)] pl-3"><p className="text-xs font-semibold text-slate-500">Collection location</p><p className="mt-1 text-sm text-slate-700">{proofLocation||"Not captured"}</p></div>
            <label className="mt-4 block text-sm font-semibold">Driver note <span className="font-normal text-slate-400">(optional)</span><textarea value={proofNotes} onChange={event=>setProofNotes(event.target.value)} rows={3} maxLength={700} className="mt-2 w-full resize-none border border-slate-300 px-3 py-3 font-normal" placeholder="Container condition, waste type, or customer instruction"/></label>
            <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4"><button type="button" disabled={saving} onClick={()=>{setProofTarget(null);setError("");}} className="border border-slate-300 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Go back</button><button disabled={saving} className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving?'Saving collection…':'Confirm collected'}</button></div>
          </form>
        </div>}
        {skipTarget&&<div role="dialog" aria-modal="true" aria-labelledby="skip-title" className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-6">
          <form onSubmit={(event)=>{event.preventDefault();void updateCustomerStop(skipTarget.id,'skip',{exceptionReason:skipReason,exceptionNotes:skipNotes});}} className="w-full max-w-lg bg-white p-6 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Collection exception</p>
            <h2 id="skip-title" className="mt-2 text-xl font-semibold text-slate-950">Why could you not collect?</h2>
            <p className="mt-2 text-sm text-slate-600">{skipTarget.name} will be sent to operations for review. Choose the clearest reason so they can take the right next action.</p>
            <label className="mt-5 block text-sm font-semibold text-slate-800">Reason<select value={skipReason} onChange={event=>setSkipReason(event.target.value)} className="mt-2 w-full border border-slate-300 px-3 py-3 text-sm"><option value="blocked_access">Access was blocked</option><option value="customer_unavailable">Customer was unavailable</option><option value="waste_not_ready">Waste was not ready</option><option value="unsafe_conditions">Conditions were unsafe</option><option value="vehicle_access">Vehicle could not reach location</option><option value="other">Other reason</option></select></label>
            <label className="mt-4 block text-sm font-semibold text-slate-800">Driver note {skipReason==='other'?'(required)':'(optional)'}<textarea required={skipReason==='other'} value={skipNotes} onChange={event=>setSkipNotes(event.target.value)} rows={3} placeholder="Add useful details for dispatch" className="mt-2 w-full resize-none border border-slate-300 px-3 py-3 text-sm"/></label>
            <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4"><button type="button" onClick={()=>{setSkipTarget(null);setSkipNotes('');}} className="border border-slate-300 px-4 py-2.5 text-sm font-semibold">Go back</button><button disabled={saving} className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving?'Saving…':'Send to operations'}</button></div>
          </form>
        </div>}
      </div>
    </AppShell>
  );
}

function DriverOverview({data}:{data:DriverDashboard}){
  const summary=data.summary;
  const collectionRate=summary.total_households?Math.round(summary.collected_households/summary.total_households*100):0;
  const values:Array<[string,string|number,string]>=[
    ["Trips today",summary.trips_today,"Today’s assignments"],
    ["In progress",summary.in_progress,"Currently active"],
    ["Trips completed",summary.completed_trips,`${summary.total_trips} assigned overall`],
    ["Households collected",summary.collected_households,`${collectionRate}% collection rate`],
    ["Not collected",summary.not_collected_households,"Recorded exceptions"],
    ["Verified tonnage",`${(Number(summary.verified_weight_kg||0)/1000).toLocaleString(undefined,{maximumFractionDigits:2})} t`,"KCCA weighbridge"],
  ];
  return <section className="mt-7 border-y border-slate-300"><div className="flex flex-wrap items-end justify-between gap-3 border-b py-4"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-[var(--color-action)]">My performance</p><h2 className="mt-1 text-xl font-semibold">Driver dashboard</h2></div>{summary.open_problems>0&&<span className="border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">{summary.open_problems} open {summary.open_problems===1?"problem":"problems"}</span>}</div><div className="grid sm:grid-cols-2 lg:grid-cols-3">{values.map(([label,value,help])=><div key={label} className="border-b py-4 sm:border-r sm:px-4 sm:first:pl-0 lg:[&:nth-child(3n)]:border-r-0"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-slate-500">{help}</p></div>)}</div></section>;
}

function DriverHistory({trips}:{trips:DriverDashboard["recent_trips"]}){
  return <section className="mt-9 border-y border-slate-300"><div className="border-b py-4"><h2 className="text-xl font-semibold">Recent trips</h2><p className="mt-1 text-sm text-slate-500">Your latest assignments, household outcomes and verified KCCA weight.</p></div>{trips.length?<div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left"><thead><tr><th>Date / trip</th><th>Route / vehicle</th><th>Households</th><th>Outcome</th><th>Verified weight</th><th>Status</th></tr></thead><tbody>{trips.map(trip=><tr key={trip.id}><td><p className="table-primary">{formatJobDate(trip.route_date)}</p><p className="table-secondary">{trip.trip_number}</p></td><td><p>{trip.route_name}</p><p className="table-secondary">{trip.plate_number||"No vehicle recorded"}</p></td><td>{trip.customer_count}</td><td><p className="font-semibold">{trip.collected_count} collected</p><p className="table-secondary">{trip.not_collected_count} not collected</p></td><td>{trip.verified_weight_kg?`${Number(trip.verified_weight_kg).toLocaleString()} kg`:trip.status==="completed"?"Awaiting KCCA":"—"}</td><td><StatusText value={trip.status}/></td></tr>)}</tbody></table></div>:<p className="py-8 text-sm text-slate-500">No trip history yet. Completed and assigned trips will appear here.</p>}</section>;
}

function ManagementTrips({trips,drivers,onOpen}:{trips:ManagementTrip[];drivers:Driver[];onOpen:(id:string)=>Promise<void>}) {
  const [query,setQuery]=useState("");
  const [status,setStatus]=useState("all");
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Kampala",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const todayTrips=trips.filter(trip=>trip.route_date.slice(0,10)===today);
  const filtered=todayTrips.filter(trip=>(status==="all"||trip.status===status)&&`${trip.trip_number} ${trip.route_name} ${trip.driver_name} ${trip.plate_number} ${trip.zone_name}`.toLowerCase().includes(query.toLowerCase()));
  const values=[
    ["Trips today",todayTrips.length],
    ["In progress",todayTrips.filter(trip=>trip.status==="in_progress").length],
    ["Completed",todayTrips.filter(trip=>trip.status==="completed").length],
    ["Not started",todayTrips.filter(trip=>["planned","dispatched"].includes(trip.status)).length],
    ["Available drivers",drivers.filter(driver=>driver.status==="available").length],
    ["Not collected",todayTrips.reduce((sum,trip)=>sum+trip.not_collected_count,0)],
  ];
  return <>
    <section className="mt-7 grid border-y border-slate-300 sm:grid-cols-3 lg:grid-cols-6">
      {values.map(([label,value])=><div key={String(label)} className="border-b border-slate-200 py-4 pr-4 sm:border-r lg:border-b-0"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>)}
    </section>
    <section className="mt-9 border-y border-slate-300">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b py-4"><div><h2 className="text-xl font-semibold">Today’s driver assignments</h2><p className="mt-1 text-sm text-slate-500">One row per trip, with the team and customer progress together.</p></div><a href="/dashboard/waste" className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white">+ Create trip</a></div>
      <div className="table-toolbar"><input value={query} onChange={event=>setQuery(event.target.value)} className="table-search" placeholder="Search trip, route, driver or vehicle"/><select value={status} onChange={event=>setStatus(event.target.value)} className="border px-3 py-2 text-sm"><option value="all">All statuses</option><option value="dispatched">Not started</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select><span className="table-count">{filtered.length} results</span></div>
      {filtered.length?<div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-left"><thead><tr><th>Trip / route</th><th>Driver</th><th>Vehicle</th><th>Supervisor</th><th>Customers</th><th>Progress</th><th>Status</th><th>Action</th></tr></thead><tbody>{filtered.map(trip=>{const resolved=trip.collected_count+trip.not_collected_count;return <tr key={trip.id}><td><p className="table-primary">{trip.route_name}</p><p className="table-secondary">{trip.division_name} · {trip.zone_name} · {trip.trip_number}</p></td><td>{trip.driver_name||"Not assigned"}</td><td>{trip.plate_number||"Not assigned"}</td><td>{trip.supervisor_name||"Not assigned"}</td><td>{trip.customer_count}</td><td><p className="font-semibold">{resolved} / {trip.customer_count}</p><p className="table-secondary">{trip.collected_count} collected · {trip.not_collected_count} not collected</p></td><td><StatusText value={trip.status}/></td><td><button onClick={()=>void onOpen(trip.id)} className="font-semibold text-[var(--color-action)]">View details ↓</button></td></tr>})}</tbody></table></div>:<div className="py-10 text-center"><p className="font-semibold">No trips match this view</p><p className="mt-1 text-sm text-slate-500">Create a trip from Today’s Operations or change the filters.</p></div>}
    </section>
  </>;
}
