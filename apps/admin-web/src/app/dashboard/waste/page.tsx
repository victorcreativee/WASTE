"use client";

import { useEffect, useState } from "react";
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

type ApiListResponse<T> = {
  success: boolean;
  message: string;
  data: T[];
};

export default function WasteOperationsPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [activeTab, setActiveTab] = useState<"zones" | "trucks" | "drivers">(
    "zones"
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

  async function loadWasteData() {
    try {
      setLoading(true);
      setError("");

      const [zonesResponse, trucksResponse, driversResponse] =
        await Promise.all([
          apiRequest<ApiListResponse<Zone>>("/api/waste/zones"),
          apiRequest<ApiListResponse<Truck>>("/api/waste/trucks"),
          apiRequest<ApiListResponse<Driver>>("/api/waste/drivers"),
        ]);

      setZones(zonesResponse.data);
      setTrucks(trucksResponse.data);
      setDrivers(driversResponse.data);
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

      if (zoneForm.description.trim()) {
        payload.description = zoneForm.description.trim();
      }

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

      setTruckForm({
        plateNumber: "",
        truckName: "",
        capacityTons: "",
      });

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

      setDriverForm({
        fullName: "",
        phone: "",
        licenseNumber: "",
      });

      await loadWasteData();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to create driver"
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
            Start with the basic operational records: zones, trucks, and
            drivers. These will later support schedules, collection jobs, GIS
            tracking, and mobile driver workflows.
          </p>
        </section>

        {error && (
          <div className="mt-6 border-l-4 border-red-600 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <section className="grid gap-10 py-8 xl:grid-cols-[1.2fr_0.8fr]">
          <div>
            <div className="flex gap-6 border-b border-slate-200">
              {[
                ["zones", `Zones (${zones.length})`],
                ["trucks", `Trucks (${trucks.length})`],
                ["drivers", `Drivers (${drivers.length})`],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() =>
                    setActiveTab(key as "zones" | "trucks" | "drivers")
                  }
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

            <div className="divide-y divide-slate-200">
              {loading ? (
                <p className="py-8 text-sm text-slate-500">
                  Loading waste operations...
                </p>
              ) : activeTab === "zones" ? (
                zones.length ? (
                  zones.map((zone) => (
                    <div key={zone.id} className="py-5">
                      <div className="flex items-start justify-between gap-5">
                        <div>
                          <p className="text-lg font-black text-slate-950">
                            {zone.name}
                          </p>
                          <p className="mt-1 text-sm leading-6 text-slate-500">
                            {zone.description || "No description added"}
                          </p>
                          <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                            {zone.area_type.replaceAll("_", " ")}
                          </p>
                        </div>
                        <p className="text-sm font-black text-emerald-700">
                          {zone.is_active ? "Active" : "Inactive"}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="py-8 text-sm text-slate-500">
                    No waste zones added yet.
                  </p>
                )
              ) : activeTab === "trucks" ? (
                trucks.length ? (
                  trucks.map((truck) => (
                    <div key={truck.id} className="py-5">
                      <div className="flex items-start justify-between gap-5">
                        <div>
                          <p className="text-lg font-black text-slate-950">
                            {truck.plate_number}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            {truck.truck_name || "Unnamed truck"}
                          </p>
                          <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                            Capacity: {truck.capacity_tons || "not set"} tons
                          </p>
                        </div>
                        <p className="text-sm font-black text-emerald-700">
                          {truck.status}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="py-8 text-sm text-slate-500">
                    No trucks added yet.
                  </p>
                )
              ) : drivers.length ? (
                drivers.map((driver) => (
                  <div key={driver.id} className="py-5">
                    <div className="flex items-start justify-between gap-5">
                      <div>
                        <p className="text-lg font-black text-slate-950">
                          {driver.full_name}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          {driver.phone || "No phone number"}
                        </p>
                        <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                          License: {driver.license_number || "not set"}
                        </p>
                      </div>
                      <p className="text-sm font-black text-emerald-700">
                        {driver.status}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="py-8 text-sm text-slate-500">
                  No drivers added yet.
                </p>
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
                        {type.replaceAll("_", " ")}
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
          </aside>
        </section>
      </div>
    </AppShell>
  );
}
