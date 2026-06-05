"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiRequest } from "@/lib/api";

type Zone = {
  id: string;
  name: string;
  description: string | null;
  area_type: string;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
};

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
};

type ApiListResponse<T> = {
  success: boolean;
  message: string;
  data: T[];
};

type ActiveTab = "zones" | "trucks" | "drivers" | "schedules" | "jobs";
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
  if (status === "completed")
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "in_progress")
    return "bg-blue-50 text-blue-700 border-blue-200";
  if (status === "cancelled") return "bg-red-50 text-red-700 border-red-200";
  if (status === "missed")
    return "bg-orange-50 text-orange-700 border-orange-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default function WasteOperationsPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [schedules, setSchedules] = useState<PickupSchedule[]>([]);
  const [jobs, setJobs] = useState<CollectionJob[]>([]);

  const [activeTab, setActiveTab] = useState<ActiveTab>("zones");
  const [jobFilter, setJobFilter] = useState<JobFilter>("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [assigningJobId, setAssigningJobId] = useState<string | null>(null);

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
      ]);

      setZones(zonesResponse.data);
      setTrucks(trucksResponse.data);
      setDrivers(driversResponse.data);
      setSchedules(schedulesResponse.data);
      setJobs(jobsResponse.data);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to load waste data"
      );
    } finally {
      setLoading(false);
    }
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

      await apiRequest(`/api/waste/collection-jobs/${jobId}/assign`, {
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

      await apiRequest(
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
  useEffect(() => {
    loadWasteData();
  }, []);

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl">
        <section className="border-b border-slate-200 pb-7">
          <p className="text-sm font-black uppercase tracking-[0.25em] text-emerald-700">
            Field Operations
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950">
            Waste Operations
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
            Manage the operational flow from zones, trucks, and drivers to
            pickup schedules and daily collection jobs.
          </p>
        </section>

        {error && (
          <div className="mt-6 border-l-4 border-red-600 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <section className="grid gap-10 py-8 xl:grid-cols-[1.35fr_0.65fr]">
          <div>
            <div className="flex flex-wrap gap-6 border-b border-slate-200">
              {[
                ["zones", `Zones (${zones.length})`],
                ["trucks", `Trucks (${trucks.length})`],
                ["drivers", `Drivers (${drivers.length})`],
                ["schedules", `Schedules (${schedules.length})`],
                ["jobs", `Jobs (${jobs.length})`],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key as ActiveTab)}
                  className={[
                    "border-b-4 pb-4 text-sm font-black transition",
                    activeTab === key
                      ? "border-emerald-700 text-emerald-800"
                      : "border-transparent text-slate-500 hover:text-slate-900",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeTab === "jobs" && (
              <div className="mt-6 flex flex-wrap gap-3">
                {[
                  ["all", "All"],
                  ["pending", "Pending"],
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
                        ? "border-emerald-700 bg-emerald-700 text-white"
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
              ) : activeTab === "zones" ? (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Zone</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Coordinates</th>
                      <th className="px-4 py-3">Status</th>
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
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-slate-500">
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
                              Generate jobs
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-slate-500">
                          No pickup schedules created yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
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

          <aside className="border-l border-slate-200 pl-8">
            {activeTab === "zones" && (
              <>
                <h2 className="text-2xl font-black text-slate-950">
                  Add collection zone
                </h2>
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
          </aside>
        </section>
      </div>
    </AppShell>
  );
}
