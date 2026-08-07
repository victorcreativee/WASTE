"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiRequest } from "@/lib/api";

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

type ApiListResponse<T> = {
  success: boolean;
  message: string;
  data: T[];
};

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

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

export default function DriverMobilePage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [jobs, setJobs] = useState<DriverJob[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [collectedWeights, setCollectedWeights] = useState<
    Record<string, string>
  >({});

  const [loadingDrivers, setLoadingDrivers] = useState(true);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedDriver = useMemo(() => {
    return drivers.find((driver) => driver.id === selectedDriverId);
  }, [drivers, selectedDriverId]);

  async function loadDrivers() {
    try {
      setLoadingDrivers(true);
      setError("");

      const response = await apiRequest<ApiListResponse<Driver>>(
        "/api/waste/drivers"
      );

      setDrivers(response.data);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to load drivers"
      );
    } finally {
      setLoadingDrivers(false);
    }
  }

  async function loadDriverJobs(driverId: string) {
    if (!driverId) {
      setJobs([]);
      return;
    }

    try {
      setLoadingJobs(true);
      setError("");

      const response = await apiRequest<ApiListResponse<DriverJob>>(
        `/api/waste/drivers/${driverId}/jobs`
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

  useEffect(() => {
    loadDrivers();
  }, []);

  useEffect(() => {
    loadDriverJobs(selectedDriverId);
  }, [selectedDriverId]);

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl">
        <section className="border-b border-slate-200 pb-7">
          <p className="text-sm font-black uppercase tracking-[0.25em] text-emerald-700">
            Driver Workspace
          </p>

          <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950">
            Driver Mobile Workflow
          </h1>

          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
            Prototype driver view for assigned collection jobs. Drivers can see
            their current jobs, start collection, and complete work with
            collected weight.
          </p>
        </section>

        {error && (
          <div className="mt-6 border-l-4 border-red-600 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <section className="mt-8 grid gap-6 lg:grid-cols-[320px_1fr]">
          <aside className="border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-black text-slate-950">Select driver</h2>

            <p className="mt-2 text-sm leading-6 text-slate-500">
              Choose a driver to view assigned and active jobs.
            </p>

            <select
              disabled={loadingDrivers}
              value={selectedDriverId}
              onChange={(event) => setSelectedDriverId(event.target.value)}
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
          </aside>

          <main className="border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-black text-slate-950">
                Current jobs
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Assigned and in-progress collection jobs.
              </p>
            </div>

            {!selectedDriverId ? (
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
        </section>
      </div>
    </AppShell>
  );
}
