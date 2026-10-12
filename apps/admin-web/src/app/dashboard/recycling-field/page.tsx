"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState, Feedback } from "@/components/ui/System";
import { apiRequest } from "@/lib/api";

type Material = { id: string; name: string; active: boolean };
type Partner = {
  id: string;
  name: string;
  partner_type: string;
  active: boolean;
};
type Lot = {
  id: string;
  material_type: string;
  source_name: string;
  quantity_kg: string;
  unit_purchase_price_ugx: string;
  collected_on: string;
  quality: string;
  collection_latitude: string | null;
  collection_longitude: string | null;
  recorded_by_name: string | null;
};
type Workspace = {
  organization: { name: string; type: string };
  operations: {
    operatingDate: string;
    isClosed: boolean;
    receivedTodayKg: number;
  };
  materials: Material[];
  partners: Partner[];
  lots: Lot[];
  myActivity?: {
    purchases?: number;
    purchasedKg?: number;
    sales: number;
    soldKg: number;
  };
};
type Location = { latitude: number; longitude: number; accuracy: number };
const field =
  "mt-1.5 min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base outline-none focus:border-[#3156a3] focus:ring-2 focus:ring-blue-100";
const today = () => new Date().toISOString().slice(0, 10);

export default function RecyclingFieldPage() {
  const [data, setData] = useState<Workspace | null>(null),
    [view, setView] = useState<"today" | "buy" | "history">("today"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [saving, setSaving] = useState(false),
    [location, setLocation] = useState<Location | null>(null),
    [locating, setLocating] = useState(false),
    [quantity, setQuantity] = useState(0),
    [unitPrice, setUnitPrice] = useState(0);
  async function load() {
    try {
      setError("");
      setData(
        (await apiRequest<{ data: Workspace }>("/api/waste/recycling")).data,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load field workspace",
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const ownToday = useMemo(
    () =>
      data?.lots.filter(
        (x) =>
          String(x.collected_on).slice(0, 10) === data.operations.operatingDate,
      ) ?? [],
    [data],
  );
  function captureLocation() {
    if (!navigator.geolocation) {
      setError("GPS is not available on this device.");
      return;
    }
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocation({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: p.coords.accuracy,
        });
        setLocating(false);
      },
      () => {
        setError(
          "Location permission was not available. You may continue without GPS.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const el = e.currentTarget,
      f = new FormData(el),
      customMaterial = String(f.get("customMaterialType") || "").trim(),
      materialType =
        customMaterial || String(f.get("materialType") || "").trim();
    if (!materialType) {
      setError(
        "Choose a material from the list or enter another material name.",
      );
      return;
    }
    try {
      setSaving(true);
      setError("");
      await apiRequest("/api/waste/recycling/lots", {
        method: "POST",
        body: JSON.stringify({
          materialType,
          allowNewMaterial: Boolean(customMaterial),
          supplierPartnerId: f.get("supplierPartnerId") || undefined,
          sourceName: f.get("sourceName"),
          quantityKg: Number(f.get("quantityKg")),
          unitPurchasePriceUgx: Number(f.get("unitPurchasePriceUgx")),
          collectedOn: f.get("collectedOn"),
          quality: f.get("quality"),
          purchasePaymentStatus: f.get("purchasePaymentStatus"),
          purchasePaymentReference:
            f.get("purchasePaymentReference") || undefined,
          workerWagesUgx: 0,
          foodUgx: 0,
          transportUgx: Number(f.get("transportUgx") || 0),
          driverFeeUgx: 0,
          otherExpenseUgx: 0,
          managerFloatUsedUgx: Number(f.get("managerFloatUsedUgx") || 0),
          collectionLatitude: location?.latitude,
          collectionLongitude: location?.longitude,
          collectionAccuracyM: location?.accuracy,
          notes: f.get("notes") || undefined,
        }),
      });
      el.reset();
      setQuantity(0);
      setUnitPrice(0);
      setLocation(null);
      setNotice("Purchase saved and stock updated for the company.");
      setView("today");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save purchase");
    } finally {
      setSaving(false);
    }
  }
  return (
    <AppShell>
      <main className="mx-auto max-w-xl pb-24">
        <header className="border-b border-slate-300 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.18em] text-[#3156a3]">
                Field collection
              </p>
              <h1 className="mt-2 text-3xl font-semibold">
                Buy recovered material
              </h1>
            </div>
            <Link
              href="/dashboard/recycling"
              className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#3156a3]"
            >
              Full web
            </Link>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Record each purchase at the collection point. Stock and company
            accounts update immediately.
          </p>
        </header>
        {error && <Feedback tone="error">{error}</Feedback>}
        {notice && <Feedback tone="success">{notice}</Feedback>}
        {data?.operations.isClosed && (
          <Feedback tone="warning">
            Today is closed by management. You can review activity, but cannot
            record another purchase until the day is reopened.
          </Feedback>
        )}
        <nav className="sticky top-[61px] z-10 mt-4 grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {[
            ["today", "Today"],
            ["buy", "+ New purchase"],
            ["history", "History"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => {
                setView(id as typeof view);
                setError("");
                setNotice("");
              }}
              className={`min-h-11 rounded-lg px-2 text-sm font-semibold ${view === id ? "bg-[#3156a3] text-white" : "text-slate-600"}`}
            >
              {label}
            </button>
          ))}
        </nav>
        {view === "today" && (
          <section className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-[#151b2b] p-4 text-white">
                <p className="text-xs text-slate-300">Purchases today</p>
                <p className="mt-2 text-3xl font-semibold">
                  {data?.myActivity?.purchases ?? ownToday.length}
                </p>
              </div>
              <div className="rounded-xl bg-[#3156a3] p-4 text-white">
                <p className="text-xs text-blue-100">Kilograms bought</p>
                <p className="mt-2 text-3xl font-semibold">
                  {Number(
                    data?.myActivity?.purchasedKg ??
                      data?.operations.receivedTodayKg ??
                      0,
                  ).toLocaleString()}
                </p>
              </div>
            </div>
            <button
              disabled={data?.operations.isClosed}
              onClick={() => setView("buy")}
              className="min-h-14 w-full rounded-xl bg-[#3156a3] px-5 text-base font-semibold text-white shadow-sm disabled:bg-slate-300"
            >
              + Record material purchase
            </button>
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b p-4">
                <h2 className="font-semibold">Latest activity</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Purchases recorded today
                </p>
              </div>
              {ownToday.slice(0, 5).map((x) => (
                <div
                  key={x.id}
                  className="flex items-center justify-between border-b p-4 last:border-0"
                >
                  <div>
                    <p className="font-semibold">{x.material_type}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {x.source_name} · {x.quality}
                    </p>
                  </div>
                  <p className="font-semibold">
                    {Number(x.quantity_kg).toLocaleString()} kg
                  </p>
                </div>
              ))}
              {!ownToday.length && (
                <EmptyState
                  title="No purchases today"
                  description="Use New purchase when you buy the first material."
                />
              )}
            </div>
          </section>
        )}
        {view === "buy" && (
          <form
            onSubmit={submit}
            className="mt-5 space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div>
              <h2 className="text-xl font-semibold">New purchase</h2>
              <p className="mt-1 text-sm text-slate-500">
                Enter the weight and agreed buying price.
              </p>
            </div>
            <label className="block text-sm font-semibold">
              Material
              <select
                name="materialType"
                defaultValue=""
                className={field}
              >
                <option value="">
                  Choose material
                </option>
                {data?.materials
                  .filter((x) => x.active)
                  .map((x) => (
                    <option key={x.id}>{x.name}</option>
                  ))}
              </select>
            </label>
            <label className="block text-sm font-semibold">
              Material not listed?
              <input
                minLength={2}
                maxLength={80}
                name="customMaterialType"
                placeholder="Enter another material name"
                className={field}
              />
              <span className="mt-1 block text-xs font-normal text-slate-500">
                The new name will be available next time.
              </span>
            </label>
            <label className="block text-sm font-semibold">
              Saved supplier
              <select
                name="supplierPartnerId"
                defaultValue=""
                className={field}
              >
                <option value="">Not a saved supplier</option>
                {data?.partners
                  .filter(
                    (x) =>
                      x.active && ["supplier", "both"].includes(x.partner_type),
                  )
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-sm font-semibold">
              Supplier or collection point
              <input
                required
                minLength={2}
                maxLength={160}
                name="sourceName"
                placeholder="Name or location"
                className={field}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-semibold">
                Weight (kg)
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  name="quantityKg"
                  inputMode="decimal"
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className={field}
                />
              </label>
              <label className="block text-sm font-semibold">
                Price per kg
                <input
                  required
                  type="number"
                  min="0"
                  name="unitPurchasePriceUgx"
                  inputMode="numeric"
                  onChange={(e) => setUnitPrice(Number(e.target.value))}
                  className={field}
                />
              </label>
            </div>
            <div className="rounded-lg bg-blue-50 p-3">
              <p className="text-xs text-slate-500">Material amount</p>
              <p className="mt-1 text-xl font-semibold text-[#3156a3]">
                UGX {(quantity * unitPrice).toLocaleString()}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-semibold">
                Quality
                <select name="quality" defaultValue="mixed" className={field}>
                  <option value="mixed">Mixed</option>
                  <option value="clean">Clean</option>
                  <option value="sorted">Sorted</option>
                  <option value="contaminated">Contaminated</option>
                </select>
              </label>
              <label className="block text-sm font-semibold">
                Payment
                <select
                  name="purchasePaymentStatus"
                  defaultValue="paid"
                  className={field}
                >
                  <option value="paid">Paid now</option>
                  <option value="credit">Bought on credit</option>
                </select>
              </label>
            </div>
            <input
              type="hidden"
              name="collectedOn"
              value={data?.operations.operatingDate || today()}
            />
            <label className="block text-sm font-semibold">
              Payment reference (optional)
              <input
                name="purchasePaymentReference"
                placeholder="Cash, mobile money or receipt reference"
                className={field}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-semibold">
                Transport cost
                <input
                  type="number"
                  min="0"
                  name="transportUgx"
                  defaultValue="0"
                  inputMode="numeric"
                  className={field}
                />
              </label>
              <label className="block text-sm font-semibold">
                Paid from float
                <input
                  type="number"
                  min="0"
                  name="managerFloatUsedUgx"
                  defaultValue="0"
                  inputMode="numeric"
                  className={field}
                />
              </label>
            </div>
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Collection location</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {location
                      ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} · ±${Math.round(location.accuracy)} m`
                      : "Optional GPS proof"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={locating}
                  onClick={captureLocation}
                  className="min-h-11 rounded-lg border border-[#3156a3] px-3 text-sm font-semibold text-[#3156a3]"
                >
                  {locating ? "Locating…" : location ? "Refresh" : "Use GPS"}
                </button>
              </div>
            </div>
            <label className="block text-sm font-semibold">
              Note (optional)
              <textarea
                name="notes"
                rows={3}
                maxLength={500}
                className={`${field} py-3`}
              />
            </label>
            <button
              disabled={saving || data?.operations.isClosed}
              className="min-h-14 w-full rounded-xl bg-[#3156a3] px-5 text-base font-semibold text-white disabled:bg-slate-300"
            >
              {saving ? "Saving purchase…" : "Save purchase"}
            </button>
          </form>
        )}
        {view === "history" && (
          <section className="mt-5 rounded-xl border border-slate-200 bg-white">
            <div className="border-b p-4">
              <h2 className="font-semibold">Purchase history</h2>
              <p className="mt-1 text-xs text-slate-500">
                Most recent company purchase records
              </p>
            </div>
            {data?.lots
              .filter((x) => x.recorded_by_name)
              .slice(0, 30)
              .map((x) => (
                <div key={x.id} className="border-b p-4 last:border-0">
                  <div className="flex justify-between gap-4">
                    <div>
                      <p className="font-semibold">{x.material_type}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {new Date(x.collected_on).toLocaleDateString("en-GB")} ·{" "}
                        {x.source_name}
                      </p>
                    </div>
                    <p className="font-semibold">
                      {Number(x.quantity_kg).toLocaleString()} kg
                    </p>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    UGX {Number(x.unit_purchase_price_ugx).toLocaleString()}/kg
                    {x.collection_latitude ? " · GPS recorded" : ""}
                  </p>
                </div>
              ))}
            {!data?.lots.length && (
              <EmptyState
                title="No purchase history"
                description="Recorded purchases will appear here."
              />
            )}
          </section>
        )}
      </main>
    </AppShell>
  );
}
