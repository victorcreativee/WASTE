"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { OrganizationWorkspaceNav } from "@/components/layout/OrganizationWorkspaceNav";
import {Feedback,PageHeader} from "@/components/ui/System";
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

type RouteGeometry = {
  type: "LineString";
  coordinates: [number, number][];
};

type RouteDetails = {
  id: string;
  name: string;
  route_date: string;
  status: string;
  plate_number: string | null;
  driver_name: string | null;
  total_distance_km: number | string | null;
  estimated_duration_minutes: number | null;
  route_geometry: RouteGeometry | null;
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
function formatDistance(value: number | string | null) {
  if (value === null) {
    return "Not calculated";
  }

  const distance = Number(value);

  if (!Number.isFinite(distance)) {
    return "Not calculated";
  }

  return `${distance.toFixed(2)} km`;
}

function formatDuration(value: number | null) {
  if (value === null) {
    return "Not calculated";
  }

  if (value < 60) {
    return `${value} min`;
  }

  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  if (minutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${minutes} min`;
}

export default function GISPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [routes, setRoutes] = useState<CollectionRoute[]>([]);

  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [selectedRoute, setSelectedRoute] = useState<RouteDetails | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [generatingRoute, setGeneratingRoute] = useState(false);

  const [error, setError] = useState("");
  const [routeMessage, setRouteMessage] = useState("");

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
  async function generateRoadRoute() {
    if (!selectedRouteId) {
      return;
    }

    try {
      setGeneratingRoute(true);
      setError("");
      setRouteMessage("");

      const response = await apiRequest<ApiItemResponse<RouteDetails>>(
        `/api/waste/collection-routes/${selectedRouteId}/generate-road-route`,
        {
          method: "POST",
        }
      );

      setSelectedRoute(response.data);

      setRouteMessage(
        "Road route generated successfully. Distance and travel time have been updated."
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to generate road route"
      );
    } finally {
      setGeneratingRoute(false);
    }
  }

  useEffect(() => {
    let active = true;

    Promise.all([
      apiRequest<ApiListResponse<Zone>>("/api/waste/zones"),
      apiRequest<ApiListResponse<CollectionRoute>>(
        "/api/waste/collection-routes"
      ),
    ])
      .then(([zonesResponse, routesResponse]) => {
        if (!active) return;

        setZones(zonesResponse.data);
        setRoutes(routesResponse.data);
      })
      .catch((error: unknown) => {
        if (!active) return;

        setError(
          error instanceof Error ? error.message : "Failed to load GIS data"
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <AppShell>
      <div className="mx-auto max-w-[1500px]">
        <OrganizationWorkspaceNav/>
        <PageHeader eyebrow="City coverage" title="Coverage map" description="Inspect collection zones, planned route stops, and geographic service coverage across Kampala."/>

        {error && (
          <Feedback tone="error">{error}</Feedback>
        )}
        {routeMessage && (
          <Feedback tone="success">{routeMessage}</Feedback>
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
                onChange={(event) => {
                  const routeId = event.target.value;
                  setSelectedRouteId(routeId);
                  setRouteMessage("");
                  setError("");
                  void loadRoute(routeId);
                }}
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
                    <span className="font-black text-slate-900">Distance:</span>{" "}
                    {formatDistance(selectedRoute.total_distance_km)}
                  </p>

                  <p>
                    <span className="font-black text-slate-900">
                      Est. travel time:
                    </span>{" "}
                    {formatDuration(selectedRoute.estimated_duration_minutes)}
                  </p>

                  <p>
                    <span className="font-black text-slate-900">
                      Mapped stops:
                    </span>{" "}
                    {mappedRouteStops.length}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={generateRoadRoute}
                  disabled={generatingRoute || mappedRouteStops.length < 2}
                  className="mt-5 w-full bg-emerald-700 px-4 py-3 text-sm font-black text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {generatingRoute
                    ? "Generating road route..."
                    : selectedRoute.route_geometry
                    ? "Recalculate road route"
                    : "Generate road route"}
                </button>
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
              <WasteMap
                zones={zones}
                routeStops={selectedRoute?.jobs ?? []}
                routeGeometry={selectedRoute?.route_geometry ?? null}
              />
            )}
          </main>
        </section>
      </div>
    </AppShell>
  );
}
