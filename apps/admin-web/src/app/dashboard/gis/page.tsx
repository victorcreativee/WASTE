"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiRequest } from "@/lib/api";

const WasteMap = dynamic(() => import("@/components/gis/WasteMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[650px] items-center justify-center bg-slate-50 text-sm text-slate-500">
      Loading city map...
    </div>
  ),
});

type Zone = {
  id: string;
  name: string;
  area_type: string;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
};

type CollectionRoute = {
  id: string;
  name: string;
  route_date: string;
  status: string;
  plate_number: string | null;
  driver_name: string | null;
  job_count: number;
};

type RouteStop = {
  id: string;
  zone_id: string;
  zone_name: string | null;
  latitude: number | null;
  longitude: number | null;
  stop_order: number;
  status: string;
  waste_type: string;
};

type RouteDetails = {
  id: string;
  name: string;
  route_date: string;
  status: string;
  plate_number: string | null;
  driver_name: string | null;
  jobs: RouteStop[];
};

type ApiListResponse<T> = {
  success: boolean;
  message: string;
  data: T[];
};

type ApiItemResponse<T> = {
  success: boolean;
  message: string;
  data: T;
};

function formatDate(value: string) {
  if (!value) return "No date";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default function GISPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [routes, setRoutes] = useState<CollectionRoute[]>([]);

  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [selectedRoute, setSelectedRoute] = useState<RouteDetails | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [error, setError] = useState("");

  const mappedZones = useMemo(
    () =>
      zones.filter((zone) => zone.latitude !== null && zone.longitude !== null),
    [zones]
  );

  const mappedRouteStops = useMemo(
    () =>
      selectedRoute?.jobs.filter(
        (job) => job.latitude !== null && job.longitude !== null
      ) ?? [],
    [selectedRoute]
  );

  async function loadGISData() {
    try {
      setLoading(true);
      setError("");

      const [zonesResponse, routesResponse] = await Promise.all([
        apiRequest<ApiListResponse<Zone>>("/api/waste/zones"),

        apiRequest<ApiListResponse<CollectionRoute>>(
          "/api/waste/collection-routes"
        ),
      ]);

      setZones(zonesResponse.data);
      setRoutes(routesResponse.data);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to load GIS data"
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadRoute(routeId: string) {
    if (!routeId) {
      setSelectedRoute(null);
      return;
    }

    try {
      setLoadingRoute(true);
      setError("");

      const response = await apiRequest<ApiItemResponse<RouteDetails>>(
        `/api/waste/collection-routes/${routeId}`
      );

      setSelectedRoute(response.data);
    } catch (error) {
      setSelectedRoute(null);

      setError(
        error instanceof Error ? error.message : "Failed to load route details"
      );
    } finally {
      setLoadingRoute(false);
    }
  }

  useEffect(() => {
    loadGISData();
  }, []);

  useEffect(() => {
    loadRoute(selectedRouteId);
  }, [selectedRouteId]);

  return (
    <AppShell>
      <div className="mx-auto max-w-[1500px]">
        <section className="border-b border-slate-200 pb-7">
          <p className="text-sm font-black uppercase tracking-[0.25em] text-emerald-700">
            Geographic Operations
          </p>

          <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950">
            GIS Operations Map
          </h1>

          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
            Geographic view of waste collection zones and planned collection
            route stops across Kampala.
          </p>
        </section>

        {error && (
          <div className="mt-6 border-l-4 border-red-600 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <section className="grid gap-6 py-8 xl:grid-cols-[300px_1fr]">
          <aside className="space-y-6">
            <div className="border border-slate-200 bg-white p-5">
              <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                Mapped zones
              </p>

              <p className="mt-2 text-3xl font-black text-slate-950">
                {mappedZones.length}
              </p>

              <p className="mt-2 text-sm text-slate-500">
                {zones.length - mappedZones.length} zones still need
                coordinates.
              </p>
            </div>

            <div className="border border-slate-200 bg-white p-5">
              <label className="text-sm font-black text-slate-950">
                Collection route
              </label>

              <p className="mt-2 text-sm leading-6 text-slate-500">
                Select a route to display its ordered stops.
              </p>

              <select
                disabled={loading}
                value={selectedRouteId}
                onChange={(event) => setSelectedRouteId(event.target.value)}
                className="mt-4 w-full border border-slate-300 px-4 py-3 text-sm outline-none focus:border-emerald-700"
              >
                <option value="">Show zones only</option>

                {routes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.name}
                  </option>
                ))}
              </select>
            </div>

            {loadingRoute && (
              <div className="border border-slate-200 bg-white p-5 text-sm text-slate-500">
                Loading route...
              </div>
            )}

            {selectedRoute && !loadingRoute && (
              <div className="border border-slate-200 bg-white p-5">
                <p className="text-lg font-black text-slate-950">
                  {selectedRoute.name}
                </p>

                <div className="mt-4 space-y-3 text-sm text-slate-600">
                  <p>
                    <span className="font-black text-slate-900">Date:</span>{" "}
                    {formatDate(selectedRoute.route_date)}
                  </p>

                  <p>
                    <span className="font-black text-slate-900">Status:</span>{" "}
                    {formatLabel(selectedRoute.status)}
                  </p>

                  <p>
                    <span className="font-black text-slate-900">Driver:</span>{" "}
                    {selectedRoute.driver_name || "Not assigned"}
                  </p>

                  <p>
                    <span className="font-black text-slate-900">Truck:</span>{" "}
                    {selectedRoute.plate_number || "Not assigned"}
                  </p>

                  <p>
                    <span className="font-black text-slate-900">
                      Mapped stops:
                    </span>{" "}
                    {mappedRouteStops.length}
                  </p>
                </div>
              </div>
            )}

            {selectedRoute && mappedRouteStops.length === 0 && (
              <div className="border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-800">
                This route has no stops with valid latitude and longitude yet.
              </div>
            )}
          </aside>

          <main className="overflow-hidden border border-slate-200 bg-white">
            {loading ? (
              <div className="flex h-[650px] items-center justify-center text-sm text-slate-500">
                Loading GIS workspace...
              </div>
            ) : (
              <WasteMap zones={zones} routeStops={selectedRoute?.jobs ?? []} />
            )}
          </main>
        </section>
      </div>
    </AppShell>
  );
}
