"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiRequest } from "@/lib/api";
import { Feedback, PageHeader } from "@/components/ui/System";
import { Pagination, usePagination } from "@/components/ui/Pagination";

type Zone = {
  id: string;
  organization_id: string | null;
  organization_name: string | null;
  name: string;
  description: string | null;
  area_type: string;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  customer_count: number;
};

type Organization = { id: string; name: string; type: string; is_active: boolean };

type Truck = {
  id: string;
  plate_number: string;
  truck_name: string | null;
  capacity_tons: string | null;
  status: string;
};

type Driver = {
  id: string;
  full_name: string;
  phone: string | null;
  license_number: string | null;
  status: string;
};

type PickupSchedule = {
  id: string;
  zone_id: string;
  zone_name: string | null;
  name: string;
  frequency: string;
  preferred_time: string | null;
  is_active: boolean;
};

type CollectionJob = {
  id: string;
  zone_id: string;
  zone_name: string | null;
  truck_id: string | null;
  plate_number: string | null;
  truck_name: string | null;
  driver_id: string | null;
  driver_name: string | null;
  schedule_id: string | null;
  schedule_name: string | null;
  job_date: string;
  status: string;
  waste_type: string;
  estimated_weight_kg: string | null;
  collected_weight_kg: string | null;
  notes: string | null;
  is_routed: boolean;
  customer_stop_count: number;
  resolved_customer_stop_count: number;
};
type CustomerStop = {
  id:string; collection_job_id:string; scheduled_date:string; status:string;
  customer_name:string; address:string; zone_id:string; zone_name:string|null;
  exception_reason:string|null; exception_notes:string|null; exception_review_status:string|null;
};

type ApiListResponse<T> = {
  success: boolean;
  message: string;
  data: T[];
};
type CollectionRoute = {
  id: string;
  name: string;
  truck_id: string | null;
  plate_number: string | null;
  truck_name: string | null;
  driver_id: string | null;
  driver_name: string | null;
  route_date: string;
  status: string;
  total_distance_km: string | null;
  estimated_duration_minutes: number | null;
  notes: string | null;
  job_count: number;
};
type RouteDetails = CollectionRoute & {
  started_at: string | null; completed_at: string | null; cancelled_at: string | null;
  cancellation_reason: string | null; cancellation_notes: string | null;
  history: { id:string; previous_status:string; new_status:string; reason:string|null; notes:string|null; created_at:string; changed_by_name:string|null }[];
  stops: { id:string; stop_order:number; status:string; zone_name:string|null; collected_weight_kg:string|null; completion_notes:string|null; evidence_url:string|null; customer_stops:{id:string;customer_name:string;address:string;status:string;collected_weight_kg:string|null}[] }[];
};

type ActiveTab =
  | "dispatch"
  | "exceptions"
  | "zones"
  | "trucks"
  | "drivers"
  | "schedules"
  | "jobs"
  | "routes";
type JobFilter =
  | "all"
  | "pending"
  | "assigned"
  | "in_progress"
  | "completed"
  | "cancelled";
function formatJobDate(value: string) {
  if (!value) return "No date";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
function statusClass(status: string) {
  if (status === "completed" || status === "active")
    return "bg-emerald-50 text-emerald-700 border-emerald-200";

  if (status === "in_progress")
    return "bg-blue-50 text-blue-700 border-blue-200";

  if (status === "assigned" || status === "dispatched")
    return "bg-indigo-50 text-indigo-700 border-indigo-200";

  if (status === "planned")
    return "bg-amber-50 text-amber-700 border-amber-200";

  if (status === "cancelled") return "bg-red-50 text-red-700 border-red-200";

  if (status === "missed")
    return "bg-orange-50 text-orange-700 border-orange-200";

  return "bg-slate-50 text-slate-700 border-slate-200";
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function roleSnapshot() {
  try { return JSON.parse(sessionStorage.getItem("currentUser") || "{}").roles?.join(",") || "unknown"; }
  catch { return "unknown"; }
}
function subscribeToRoles() { return () => undefined; }

export default function WasteOperationsPage() {
  const roles = useSyncExternalStore(subscribeToRoles, roleSnapshot, () => "hydrating");
  const canAssignServiceAreas = roles.includes("kcca_admin") || roles.includes("system_admin");
  const canManageRoutes = roles.includes("company_admin") || roles.includes("supervisor");
  const [zones, setZones] = useState<Zone[]>([]);
  const [companies, setCompanies] = useState<Organization[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [schedules, setSchedules] = useState<PickupSchedule[]>([]);
  const [jobs, setJobs] = useState<CollectionJob[]>([]);
  const [customerStops,setCustomerStops]=useState<CustomerStop[]>([]);
  const [exceptionDrafts,setExceptionDrafts]=useState<Record<string,{targetJobId:string;reviewNotes:string}>>({});

  const [activeTab, setActiveTab] = useState<ActiveTab>("dispatch");
  const [jobFilter, setJobFilter] = useState<JobFilter>("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [assigningJobId, setAssigningJobId] = useState<string | null>(null);
  const [routes, setRoutes] = useState<CollectionRoute[]>([]);
  const [selectedServiceZoneId, setSelectedServiceZoneId] = useState("");
  const [serviceAreaForm, setServiceAreaForm] = useState({ organizationId: "", latitude: "", longitude: "" });
  const [message, setMessage] = useState("");
  const [routeToCancel, setRouteToCancel] = useState<CollectionRoute | null>(null);
  const [routeCancellation, setRouteCancellation] = useState({ reason: "operational_delay", notes: "" });
  const [routeQuery, setRouteQuery] = useState("");
  const [routeStatus, setRouteStatus] = useState("all");
  const [routeDetails, setRouteDetails] = useState<RouteDetails | null>(null);
  const [loadingRouteDetails, setLoadingRouteDetails] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const initialWorkflowSelected=useRef(false);
  const workAreaRef=useRef<HTMLElement>(null);

  const [routeForm, setRouteForm] = useState({
    name: "",
    routeDate: "",
    truckId: "",
    driverId: "",
    notes: "",
    jobIds: [] as string[],
  });

  const [assignForm, setAssignForm] = useState({
    truckId: "",
    driverId: "",
  });

  const [zoneForm, setZoneForm] = useState({
    name: "",
    description: "",
    areaType: "commercial",
    latitude: "",
    longitude: "",
  });

  const [truckForm, setTruckForm] = useState({
    plateNumber: "",
    truckName: "",
    capacityTons: "",
  });

  const [driverForm, setDriverForm] = useState({
    fullName: "",
    phone: "",
    licenseNumber: "",
  });

  const [scheduleForm, setScheduleForm] = useState({
    zoneId: "",
    name: "",
    frequency: "weekly",
    preferredTime: "",
  });

  const [jobForm, setJobForm] = useState({
    zoneId: "",
    truckId: "",
    driverId: "",
    scheduleId: "",
    jobDate: "",
    wasteType: "mixed",
    estimatedWeightKg: "",
    notes: "",
  });

  const filteredJobs = useMemo(() => {
    if (jobFilter === "all") return jobs;
    return jobs.filter((job) => job.status === jobFilter);
  }, [jobs, jobFilter]);
  const eligibleRouteJobs = useMemo(() => {
    if (!routeForm.routeDate || !routeForm.truckId || !routeForm.driverId) {
      return [];
    }

    return jobs.filter(
      (job) =>
        job.job_date.slice(0, 10) === routeForm.routeDate &&
        (job.status === "pending" || job.status === "assigned") &&
        !job.is_routed &&
        (!job.truck_id || job.truck_id === routeForm.truckId) &&
        (!job.driver_id || job.driver_id === routeForm.driverId)
    );
  }, [jobs, routeForm.driverId, routeForm.routeDate, routeForm.truckId]);
  const dispatchJobs = useMemo(() => {
    return jobs
      .filter((job) => job.status !== "completed" && job.status !== "cancelled")
      .sort((a, b) => {
        const statusOrder: Record<string, number> = {
          in_progress: 1,
          assigned: 2,
          pending: 3,
          missed: 4,
        };

        return (
          (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99) ||
          new Date(a.job_date).getTime() - new Date(b.job_date).getTime()
        );
      });
  }, [jobs]);

  const dispatchStats = useMemo(() => {
    return {
      pending: jobs.filter((job) => job.status === "pending").length,
      assigned: jobs.filter((job) => job.status === "assigned").length,
      inProgress: jobs.filter((job) => job.status === "in_progress").length,
      completed: jobs.filter((job) => job.status === "completed").length,
    };
  }, [jobs]);
  const pendingExceptions=useMemo(()=>customerStops.filter(stop=>stop.status==="skipped"&&stop.exception_review_status==="pending"),[customerStops]);
  const today=new Date().toISOString().slice(0,10);
  const todayJobs=useMemo(()=>jobs.filter(job=>job.job_date.slice(0,10)===today),[jobs,today]);
  const todayRoutes=useMemo(()=>routes.filter(route=>route.route_date.slice(0,10)===today),[routes,today]);
  const dailySteps=useMemo(()=>[
    {number:"1",title:"Prepare work",detail:schedules.length?`${schedules.filter(item=>item.is_active).length} active schedules`:`No collection schedules`,state:schedules.some(item=>item.is_active)?"ready":"action required",tab:"schedules" as ActiveTab,action:schedules.some(item=>item.is_active)?"Review schedules":"Create schedule"},
    {number:"2",title:"Check today’s jobs",detail:todayJobs.length?`${todayJobs.length} jobs planned for today`:`No jobs planned for today`,state:todayJobs.length?"ready":"action required",tab:"jobs" as ActiveTab,action:"Open jobs"},
    {number:"3",title:"Build routes",detail:todayRoutes.length?`${todayRoutes.length} routes for today`:`No routes created for today`,state:todayRoutes.length?"ready":"action required",tab:"routes" as ActiveTab,action:todayRoutes.length?"Review routes":"Create route"},
    {number:"4",title:"Monitor delivery",detail:`${dispatchStats.inProgress} in progress · ${dispatchStats.completed} completed`,state:dispatchStats.inProgress?"live":dispatchStats.completed?"progress recorded":"waiting",tab:"dispatch" as ActiveTab,action:"Open dispatch"},
    {number:"5",title:"Resolve exceptions",detail:pendingExceptions.length?`${pendingExceptions.length} require a decision`:`No unresolved exceptions`,state:pendingExceptions.length?"action required":"clear",tab:"exceptions" as ActiveTab,action:pendingExceptions.length?"Resolve now":"Review"},
  ],[dispatchStats.completed,dispatchStats.inProgress,pendingExceptions.length,schedules,todayJobs.length,todayRoutes.length]);
  const currentDailyStep=dailySteps.find(step=>step.tab===activeTab);
  function openDailyTab(tab:ActiveTab){
    setActiveTab(tab);
    setEditorOpen(false);
    window.requestAnimationFrame(()=>workAreaRef.current?.scrollIntoView({behavior:"smooth",block:"start"}));
  }
  const editorCopy:Partial<Record<ActiveTab,{action:string,title:string,description:string}>>={
    schedules:{action:"New schedule",title:"Create pickup schedule",description:"Define when an assigned service area should be collected."},
    jobs:{action:"Add collection job",title:"Create collection job",description:"Add one collection task to the operating plan."},
    routes:{action:"Build route",title:"Build collection route",description:"Choose the date, crew, vehicle and compatible collection jobs."},
    drivers:{action:"Add driver",title:"Add driver",description:"Register a driver who can be assigned to collection work."},
    trucks:{action:"Add vehicle",title:"Add vehicle",description:"Register a collection vehicle for dispatch."},
    zones:{action:canAssignServiceAreas?"Add service zone":"View zone guidance",title:canAssignServiceAreas?"Add service zone":"Assigned service areas",description:canAssignServiceAreas?"Create a regulated collection area and assign responsibility separately.":"KCCA controls service-area assignment. Your team plans work inside assigned areas."},
  };
  const activeEditor=canAssignServiceAreas&&activeTab==="routes"?undefined:editorCopy[activeTab];
  const filteredRoutes = useMemo(() => routes.filter((route) =>
    (routeStatus === "all" || route.status === routeStatus) &&
    `${route.name} ${route.plate_number || ""} ${route.driver_name || ""}`.toLowerCase().includes(routeQuery.toLowerCase())
  ), [routeQuery, routeStatus, routes]);
  const routePages = usePagination(filteredRoutes, 10);
  async function loadWasteData() {
    try {
      setLoading(true);
      setError("");

      const [
        zonesResponse,
        trucksResponse,
        driversResponse,
        schedulesResponse,
        jobsResponse,
        routesResponse,
        customerStopsResponse,
      ] = await Promise.all([
        apiRequest<ApiListResponse<Zone>>("/api/waste/zones"),
        apiRequest<ApiListResponse<Truck>>("/api/waste/trucks"),
        apiRequest<ApiListResponse<Driver>>("/api/waste/drivers"),
        apiRequest<ApiListResponse<PickupSchedule>>(
          "/api/waste/pickup-schedules"
        ),
        apiRequest<ApiListResponse<CollectionJob>>(
          "/api/waste/collection-jobs"
        ),
        apiRequest<ApiListResponse<CollectionRoute>>(
          "/api/waste/collection-routes"
        ),
        canAssignServiceAreas
          ? Promise.resolve({success:true,message:"Not available in regulatory scope",data:[]} as ApiListResponse<CustomerStop>)
          : apiRequest<ApiListResponse<CustomerStop>>("/api/waste/customer-collection-stops"),
      ]);

      setZones(zonesResponse.data);
      setTrucks(trucksResponse.data);
      setDrivers(driversResponse.data);
      setSchedules(schedulesResponse.data);
      setJobs(jobsResponse.data);
      setRoutes(routesResponse.data);
      setCustomerStops(customerStopsResponse.data);
      if(!canAssignServiceAreas&&!initialWorkflowSelected.current){
        const date=new Date().toISOString().slice(0,10),activeSchedules=schedulesResponse.data.some(item=>item.is_active),dailyJobs=jobsResponse.data.some(item=>item.job_date.slice(0,10)===date),dailyRoutes=routesResponse.data.some(item=>item.route_date.slice(0,10)===date);
        setActiveTab(!activeSchedules?"schedules":!dailyJobs?"jobs":!dailyRoutes?"routes":"dispatch");
        initialWorkflowSelected.current=true;
      }
      if (canAssignServiceAreas) {
        const organizationsResponse = await apiRequest<ApiListResponse<Organization>>("/api/organizations");
        setCompanies(organizationsResponse.data.filter((organization) =>
          organization.type === "waste_collection_company" && organization.is_active
        ));
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to load waste data"
      );
    } finally {
      setLoading(false);
    }
  }

  function selectServiceZone(zone: Zone) {
    setSelectedServiceZoneId(zone.id);
    setServiceAreaForm({
      organizationId: zone.organization_id || "",
      latitude: zone.latitude?.toString() || "",
      longitude: zone.longitude?.toString() || "",
    });
    setMessage("");
    setEditorOpen(true);
  }

  async function assignServiceArea(event: React.FormEvent) {
    event.preventDefault();
    try {
      setSaving(true); setError(""); setMessage("");
      const payload: { organizationId: string; latitude?: number; longitude?: number } = {
        organizationId: serviceAreaForm.organizationId,
      };
      if (serviceAreaForm.latitude && serviceAreaForm.longitude) {
        payload.latitude = Number(serviceAreaForm.latitude);
        payload.longitude = Number(serviceAreaForm.longitude);
      }
      await apiRequest<{ data: { rematched_customers: number } }>(
        `/api/waste/zones/${selectedServiceZoneId}/service-assignment`,
        { method: "PATCH", body: JSON.stringify(payload) }
      );
      setMessage("Service area assigned. Existing customer providers, contracts and balances were not transferred.");
      await loadWasteData();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : "Failed to assign service area");
    } finally { setSaving(false); }
  }

  async function createZone(event: React.FormEvent) {
    event.preventDefault();

    try {
      setSaving(true);
      setError("");

      const payload: {
        name: string;
        description?: string;
        areaType: string;
        latitude?: number;
        longitude?: number;
      } = {
        name: zoneForm.name,
        areaType: zoneForm.areaType,
      };

      if (zoneForm.description.trim())
        payload.description = zoneForm.description.trim();

      if (zoneForm.latitude.trim() && zoneForm.longitude.trim()) {
        payload.latitude = Number(zoneForm.latitude);
        payload.longitude = Number(zoneForm.longitude);
      }

      await apiRequest("/api/waste/zones", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setZoneForm({
        name: "",
        description: "",
        areaType: "commercial",
        latitude: "",
        longitude: "",
      });
      setEditorOpen(false);
      await loadWasteData();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to create zone"
      );
    } finally {
      setSaving(false);
    }
  }

  async function createTruck(event: React.FormEvent) {
    event.preventDefault();

    try {
      setSaving(true);
      setError("");

      await apiRequest("/api/waste/trucks", {
        method: "POST",
        body: JSON.stringify({
          plateNumber: truckForm.plateNumber,
          truckName: truckForm.truckName || undefined,
          capacityTons: truckForm.capacityTons
            ? Number(truckForm.capacityTons)
            : undefined,
        }),
      });

      setTruckForm({ plateNumber: "", truckName: "", capacityTons: "" });
      setEditorOpen(false);
      await loadWasteData();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to create truck"
      );
    } finally {
      setSaving(false);
    }
  }

  async function createDriver(event: React.FormEvent) {
    event.preventDefault();

    try {
      setSaving(true);
      setError("");

      await apiRequest("/api/waste/drivers", {
        method: "POST",
        body: JSON.stringify({
          fullName: driverForm.fullName,
          phone: driverForm.phone || undefined,
          licenseNumber: driverForm.licenseNumber || undefined,
        }),
      });

      setDriverForm({ fullName: "", phone: "", licenseNumber: "" });
      setEditorOpen(false);
      await loadWasteData();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to create driver"
      );
    } finally {
      setSaving(false);
    }
  }

  async function createSchedule(event: React.FormEvent) {
    event.preventDefault();

    try {
      setSaving(true);
      setError("");

      await apiRequest("/api/waste/pickup-schedules", {
        method: "POST",
        body: JSON.stringify({
          zoneId: scheduleForm.zoneId,
          name: scheduleForm.name,
          frequency: scheduleForm.frequency,
          preferredTime: scheduleForm.preferredTime || undefined,
        }),
      });

      setScheduleForm({
        zoneId: "",
        name: "",
        frequency: "weekly",
        preferredTime: "",
      });
      setEditorOpen(false);
      await loadWasteData();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Failed to create pickup schedule"
      );
    } finally {
      setSaving(false);
    }
  }

  async function createJob(event: React.FormEvent) {
    event.preventDefault();

    try {
      setSaving(true);
      setError("");

      await apiRequest("/api/waste/collection-jobs", {
        method: "POST",
        body: JSON.stringify({
          zoneId: jobForm.zoneId,
          truckId: jobForm.truckId || undefined,
          driverId: jobForm.driverId || undefined,
          scheduleId: jobForm.scheduleId || undefined,
          jobDate: jobForm.jobDate,
          wasteType: jobForm.wasteType,
          estimatedWeightKg: jobForm.estimatedWeightKg
            ? Number(jobForm.estimatedWeightKg)
            : undefined,
          notes: jobForm.notes || undefined,
        }),
      });

      setJobForm({
        zoneId: "",
        truckId: "",
        driverId: "",
        scheduleId: "",
        jobDate: "",
        wasteType: "mixed",
        estimatedWeightKg: "",
        notes: "",
      });
      setEditorOpen(false);
      await loadWasteData();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Failed to create collection job"
      );
    } finally {
      setSaving(false);
    }
  }
  async function createRoute(event: React.FormEvent) {
    event.preventDefault();

    if (!routeForm.routeDate || !routeForm.truckId || !routeForm.driverId) {
      setError("Choose a route date, vehicle and driver before selecting jobs.");
      return;
    }

    if (routeForm.jobIds.length === 0) {
      setError("Select at least one collection job for the route.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      await apiRequest("/api/waste/collection-routes", {
        method: "POST",
        body: JSON.stringify({
          name: routeForm.name,
          routeDate: routeForm.routeDate,
          truckId: routeForm.truckId,
          driverId: routeForm.driverId,
          jobIds: routeForm.jobIds,
          notes: routeForm.notes || undefined,
        }),
      });

      setRouteForm({
        name: "",
        routeDate: "",
        truckId: "",
        driverId: "",
        notes: "",
        jobIds: [],
      });
      setMessage("Route created and selected jobs assigned to its driver and vehicle.");
      setEditorOpen(false);
      await loadWasteData();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to create route"
      );
    } finally {
      setSaving(false);
    }
  }
  async function dispatchRoute(routeId: string) {
    try {
      setSaving(true);
      setError("");
      setMessage("");
      const response = await apiRequest<{ message: string }>(
        `/api/waste/collection-routes/${routeId}/dispatch`,
        { method: "PATCH" }
      );
      setMessage(response.message);
      await loadWasteData();
    } catch (dispatchError) {
      setError(dispatchError instanceof Error ? dispatchError.message : "Failed to dispatch route");
    } finally {
      setSaving(false);
    }
  }
  async function cancelRoute(event: React.FormEvent) {
    event.preventDefault();
    if (!routeToCancel) return;
    try {
      setSaving(true);
      setError("");
      const response = await apiRequest<{ message: string }>(
        `/api/waste/collection-routes/${routeToCancel.id}/cancel`,
        { method: "PATCH", body: JSON.stringify(routeCancellation) }
      );
      setMessage(response.message);
      setRouteToCancel(null);
      setRouteCancellation({ reason: "operational_delay", notes: "" });
      await loadWasteData();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Failed to cancel route");
    } finally {
      setSaving(false);
    }
  }
  async function viewRoute(routeId: string) {
    try {
      setLoadingRouteDetails(true);
      setError("");
      const response = await apiRequest<{ data: RouteDetails }>(`/api/waste/driver-routes/${routeId}`);
      setRouteDetails(response.data);
    } catch (detailsError) {
      setError(detailsError instanceof Error ? detailsError.message : "Failed to load route details");
    } finally {
      setLoadingRouteDetails(false);
    }
  }
  function toggleRouteJob(jobId: string) {
    setRouteForm((current) => ({
      ...current,
      jobIds: current.jobIds.includes(jobId)
        ? current.jobIds.filter((id) => id !== jobId)
        : [...current.jobIds, jobId],
    }));
  }
  async function updateJobStatus(jobId: string, status: string) {
    try {
      setSaving(true);
      setError("");

      await apiRequest(`/api/waste/collection-jobs/${jobId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });

      await loadWasteData();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to update job status"
      );
    } finally {
      setSaving(false);
    }
  }
  async function assignJob(jobId: string) {
    if (!assignForm.truckId || !assignForm.driverId) {
      setError("Please select both truck and driver before assigning the job.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      const result=await apiRequest<{data:{customer_stops_created:number;customer_stop_count:number}}>(`/api/waste/collection-jobs/${jobId}/assign`, {
        method: "PATCH",
        body: JSON.stringify({
          truckId: assignForm.truckId,
          driverId: assignForm.driverId,
        }),
      });

      setAssigningJobId(null);
      setAssignForm({
        truckId: "",
        driverId: "",
      });
      setMessage(result.data.customer_stops_created
        ? `Job assigned and ${result.data.customer_stops_created} eligible customer stops added automatically.`
        : `Job assigned. ${result.data.customer_stop_count||0} eligible customer stops are linked.`);

      await loadWasteData();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to assign job");
    } finally {
      setSaving(false);
    }
  }
  async function generateJobsFromSchedule(scheduleId: string) {
    try {
      setSaving(true);
      setError("");

      const result=await apiRequest<{data:{createdCount:number;skippedExistingJobs:number;customerStopsCreated:number}}>(
        `/api/waste/pickup-schedules/${scheduleId}/generate-jobs`,
        {
          method: "POST",
          body: JSON.stringify({
            startDate: new Date().toISOString().split("T")[0],
            daysAhead: 30,
            wasteType: "mixed",
            notes: "Generated from pickup schedule",
          }),
        }
      );

      setActiveTab("jobs");
      setMessage(`${result.data.createdCount} jobs created, ${result.data.skippedExistingJobs} existing dates kept, and ${result.data.customerStopsCreated} eligible customer stops planned automatically.`);
      await loadWasteData();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Failed to generate collection jobs"
      );
    } finally {
      setSaving(false);
    }
  }
  async function generateCustomerStops(jobId:string){try{setSaving(true);setError("");setMessage("");const result=await apiRequest<{message:string;data:{created:number;total:number}}>(`/api/waste/collection-jobs/${jobId}/customer-stops`,{method:"POST"});setMessage(`${result.message}. ${result.data.total} household stops are now linked to this area job.`);}catch(error){setError(error instanceof Error?error.message:"Failed to plan household stops");}finally{setSaving(false);}}
  async function reviewException(stopId:string,action:"resolve"|"reschedule"){
    const draft=exceptionDrafts[stopId]||{targetJobId:"",reviewNotes:""};
    if(draft.reviewNotes.trim().length<3){setError("Add a short review note before completing this action.");return;}
    if(action==="reschedule"&&!draft.targetJobId){setError("Choose a future job for this customer pickup.");return;}
    try{setSaving(true);setError("");setMessage("");
      const response=await apiRequest<{message:string}>(`/api/waste/customer-collection-stops/${stopId}/exception`,{method:"PATCH",body:JSON.stringify({action,targetJobId:action==="reschedule"?draft.targetJobId:undefined,reviewNotes:draft.reviewNotes})});
      setMessage(response.message);setExceptionDrafts(current=>{const next={...current};delete next[stopId];return next;});await loadWasteData();
    }catch(error){setError(error instanceof Error?error.message:"Failed to review collection exception");}finally{setSaving(false);}
  }
  // The role change represents a new isolated browser-tab session.
  useEffect(() => {
    const timer = window.setTimeout(() => void loadWasteData(), 0);
    return () => window.clearTimeout(timer);
    // loadWasteData intentionally reloads the complete operational snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAssignServiceAreas]);

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl">
        <PageHeader eyebrow="Field operations" title={canAssignServiceAreas?"City operations":"Daily operations"} description={canAssignServiceAreas?"Coordinate service areas, providers, routes and citywide collection outcomes.":"Prepare today’s collections, assign drivers and vehicles, monitor delivery, and resolve exceptions."}/>

        {error && <Feedback tone="error">{error}</Feedback>}
        {message && <Feedback tone="success">{message}</Feedback>}

        {!canAssignServiceAreas&&<section className="sticky top-[65px] z-10 mt-7 border-y border-slate-300 bg-[#f7f7f5]/95 py-3 backdrop-blur" aria-labelledby="daily-control-title"><div className="flex items-center justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[.15em] text-[#3156a3]">Today · {new Intl.DateTimeFormat("en-GB",{weekday:"short",day:"numeric",month:"short"}).format(new Date())}</p><h2 id="daily-control-title" className="mt-1 text-base font-semibold">Daily workflow</h2></div><button onClick={()=>void loadWasteData()} disabled={loading} className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#3156a3] disabled:opacity-50">Refresh</button></div><div className="mt-3 grid grid-cols-2 border border-slate-300 bg-white sm:grid-cols-5">{dailySteps.map(step=>{const selected=activeTab===step.tab;return <button key={step.number} onClick={()=>openDailyTab(step.tab)} aria-current={selected?"step":undefined} className={`min-h-16 border-b border-r border-slate-200 px-3 py-2 text-left last:border-r-0 sm:border-b-0 ${selected?"bg-[#3156a3] text-white":"hover:bg-slate-50"}`}><span className={`text-[10px] font-semibold uppercase tracking-wider ${selected?"text-blue-100":step.state==="action required"?"text-amber-700":"text-slate-400"}`}>{step.number} · {step.state}</span><span className="mt-1 block text-xs font-semibold">{step.title}</span></button>})}</div></section>}

        <section ref={workAreaRef} className="scroll-mt-52 py-5">
          <div>
            <div className="border-b border-slate-300">
              {canAssignServiceAreas?<div className="flex flex-col gap-3 py-4 md:flex-row md:items-center"><p className="w-36 flex-none text-[11px] font-semibold uppercase tracking-[.14em] text-slate-500">City workflow</p><div className="flex flex-wrap gap-2">{[["dispatch","City dispatch"],["zones",`Service zones (${zones.length})`],["routes",`Routes (${routes.length})`]].map(([key,label])=><button key={key} onClick={()=>openDailyTab(key as ActiveTab)} className={`border px-3 py-2 text-xs font-semibold ${activeTab===key?"border-[#3156a3] bg-[#3156a3] text-white":"border-slate-300 bg-white text-slate-700"}`}>{label}</button>)}</div>{activeEditor&&<button type="button" onClick={()=>setEditorOpen(true)} className="md:ml-auto bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white">{activeEditor.action}</button>}</div>:<div className="flex flex-col justify-between gap-4 py-4 sm:flex-row sm:items-end"><div><p className="text-[11px] font-semibold uppercase tracking-[.14em] text-[#3156a3]">Working area</p><h2 className="mt-1 text-xl font-semibold">{currentDailyStep?.title||activeTab.replaceAll("_"," ")}</h2><p className="mt-1 text-sm text-slate-500">{currentDailyStep?.detail||"Manage the supporting records used by daily operations."}</p></div>{activeEditor&&<button type="button" onClick={()=>setEditorOpen(true)} className="shrink-0 bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white">{activeEditor.action}</button>}</div>}
              {!canAssignServiceAreas&&<div className="flex flex-col gap-3 border-t border-slate-200 py-3 md:flex-row md:items-center"><p className="w-36 flex-none text-[11px] font-semibold uppercase tracking-[.14em] text-slate-500">Setup & reference</p><div className="flex flex-wrap gap-x-5 gap-y-2">{[["schedules",`Schedules (${schedules.length})`],["drivers",`Drivers (${drivers.length})`],["trucks",`Vehicles (${trucks.length})`],["zones",`Service zones (${zones.length})`]].map(([key,label])=><button key={key} onClick={()=>openDailyTab(key as ActiveTab)} className={`border-b pb-1 text-xs font-semibold ${activeTab===key?"border-[#3156a3] text-[#3156a3]":"border-transparent text-slate-500"}`}>{label}</button>)}</div></div>}
            </div>
            {activeTab === "jobs" && (
              <div className="mt-6 flex flex-wrap gap-3">
                {[
                  ["all", "All"],
                  ["pending", "Pending"],
                  ["assigned", "Assigned"],
                  ["in_progress", "In progress"],
                  ["completed", "Completed"],
                  ["cancelled", "Cancelled"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setJobFilter(key as JobFilter)}
                    className={[
                      "border px-4 py-2 text-xs font-black uppercase tracking-[0.12em]",
                      jobFilter === key
                        ? "border-[#3156a3] bg-[#3156a3] text-white"
                        : "border-slate-200 text-slate-600 hover:border-slate-400",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-6 overflow-hidden border border-slate-200 bg-white">
              {loading ? (
                <p className="p-6 text-sm text-slate-500">
                  Loading waste operations...
                </p>
              ) : activeTab === "dispatch" ? (
                <div className="space-y-6 p-6">
                  <div className="grid gap-px border-y border-slate-200 bg-slate-200 md:grid-cols-4">
                    <div className="bg-white p-4">
                      <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                        Pending
                      </p>
                      <p className="mt-2 text-3xl font-black text-slate-950">
                        {dispatchStats.pending}
                      </p>
                    </div>

                    <div className="bg-white p-4">
                      <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                        Assigned
                      </p>
                      <p className="mt-2 text-3xl font-black text-slate-950">
                        {dispatchStats.assigned}
                      </p>
                    </div>

                    <div className="bg-white p-4">
                      <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                        In Progress
                      </p>
                      <p className="mt-2 text-3xl font-black text-slate-950">
                        {dispatchStats.inProgress}
                      </p>
                    </div>

                    <div className="bg-white p-4">
                      <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                        Completed
                      </p>
                      <p className="mt-2 text-3xl font-black text-slate-950">
                        {dispatchStats.completed}
                      </p>
                    </div>
                  </div>

                  <div>
                    <h2 className="text-xl font-black text-slate-950">
                      Active dispatch queue
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Operational view of jobs that still need dispatch
                      attention.
                    </p>
                  </div>

                  <table className="w-full min-w-[920px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Date / Zone</th>
                        <th className="px-4 py-3">Driver</th>
                        <th className="px-4 py-3">Truck</th>
                        <th className="px-4 py-3">Waste</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Action</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-200">
                      {dispatchJobs.length ? (
                        dispatchJobs.map((job) => (
                          <tr key={job.id}>
                            <td className="px-4 py-4">
                              <p className="font-black text-slate-950">
                                {formatJobDate(job.job_date)}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {job.zone_name || "Unknown zone"}
                              </p>
                            </td>

                            <td className="px-4 py-4 text-slate-600">
                              {job.driver_name || "Not assigned"}
                            </td>

                            <td className="px-4 py-4 text-slate-600">
                              {job.plate_number || "Not assigned"}
                            </td>

                            <td className="px-4 py-4 text-slate-600">
                              {formatLabel(job.waste_type)}
                            </td>

                            <td className="px-4 py-4">
                              <span
                                className={`border px-3 py-1 text-xs font-black ${statusClass(
                                  job.status
                                )}`}
                              >
                                {formatLabel(job.status)}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-right">
                              <button onClick={()=>setActiveTab(job.is_routed?"routes":"jobs")} className="border border-slate-300 px-3 py-2 text-xs font-semibold text-[#3156a3]">
                                {job.is_routed?"Open route":"Open job"}
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                            <p className="font-semibold text-slate-700">No active dispatch work</p><p className="mt-1 text-xs">Open Schedules or Jobs to prepare today’s collections.</p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : activeTab === "exceptions" ? (
                <div>
                  <div className="border-b border-slate-200 px-5 py-4"><h2 className="text-lg font-semibold text-slate-950">Collection exceptions</h2><p className="mt-1 text-sm text-slate-500">Review household pickups that drivers could not complete. Close the case or move it to a suitable future job.</p></div>
                  {pendingExceptions.length?<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Customer / location</th><th>Original service</th><th>Reason</th><th>Operations decision</th></tr></thead><tbody>{pendingExceptions.map(stop=>{
                    const draft=exceptionDrafts[stop.id]||{targetJobId:"",reviewNotes:""};
                    const eligibleJobs=jobs.filter(job=>job.zone_id===stop.zone_id&&["pending","assigned"].includes(job.status)&&new Date(job.job_date)>=new Date(stop.scheduled_date));
                    return <tr key={stop.id}><td><p className="table-primary">{stop.customer_name}</p><p className="table-secondary">{stop.address}</p></td><td><p>{formatJobDate(stop.scheduled_date)}</p><p className="table-secondary">{stop.zone_name||"Unknown zone"}</p></td><td><p className="font-semibold text-amber-800">{formatLabel(stop.exception_reason||"Unspecified")}</p><p className="table-secondary">{stop.exception_notes||"No driver note"}</p></td><td className="min-w-[320px]"><div className="grid gap-2"><select aria-label={`Replacement job for ${stop.customer_name}`} value={draft.targetJobId} onChange={event=>setExceptionDrafts(current=>({...current,[stop.id]:{...draft,targetJobId:event.target.value}}))} className="w-full border border-slate-300 px-2 py-2 text-xs"><option value="">Choose a replacement job (optional)</option>{eligibleJobs.map(job=><option key={job.id} value={job.id}>{formatJobDate(job.job_date)} · {job.driver_name||"Unassigned driver"}</option>)}</select><input aria-label={`Review note for ${stop.customer_name}`} value={draft.reviewNotes} onChange={event=>setExceptionDrafts(current=>({...current,[stop.id]:{...draft,reviewNotes:event.target.value}}))} placeholder="Review note" className="w-full border border-slate-300 px-2 py-2 text-xs"/><div className="flex justify-end gap-2"><button disabled={saving} onClick={()=>void reviewException(stop.id,"resolve")} className="border border-slate-300 px-3 py-2 text-xs font-semibold">Close case</button><button disabled={saving||!draft.targetJobId} onClick={()=>void reviewException(stop.id,"reschedule")} className="bg-[#3156a3] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Reschedule</button></div></div></td></tr>;
                  })}</tbody></table></div>:<div className="p-8 text-center"><p className="font-semibold text-slate-800">No collection exceptions need review</p><p className="mt-1 text-sm text-slate-500">New failed-pickup reports from drivers will appear here.</p></div>}
                </div>
              ) : activeTab === "zones" ? (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Zone</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Service provider</th>
                      <th className="px-4 py-3">Customers</th>
                      <th className="px-4 py-3">Coordinates</th>
                      <th className="px-4 py-3">Status</th>
                      {canAssignServiceAreas && <th className="px-4 py-3">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {zones.length ? (
                      zones.map((zone) => (
                        <tr key={zone.id}>
                          <td className="px-4 py-4">
                            <p className="font-black text-slate-950">
                              {zone.name}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {zone.description || "No description"}
                            </p>
                          </td>
                          <td className="px-4 py-4 text-slate-600">
                            {formatLabel(zone.area_type)}
                          </td>
                          <td className="px-4 py-4 text-slate-600">
                            {zone.organization_name || <span className="font-bold text-amber-700">Not assigned</span>}
                          </td>
                          <td className="px-4 py-4 font-black text-slate-900">
                            {zone.customer_count}
                          </td>
                          <td className="px-4 py-4 text-slate-600">
                            {zone.latitude && zone.longitude
                              ? `${zone.latitude}, ${zone.longitude}`
                              : "Not mapped"}
                          </td>
                          <td className="px-4 py-4">
                            <span
                              className={`border px-3 py-1 text-xs font-black ${statusClass(
                                zone.is_active ? "completed" : "cancelled"
                              )}`}
                            >
                              {zone.is_active ? "Active" : "Inactive"}
                            </span>
                          </td>
                          {canAssignServiceAreas && <td className="px-4 py-4">
                            <button type="button" onClick={() => selectServiceZone(zone)} className="border border-emerald-700 px-3 py-2 text-xs font-black text-emerald-800 hover:bg-emerald-50">
                              {zone.organization_id ? "Edit assignment" : "Assign company"}
                            </button>
                          </td>}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={canAssignServiceAreas ? 7 : 6} className="px-4 py-6 text-slate-500">
                          No waste zones added yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : activeTab === "trucks" ? (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Plate</th>
                      <th className="px-4 py-3">Truck</th>
                      <th className="px-4 py-3">Capacity</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {trucks.length ? (
                      trucks.map((truck) => (
                        <tr key={truck.id}>
                          <td className="px-4 py-4 font-black text-slate-950">
                            {truck.plate_number}
                          </td>
                          <td className="px-4 py-4 text-slate-600">
                            {truck.truck_name || "Unnamed truck"}
                          </td>
                          <td className="px-4 py-4 text-slate-600">
                            {truck.capacity_tons || "Not set"} tons
                          </td>
                          <td className="px-4 py-4">
                            <span
                              className={`border px-3 py-1 text-xs font-black ${statusClass(
                                truck.status
                              )}`}
                            >
                              {formatLabel(truck.status)}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-slate-500">
                          No trucks added yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : activeTab === "drivers" ? (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Driver</th>
                      <th className="px-4 py-3">Phone</th>
                      <th className="px-4 py-3">License</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {drivers.length ? (
                      drivers.map((driver) => (
                        <tr key={driver.id}>
                          <td className="px-4 py-4 font-black text-slate-950">
                            {driver.full_name}
                          </td>
                          <td className="px-4 py-4 text-slate-600">
                            {driver.phone || "No phone"}
                          </td>
                          <td className="px-4 py-4 text-slate-600">
                            {driver.license_number || "Not set"}
                          </td>
                          <td className="px-4 py-4">
                            <span
                              className={`border px-3 py-1 text-xs font-black ${statusClass(
                                driver.status
                              )}`}
                            >
                              {formatLabel(driver.status)}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-slate-500">
                          No drivers added yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : activeTab === "schedules" ? (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Schedule</th>
                      <th className="px-4 py-3">Zone</th>
                      <th className="px-4 py-3">Frequency</th>
                      <th className="px-4 py-3">Preferred time</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {schedules.length ? (
                      schedules.map((schedule) => (
                        <tr key={schedule.id}>
                          <td className="px-4 py-4 font-black text-slate-950">
                            {schedule.name}
                          </td>
                          <td className="px-4 py-4 text-slate-600">
                            {schedule.zone_name || "Unknown zone"}
                          </td>
                          <td className="px-4 py-4 text-slate-600">
                            {formatLabel(schedule.frequency)}
                          </td>
                          <td className="px-4 py-4 text-slate-600">
                            {schedule.preferred_time || "Not set"}
                          </td>
                          <td className="px-4 py-4">
                            <span
                              className={`border px-3 py-1 text-xs font-black ${statusClass(
                                schedule.is_active ? "completed" : "cancelled"
                              )}`}
                            >
                              {schedule.is_active ? "Active" : "Inactive"}
                            </span>
                          </td>

                          <td className="px-4 py-4 text-right">
                            <button
                              type="button"
                              disabled={saving || !schedule.is_active}
                              onClick={() =>
                                generateJobsFromSchedule(schedule.id)
                              }
                              className="border border-emerald-700 px-3 py-2 text-xs font-black text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Plan next 30 days
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-slate-500">
                          No pickup schedules created yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              ) : activeTab === "routes" ? (
                routes.length ? (
                  <>
                  <div className="table-toolbar">
                    <input type="search" aria-label="Search routes" value={routeQuery} onChange={(event)=>{setRouteQuery(event.target.value);routePages.setPage(1);}} placeholder="Search route, driver or vehicle" className="table-search" />
                    <select aria-label="Filter route status" value={routeStatus} onChange={(event)=>{setRouteStatus(event.target.value);routePages.setPage(1);}} className="border border-slate-300 px-3 py-2 text-sm"><option value="all">All statuses</option><option value="planned">Planned</option><option value="dispatched">Dispatched</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>
                    <span className="table-count">{filteredRoutes.length} results</span>
                  </div>
                  {filteredRoutes.length ? <>
                  <table className="w-full min-w-[920px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Route</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Truck</th>
                        <th className="px-4 py-3">Driver</th>
                        <th className="px-4 py-3">Jobs</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Action</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-200">
                      {routePages.paged.map((route) => (
                        <tr key={route.id}>
                          <td className="px-4 py-4">
                            <p className="font-black text-slate-950">
                              {route.name}
                            </p>

                            {route.notes && (
                              <p className="mt-1 text-xs text-slate-500">
                                {route.notes}
                              </p>
                            )}
                          </td>

                          <td className="px-4 py-4 text-slate-600">
                            {formatJobDate(route.route_date)}
                          </td>

                          <td className="px-4 py-4 text-slate-600">
                            {route.plate_number || "Not assigned"}
                          </td>

                          <td className="px-4 py-4 text-slate-600">
                            {route.driver_name || "Not assigned"}
                          </td>

                          <td className="px-4 py-4 text-slate-600">
                            {route.job_count}
                          </td>

                          <td className="px-4 py-4">
                            <span
                              className={`border px-3 py-1 text-xs font-black ${statusClass(
                                route.status
                              )}`}
                            >
                              {formatLabel(route.status)}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center justify-end gap-2">
                            <button type="button" disabled={loadingRouteDetails} onClick={()=>void viewRoute(route.id)} className="px-2 py-2 text-xs font-semibold text-[#3156a3] hover:underline">View</button>
                            {canManageRoutes && route.status === "planned" ? (
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => void dispatchRoute(route.id)}
                                className="border border-[#3156a3] px-3 py-2 text-xs font-semibold text-[#3156a3] hover:bg-blue-50 disabled:opacity-50"
                              >
                                Dispatch
                              </button>
                            ) : null}
                            {canManageRoutes && ["planned", "dispatched", "in_progress"].includes(route.status) ? (
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => { setRouteToCancel(route); setRouteCancellation({ reason: "operational_delay", notes: "" }); }}
                                className="border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-red-300 hover:text-red-700 disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            ) : null}
                            {!canManageRoutes || !["planned", "dispatched", "in_progress"].includes(route.status) ? (
                              <span className="text-xs text-slate-500">View only</span>
                            ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination page={routePages.page} pageSize={routePages.pageSize} total={routePages.total} totalPages={routePages.totalPages} onPage={routePages.setPage} onPageSize={routePages.setPageSize}/>
                  </> : <p className="p-6 text-sm text-slate-500">No routes match this search and status.</p>}
                  </>
                ) : (
                  <p className="p-6 text-sm text-slate-500">
                    No collection routes created yet.
                  </p>
                )
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Date / Zone</th>
                      <th className="px-4 py-3">Assignment</th>
                      <th className="px-4 py-3">Waste</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filteredJobs.length ? (
                      filteredJobs.map((job) => (
                        <tr key={job.id}>
                          <td className="px-4 py-4">
                            <p className="font-black text-slate-950">
                              {formatJobDate(job.job_date)}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {job.zone_name || "Unknown zone"}
                            </p>
                          </td>
                          <td className="px-4 py-4 text-slate-600">
                            <p>Driver: {job.driver_name || "Not assigned"}</p>
                            <p className="mt-1 text-xs">
                              Truck: {job.plate_number || "Not assigned"}
                            </p>
                          </td>
                          <td className="px-4 py-4 text-slate-600">
                            <p>{formatLabel(job.waste_type)}</p>
                            <p className="mt-1 text-xs">
                              Est: {job.estimated_weight_kg || "-"} kg
                            </p>
                            <p className="mt-1 text-xs">
                              Customer stops: {job.resolved_customer_stop_count || 0}/{job.customer_stop_count || 0}
                            </p>
                          </td>
                          <td className="px-4 py-4">
                            <span
                              className={`border px-3 py-1 text-xs font-black ${statusClass(
                                job.status
                              )}`}
                            >
                              {formatLabel(job.status)}
                            </span>
                          </td>

                          <td className="px-4 py-4 text-right align-top">
                            {['pending','assigned'].includes(job.status)&&<button type="button" disabled={saving} onClick={()=>generateCustomerStops(job.id)} className="mb-2 border border-[#3156a3] px-3 py-2 text-xs font-semibold text-[#3156a3] disabled:opacity-50">Plan customer stops</button>}
                            {job.status === "pending" &&
                              assigningJobId !== job.id && (
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => {
                                    setAssigningJobId(job.id);
                                    setAssignForm({
                                      truckId: job.truck_id || "",
                                      driverId: job.driver_id || "",
                                    });
                                  }}
                                  className="border border-slate-300 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                                >
                                  Assign
                                </button>
                              )}

                            {job.status === "pending" &&
                              assigningJobId === job.id && (
                                <div className="ml-auto w-64 space-y-2 text-left">
                                  <select
                                    value={assignForm.truckId}
                                    onChange={(event) =>
                                      setAssignForm({
                                        ...assignForm,
                                        truckId: event.target.value,
                                      })
                                    }
                                    className="w-full border border-slate-300 px-3 py-2 text-xs outline-none focus:border-emerald-700"
                                  >
                                    <option value="">Select truck</option>
                                    {trucks.map((truck) => (
                                      <option key={truck.id} value={truck.id}>
                                        {truck.plate_number}
                                      </option>
                                    ))}
                                  </select>

                                  <select
                                    value={assignForm.driverId}
                                    onChange={(event) =>
                                      setAssignForm({
                                        ...assignForm,
                                        driverId: event.target.value,
                                      })
                                    }
                                    className="w-full border border-slate-300 px-3 py-2 text-xs outline-none focus:border-emerald-700"
                                  >
                                    <option value="">Select driver</option>
                                    {drivers.map((driver) => (
                                      <option key={driver.id} value={driver.id}>
                                        {driver.full_name}
                                      </option>
                                    ))}
                                  </select>

                                  <div className="flex justify-end gap-2">
                                    <button
                                      type="button"
                                      disabled={saving}
                                      onClick={() => {
                                        setAssigningJobId(null);
                                        setAssignForm({
                                          truckId: "",
                                          driverId: "",
                                        });
                                      }}
                                      className="border border-slate-300 px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                                    >
                                      Cancel
                                    </button>

                                    <button
                                      type="button"
                                      disabled={saving}
                                      onClick={() => assignJob(job.id)}
                                      className="bg-emerald-700 px-3 py-2 text-xs font-black text-white hover:bg-emerald-800 disabled:opacity-60"
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                              )}

                            {job.status === "assigned" && (
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() =>
                                  updateJobStatus(job.id, "in_progress")
                                }
                                className="border border-emerald-700 px-3 py-2 text-xs font-black text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
                              >
                                Start
                              </button>
                            )}

                            {job.status === "in_progress" && (
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() =>
                                  updateJobStatus(job.id, "completed")
                                }
                                className="bg-emerald-700 px-3 py-2 text-xs font-black text-white hover:bg-emerald-800 disabled:opacity-60"
                              >
                                Complete
                              </button>
                            )}

                            {job.status !== "completed" &&
                              job.status !== "cancelled" && (
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() =>
                                    updateJobStatus(job.id, "cancelled")
                                  }
                                  className="mt-2 block border border-red-300 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-50 disabled:opacity-60"
                                >
                                  Cancel
                                </button>
                              )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-slate-500">
                          No collection jobs found for this filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {editorOpen&&activeEditor&&<div role="dialog" aria-modal="true" aria-labelledby="operations-editor-title" className="fixed inset-0 z-50 flex justify-end bg-slate-950/40" onMouseDown={(event)=>{if(event.target===event.currentTarget&&!saving)setEditorOpen(false)}}>
          <aside className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-xl">
            <header className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-slate-200 bg-white px-6 py-5"><div><p className="text-[11px] font-semibold uppercase tracking-[.14em] text-[#3156a3]">Daily operations</p><h2 id="operations-editor-title" className="mt-1 text-xl font-semibold text-slate-950">{activeEditor.title}</h2><p className="mt-1 text-sm leading-6 text-slate-500">{activeEditor.description}</p></div><button type="button" disabled={saving} onClick={()=>setEditorOpen(false)} className="border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Close</button></header>
            <div className="p-6">
            {activeTab === "zones" && (
              <>
                {canAssignServiceAreas && selectedServiceZoneId && <form onSubmit={assignServiceArea} className="mb-8 border-b border-slate-200 pb-8">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">KCCA service assignment</p>
                  <h2 className="mt-2 text-2xl font-black text-slate-950">Assign responsible company</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">Choose the company accountable for collections in this zone. Coordinates help match customer properties and map operations.</p>
                  <select required value={serviceAreaForm.organizationId} onChange={(event)=>setServiceAreaForm({...serviceAreaForm,organizationId:event.target.value})} className="mt-5 w-full border border-slate-300 px-4 py-3 text-sm">
                    <option value="">Select active waste company</option>
                    {companies.map((company)=><option key={company.id} value={company.id}>{company.name}</option>)}
                  </select>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <input type="number" step="any" value={serviceAreaForm.latitude} onChange={(event)=>setServiceAreaForm({...serviceAreaForm,latitude:event.target.value})} placeholder="Zone latitude" className="w-full border border-slate-300 px-4 py-3 text-sm" />
                    <input type="number" step="any" value={serviceAreaForm.longitude} onChange={(event)=>setServiceAreaForm({...serviceAreaForm,longitude:event.target.value})} placeholder="Zone longitude" className="w-full border border-slate-300 px-4 py-3 text-sm" />
                  </div>
                  <button disabled={saving} className="mt-3 w-full bg-slate-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50">{saving ? "Assigning..." : "Save service assignment"}</button>
                </form>}
                {canAssignServiceAreas ? <>
                <h2 className="text-2xl font-black text-slate-950">Add collection zone</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">Create a city service area, then assign an accountable waste collection company.</p>
                <form onSubmit={createZone} className="mt-7 space-y-5">
                  <input
                    value={zoneForm.name}
                    onChange={(event) =>
                      setZoneForm({ ...zoneForm, name: event.target.value })
                    }
                    required
                    placeholder="Zone name"
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  />
                  <select
                    value={zoneForm.areaType}
                    onChange={(event) =>
                      setZoneForm({ ...zoneForm, areaType: event.target.value })
                    }
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  >
                    {[
                      "residential",
                      "commercial",
                      "industrial",
                      "market",
                      "school",
                      "hospital",
                      "informal_settlement",
                      "mixed",
                    ].map((type) => (
                      <option key={type} value={type}>
                        {formatLabel(type)}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={zoneForm.description}
                    onChange={(event) =>
                      setZoneForm({
                        ...zoneForm,
                        description: event.target.value,
                      })
                    }
                    placeholder="Description"
                    className="min-h-24 w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      value={zoneForm.latitude}
                      onChange={(event) =>
                        setZoneForm({
                          ...zoneForm,
                          latitude: event.target.value,
                        })
                      }
                      placeholder="Latitude"
                      className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                    />
                    <input
                      value={zoneForm.longitude}
                      onChange={(event) =>
                        setZoneForm({
                          ...zoneForm,
                          longitude: event.target.value,
                        })
                      }
                      placeholder="Longitude"
                      className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                    />
                  </div>
                  <button
                    disabled={saving}
                    className="w-full bg-emerald-700 px-5 py-4 text-sm font-black text-white hover:bg-emerald-800 disabled:opacity-60"
                  >
                    {saving ? "Saving..." : "Create zone"}
                  </button>
                </form>
                </> : <div className="border border-slate-200 bg-slate-50 p-5">
                  <h2 className="text-lg font-black text-slate-950">Assigned service areas</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">Zones are assigned by KCCA. Your company can manage schedules, jobs, routes, fleet, and customers for the areas shown here.</p>
                </div>}
              </>
            )}
            {activeTab === "trucks" && (
              <>
                <h2 className="text-2xl font-black text-slate-950">
                  Add truck
                </h2>
                <form onSubmit={createTruck} className="mt-7 space-y-5">
                  <input
                    value={truckForm.plateNumber}
                    onChange={(event) =>
                      setTruckForm({
                        ...truckForm,
                        plateNumber: event.target.value,
                      })
                    }
                    required
                    placeholder="Plate number"
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  />
                  <input
                    value={truckForm.truckName}
                    onChange={(event) =>
                      setTruckForm({
                        ...truckForm,
                        truckName: event.target.value,
                      })
                    }
                    placeholder="Truck name"
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  />
                  <input
                    value={truckForm.capacityTons}
                    onChange={(event) =>
                      setTruckForm({
                        ...truckForm,
                        capacityTons: event.target.value,
                      })
                    }
                    placeholder="Capacity tons"
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  />
                  <button
                    disabled={saving}
                    className="w-full bg-emerald-700 px-5 py-4 text-sm font-black text-white hover:bg-emerald-800 disabled:opacity-60"
                  >
                    {saving ? "Saving..." : "Create truck"}
                  </button>
                </form>
              </>
            )}
            {activeTab === "drivers" && (
              <>
                <h2 className="text-2xl font-black text-slate-950">
                  Add driver
                </h2>
                <form onSubmit={createDriver} className="mt-7 space-y-5">
                  <input
                    value={driverForm.fullName}
                    onChange={(event) =>
                      setDriverForm({
                        ...driverForm,
                        fullName: event.target.value,
                      })
                    }
                    required
                    placeholder="Full name"
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  />
                  <input
                    value={driverForm.phone}
                    onChange={(event) =>
                      setDriverForm({
                        ...driverForm,
                        phone: event.target.value,
                      })
                    }
                    placeholder="Phone"
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  />
                  <input
                    value={driverForm.licenseNumber}
                    onChange={(event) =>
                      setDriverForm({
                        ...driverForm,
                        licenseNumber: event.target.value,
                      })
                    }
                    placeholder="License number"
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  />
                  <button
                    disabled={saving}
                    className="w-full bg-emerald-700 px-5 py-4 text-sm font-black text-white hover:bg-emerald-800 disabled:opacity-60"
                  >
                    {saving ? "Saving..." : "Create driver"}
                  </button>
                </form>
              </>
            )}
            {activeTab === "schedules" && (
              <>
                <h2 className="text-2xl font-black text-slate-950">
                  Add pickup schedule
                </h2>
                <form onSubmit={createSchedule} className="mt-7 space-y-5">
                  <select
                    required
                    value={scheduleForm.zoneId}
                    onChange={(event) =>
                      setScheduleForm({
                        ...scheduleForm,
                        zoneId: event.target.value,
                      })
                    }
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  >
                    <option value="">Select zone</option>
                    {zones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name}
                      </option>
                    ))}
                  </select>
                  <input
                    required
                    value={scheduleForm.name}
                    onChange={(event) =>
                      setScheduleForm({
                        ...scheduleForm,
                        name: event.target.value,
                      })
                    }
                    placeholder="Schedule name"
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  />
                  <select
                    value={scheduleForm.frequency}
                    onChange={(event) =>
                      setScheduleForm({
                        ...scheduleForm,
                        frequency: event.target.value,
                      })
                    }
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  >
                    {[
                      "daily",
                      "weekly",
                      "biweekly",
                      "monthly",
                      "on_demand",
                    ].map((frequency) => (
                      <option key={frequency} value={frequency}>
                        {formatLabel(frequency)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="time"
                    value={scheduleForm.preferredTime}
                    onChange={(event) =>
                      setScheduleForm({
                        ...scheduleForm,
                        preferredTime: event.target.value,
                      })
                    }
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  />
                  <button
                    disabled={saving}
                    className="w-full bg-emerald-700 px-5 py-4 text-sm font-black text-white hover:bg-emerald-800 disabled:opacity-60"
                  >
                    {saving ? "Saving..." : "Create schedule"}
                  </button>
                </form>
              </>
            )}
            {activeTab === "jobs" && (
              <>
                <h2 className="text-2xl font-black text-slate-950">
                  Add collection job
                </h2>
                <form onSubmit={createJob} className="mt-7 space-y-5">
                  <select
                    required
                    value={jobForm.zoneId}
                    onChange={(event) =>
                      setJobForm({ ...jobForm, zoneId: event.target.value })
                    }
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  >
                    <option value="">Select zone</option>
                    {zones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={jobForm.scheduleId}
                    onChange={(event) =>
                      setJobForm({ ...jobForm, scheduleId: event.target.value })
                    }
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  >
                    <option value="">No schedule</option>
                    {schedules.map((schedule) => (
                      <option key={schedule.id} value={schedule.id}>
                        {schedule.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={jobForm.truckId}
                    onChange={(event) =>
                      setJobForm({ ...jobForm, truckId: event.target.value })
                    }
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  >
                    <option value="">No truck assigned</option>
                    {trucks.map((truck) => (
                      <option key={truck.id} value={truck.id}>
                        {truck.plate_number}
                      </option>
                    ))}
                  </select>
                  <select
                    value={jobForm.driverId}
                    onChange={(event) =>
                      setJobForm({ ...jobForm, driverId: event.target.value })
                    }
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  >
                    <option value="">No driver assigned</option>
                    {drivers.map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {driver.full_name}
                      </option>
                    ))}
                  </select>
                  <input
                    required
                    type="date"
                    value={jobForm.jobDate}
                    onChange={(event) =>
                      setJobForm({ ...jobForm, jobDate: event.target.value })
                    }
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  />
                  <select
                    value={jobForm.wasteType}
                    onChange={(event) =>
                      setJobForm({ ...jobForm, wasteType: event.target.value })
                    }
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  >
                    {[
                      "mixed",
                      "organic",
                      "plastic",
                      "metal",
                      "paper",
                      "glass",
                      "hazardous",
                      "medical",
                      "construction",
                    ].map((type) => (
                      <option key={type} value={type}>
                        {formatLabel(type)}
                      </option>
                    ))}
                  </select>
                  <input
                    value={jobForm.estimatedWeightKg}
                    onChange={(event) =>
                      setJobForm({
                        ...jobForm,
                        estimatedWeightKg: event.target.value,
                      })
                    }
                    placeholder="Estimated weight kg"
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  />
                  <textarea
                    value={jobForm.notes}
                    onChange={(event) =>
                      setJobForm({ ...jobForm, notes: event.target.value })
                    }
                    placeholder="Operational notes"
                    className="min-h-24 w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  />
                  <button
                    disabled={saving}
                    className="w-full bg-emerald-700 px-5 py-4 text-sm font-black text-white hover:bg-emerald-800 disabled:opacity-60"
                  >
                    {saving ? "Saving..." : "Create job"}
                  </button>
                </form>
              </>
            )}
            {activeTab === "routes" && (
              <>
                <h2 className="text-2xl font-black text-slate-950">
                  Create collection route
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Choose the working date and crew first. Only open jobs that
                  can safely use that driver and vehicle will appear.
                </p>

                <form onSubmit={createRoute} className="mt-7 space-y-5">
                  <label className="block text-xs font-semibold text-slate-700">
                    Route name
                    <input
                      required
                      value={routeForm.name}
                      onChange={(event) =>
                        setRouteForm({
                          ...routeForm,
                          name: event.target.value,
                        })
                      }
                      placeholder="For example, Nakawa morning round"
                      className="mt-2 w-full border border-slate-300 px-4 py-3 text-sm font-normal outline-none focus:border-[#3156a3]"
                    />
                  </label>

                  <label className="block text-xs font-semibold text-slate-700">
                    Working date
                    <input
                      required
                      type="date"
                      value={routeForm.routeDate}
                      onChange={(event) =>
                        setRouteForm({
                          ...routeForm,
                          routeDate: event.target.value,
                          jobIds: [],
                        })
                      }
                      className="mt-2 w-full border border-slate-300 px-4 py-3 text-sm font-normal outline-none focus:border-[#3156a3]"
                    />
                  </label>

                  <select
                    required
                    value={routeForm.truckId}
                    onChange={(event) =>
                      setRouteForm({
                        ...routeForm,
                        truckId: event.target.value,
                        jobIds: [],
                      })
                    }
                    aria-label="Route vehicle"
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#3156a3]"
                  >
                    <option value="">Choose vehicle</option>

                    {trucks
                      .filter((truck) =>
                        ["available", "assigned"].includes(truck.status)
                      )
                      .map((truck) => (
                        <option key={truck.id} value={truck.id}>
                          {truck.plate_number} · {formatLabel(truck.status)}
                        </option>
                      ))}
                  </select>

                  <select
                    required
                    value={routeForm.driverId}
                    onChange={(event) =>
                      setRouteForm({
                        ...routeForm,
                        driverId: event.target.value,
                        jobIds: [],
                      })
                    }
                    aria-label="Route driver"
                    className="w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-[#3156a3]"
                  >
                    <option value="">Choose driver</option>

                    {drivers
                      .filter((driver) =>
                        ["available", "assigned"].includes(driver.status)
                      )
                      .map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          {driver.full_name} · {formatLabel(driver.status)}
                        </option>
                      ))}
                  </select>

                  <div>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-sm font-black text-slate-950">
                        Select jobs
                      </p>
                      <p className="text-xs text-slate-500">
                        {routeForm.jobIds.length} selected
                      </p>
                    </div>

                    <div className="max-h-64 space-y-2 overflow-y-auto border border-slate-200 p-3">
                      {eligibleRouteJobs.map((job) => (
                          <label
                            key={job.id}
                            className="flex cursor-pointer items-start gap-3 border-b border-slate-100 py-2 last:border-0"
                          >
                            <input
                              type="checkbox"
                              checked={routeForm.jobIds.includes(job.id)}
                              onChange={() => toggleRouteJob(job.id)}
                              className="mt-1"
                            />

                            <span>
                              <span className="block text-sm font-black text-slate-900">
                                {job.zone_name || "Unknown zone"}
                              </span>

                              <span className="block text-xs text-slate-500">
                                {formatJobDate(job.job_date)} ·{" "}
                                {formatLabel(job.status)}
                              </span>
                            </span>
                          </label>
                      ))}

                      {!routeForm.routeDate ||
                      !routeForm.truckId ||
                      !routeForm.driverId ? (
                        <p className="text-sm leading-6 text-slate-500">
                          Choose a date, vehicle and driver to see compatible
                          jobs.
                        </p>
                      ) : !eligibleRouteJobs.length ? (
                        <p className="text-sm text-slate-500">
                          No open, unrouted jobs match this date and crew.
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <textarea
                    value={routeForm.notes}
                    onChange={(event) =>
                      setRouteForm({
                        ...routeForm,
                        notes: event.target.value,
                      })
                    }
                    placeholder="Route notes"
                    className="min-h-24 w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
                  />

                  <button
                    disabled={
                      saving ||
                      !routeForm.truckId ||
                      !routeForm.driverId ||
                      routeForm.jobIds.length === 0
                    }
                    className="w-full bg-[#3156a3] px-5 py-4 text-sm font-black text-white hover:bg-[#274887] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Create route"}
                  </button>
                </form>
              </>
            )}
            </div>
          </aside>
          </div>}
        </section>
      </div>
        {routeDetails && (
          <div role="dialog" aria-modal="true" aria-labelledby="route-details-title" className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
            <section className="h-full w-full max-w-3xl overflow-y-auto bg-white shadow-xl">
              <header className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-slate-200 bg-white px-6 py-5">
                <div><p className="text-xs font-semibold uppercase tracking-wider text-[#3156a3]">Route record</p><h2 id="route-details-title" className="mt-1 text-2xl font-semibold text-slate-950">{routeDetails.name}</h2><p className="mt-1 text-sm text-slate-500">{formatJobDate(routeDetails.route_date)} · {routeDetails.driver_name} · {routeDetails.plate_number}</p></div>
                <button type="button" onClick={()=>setRouteDetails(null)} className="border border-slate-300 px-3 py-2 text-sm font-semibold">Close</button>
              </header>
              <div className="space-y-8 p-6">
                <section><h3 className="text-base font-semibold">Operational status</h3><div className="mt-3 grid border-y border-slate-200 sm:grid-cols-3"><div className="py-4 sm:border-r"><p className="text-xs text-slate-500">Status</p><p className="mt-1 text-sm font-semibold">{formatLabel(routeDetails.status)}</p></div><div className="py-4 sm:px-4 sm:border-r"><p className="text-xs text-slate-500">Started</p><p className="mt-1 text-sm">{routeDetails.started_at ? new Date(routeDetails.started_at).toLocaleString("en-GB") : "Not started"}</p></div><div className="py-4 sm:pl-4"><p className="text-xs text-slate-500">Closed</p><p className="mt-1 text-sm">{routeDetails.completed_at ? new Date(routeDetails.completed_at).toLocaleString("en-GB") : routeDetails.cancelled_at ? new Date(routeDetails.cancelled_at).toLocaleString("en-GB") : "Open"}</p></div></div>{routeDetails.cancellation_reason&&<div className="mt-4 border-l-2 border-red-600 pl-4"><p className="text-sm font-semibold text-red-800">Cancelled · {formatLabel(routeDetails.cancellation_reason)}</p><p className="mt-1 text-sm text-slate-600">{routeDetails.cancellation_notes}</p></div>}</section>
                <section><h3 className="text-base font-semibold">Jobs and service outcomes</h3><div className="mt-3 overflow-x-auto border-y border-slate-200"><table className="min-w-[680px] text-left text-sm"><thead><tr><th>Order / zone</th><th>Area outcome</th><th>Customer services</th><th>Proof</th></tr></thead><tbody>{routeDetails.stops.map(stop=><tr key={stop.id}><td><p className="table-primary">{stop.stop_order}. {stop.zone_name||"Unknown zone"}</p></td><td>{formatLabel(stop.status)}{stop.collected_weight_kg&&<p className="table-secondary">{stop.collected_weight_kg} kg</p>}</td><td>{stop.customer_stops.length ? `${stop.customer_stops.filter(item=>["completed","skipped","cancelled"].includes(item.status)).length} of ${stop.customer_stops.length} resolved` : "No household stops"}</td><td>{stop.evidence_url?<a href={stop.evidence_url} target="_blank" rel="noreferrer" className="text-[#3156a3] underline">Open evidence</a>:stop.completion_notes||"No proof recorded"}</td></tr>)}</tbody></table></div></section>
                <section><h3 className="text-base font-semibold">Status history</h3>{routeDetails.history.length?<div className="mt-3 divide-y border-y border-slate-200">{routeDetails.history.map(item=><div key={item.id} className="grid gap-1 py-4 text-sm sm:grid-cols-[180px_1fr]"><p className="text-slate-500">{new Date(item.created_at).toLocaleString("en-GB")}</p><div><p className="font-semibold">{formatLabel(item.previous_status)} → {formatLabel(item.new_status)}</p><p className="mt-1 text-slate-600">{item.reason?`${formatLabel(item.reason)} · `:""}{item.notes||"No note"}</p><p className="mt-1 text-xs text-slate-500">By {item.changed_by_name||"System"}</p></div></div>)}</div>:<p className="mt-3 text-sm text-slate-500">No recorded status changes yet.</p>}</section>
              </div>
            </section>
          </div>
        )}
        {routeToCancel && (
          <div role="dialog" aria-modal="true" aria-labelledby="cancel-route-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
            <form onSubmit={cancelRoute} className="w-full max-w-lg border border-slate-300 bg-white shadow-xl">
              <div className="border-b border-slate-200 px-6 py-5">
                <h2 id="cancel-route-title" className="text-xl font-semibold text-slate-950">Cancel {routeToCancel.name}?</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">Completed work stays in history. Unfinished jobs return to dispatch without their previous crew assignment.</p>
              </div>
              <div className="space-y-5 px-6 py-5">
                <label className="block text-sm font-semibold text-slate-800">Reason
                  <select value={routeCancellation.reason} onChange={(event)=>setRouteCancellation({...routeCancellation,reason:event.target.value})} className="mt-2 w-full border border-slate-300 px-3 py-3 text-sm font-normal">
                    <option value="operational_delay">Operational delay</option><option value="vehicle_breakdown">Vehicle breakdown</option><option value="driver_unavailable">Driver unavailable</option><option value="safety_issue">Safety issue</option><option value="weather">Weather</option><option value="service_change">Service change</option><option value="other">Other</option>
                  </select>
                </label>
                <label className="block text-sm font-semibold text-slate-800">Cancellation note
                  <textarea required minLength={3} value={routeCancellation.notes} onChange={(event)=>setRouteCancellation({...routeCancellation,notes:event.target.value})} rows={4} placeholder="Explain what happened and what dispatch should do next" className="mt-2 w-full resize-none border border-slate-300 px-3 py-3 text-sm font-normal" />
                </label>
              </div>
              <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
                <button type="button" disabled={saving} onClick={()=>setRouteToCancel(null)} className="border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Keep route</button>
                <button disabled={saving || routeCancellation.notes.trim().length < 3} className="bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Cancelling…" : "Cancel route"}</button>
              </div>
            </form>
          </div>
        )}
    </AppShell>
  );
}
