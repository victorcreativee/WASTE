"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { OrganizationWorkspaceNav } from "@/components/layout/OrganizationWorkspaceNav";
import {
  EmptyState,
  Feedback,
  PageHeader,
  Status,
} from "@/components/ui/System";
import { apiRequest } from "@/lib/api";
type Item = {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  quantity: string;
  reorder_level: string;
  unit_cost_ugx: string;
  storage_location: string | null;
  low_stock: boolean;
  stock_value_ugx: string;
};
type Movement = {
  id: string;
  item_name: string;
  movement_type: string;
  quantity: string;
  reason: string;
  reference: string | null;
  recorded_by_name: string | null;
  created_at: string;
};
type PR = {
  id: string;
  request_number: string;
  item_name: string;
  category: string;
  quantity: string;
  unit: string;
  estimated_cost_ugx: string;
  justification: string;
  status: string;
  requested_by_name: string | null;
  created_at: string;
};
type Data = { items: Item[]; movements: Movement[]; requests: PR[] };
const money = (v: string | number) =>
  `UGX ${new Intl.NumberFormat("en-UG", { maximumFractionDigits: 0 }).format(Number(v || 0))}`;
const label = (v: string) => v.replaceAll("_", " ");
export default function InventoryPage() {
  const [data, setData] = useState<Data>({
      items: [],
      movements: [],
      requests: [],
    }),
    [tab, setTab] = useState<"stock" | "movements" | "requests">("stock"),
    [form, setForm] = useState<"none" | "item" | "movement" | "request">(
      "none",
    ),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [saving, setSaving] = useState(false),
    [query, setQuery] = useState("");
  const load = useCallback(async () => {
    const r = await apiRequest<{ data: Data }>("/api/waste/inventory");
    setData(r.data);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : "Failed to load inventory"),
    );
  }, [load]);
  const items = useMemo(
    () =>
      data.items.filter((i) =>
        `${i.sku} ${i.name} ${i.category}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [data.items, query],
  );
  const value = data.items.reduce((n, i) => n + Number(i.stock_value_ugx), 0),
    low = data.items.filter((i) => i.low_stock).length;
  async function act(path: string, method: string, body: unknown, msg: string) {
    try {
      setSaving(true);
      setError("");
      await apiRequest(path, { method, body: JSON.stringify(body) });
      setMessage(msg);
      setForm("none");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setSaving(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (form === "item")
      await act(
        "/api/waste/inventory/items",
        "POST",
        {
          sku: f.get("sku"),
          name: f.get("name"),
          category: f.get("category"),
          unit: f.get("unit"),
          reorderLevel: Number(f.get("reorderLevel")),
          unitCostUgx: Number(f.get("unitCostUgx")),
          storageLocation: f.get("storageLocation") || undefined,
        },
        "Inventory item created.",
      );
    if (form === "movement")
      await act(
        `/api/waste/inventory/items/${f.get("itemId")}/movements`,
        "POST",
        {
          movementType: f.get("movementType"),
          quantity: Number(f.get("quantity")),
          reason: f.get("reason"),
          reference: f.get("reference") || undefined,
        },
        "Stock balance updated.",
      );
    if (form === "request")
      await act(
        "/api/waste/inventory/purchase-requests",
        "POST",
        {
          itemName: f.get("itemName"),
          category: f.get("category"),
          quantity: Number(f.get("quantity")),
          unit: f.get("unit"),
          estimatedCostUgx: Number(f.get("estimatedCostUgx")),
          justification: f.get("justification"),
        },
        "Purchase request created.",
      );
  }
  return (
    <AppShell>
      <div className="mx-auto max-w-7xl">
        <OrganizationWorkspaceNav />
        <PageHeader
          eyebrow="Stores and procurement"
          title="Inventory & purchasing"
          description="Know what is available, record every stock change and request supplies before operations are interrupted."
          action={
            <button
              onClick={() => setForm("request")}
              className="bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white"
            >
              New purchase request
            </button>
          }
        />
        {error && <Feedback tone="error">{error}</Feedback>}
        {message && <Feedback tone="success">{message}</Feedback>}
        <section className="mt-8 grid border-y border-slate-300 sm:grid-cols-3">
          {[
            ["Stock items", data.items.length],
            ["Low stock", low],
            ["Stock value", money(value)],
          ].map(([a, b]) => (
            <div
              key={String(a)}
              className="border-b py-5 pr-5 sm:border-b-0 sm:border-r"
            >
              <p className="text-sm font-semibold text-slate-500">{a}</p>
              <p className="mt-2 text-3xl font-semibold">{b}</p>
            </div>
          ))}
        </section>
        <nav className="mt-8 flex gap-6 border-b border-slate-300">
          {[
            ["stock", "Stock register"],
            ["movements", "Movement history"],
            ["requests", "Purchase requests"],
          ].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setTab(v as typeof tab)}
              className={`border-b-2 pb-3 text-sm font-semibold ${tab === v ? "border-[#3156a3] text-[#3156a3]" : "border-transparent text-slate-500"}`}
            >
              {l}
            </button>
          ))}
        </nav>
        {form !== "none" && (
          <form
            onSubmit={submit}
            className="mt-6 border-y border-slate-300 bg-white p-5"
          >
            <div className="flex justify-between">
              <div>
                <h2 className="text-lg font-semibold">
                  {form === "item"
                    ? "Add stock item"
                    : form === "movement"
                      ? "Record stock movement"
                      : "New purchase request"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Complete the required operational details below.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setForm("none")}
                className="text-sm font-semibold text-slate-500"
              >
                Close
              </button>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              {form === "item" && (
                <>
                  <Field name="sku" label="SKU" required />
                  <Field name="name" label="Item name" required />
                  <Category />
                  <Field name="unit" label="Unit" required />
                  <Field
                    name="reorderLevel"
                    label="Reorder level"
                    type="number"
                    required
                  />
                  <Field
                    name="unitCostUgx"
                    label="Unit cost (UGX)"
                    type="number"
                    required
                  />
                  <Field name="storageLocation" label="Storage location" />
                </>
              )}
              {form === "movement" && (
                <>
                  <label className="text-sm font-semibold">
                    Item
                    <select
                      required
                      name="itemId"
                      className="mt-1 w-full border p-2.5"
                    >
                      <option value="">Select item</option>
                      {data.items.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.sku} · {i.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-semibold">
                    Movement
                    <select
                      name="movementType"
                      className="mt-1 w-full border p-2.5"
                    >
                      <option value="receipt">Receive stock</option>
                      <option value="issue">Issue stock</option>
                      <option value="adjustment">Adjustment</option>
                    </select>
                  </label>
                  <Field
                    name="quantity"
                    label="Quantity"
                    type="number"
                    required
                  />
                  <Field name="reason" label="Reason" required />
                  <Field name="reference" label="Reference" />
                </>
              )}
              {form === "request" && (
                <>
                  <Field name="itemName" label="Requested item" required />
                  <Category />
                  <Field
                    name="quantity"
                    label="Quantity"
                    type="number"
                    required
                  />
                  <Field name="unit" label="Unit" required />
                  <Field
                    name="estimatedCostUgx"
                    label="Estimated cost (UGX)"
                    type="number"
                    required
                  />
                  <Field
                    name="justification"
                    label="Business justification"
                    required
                  />
                </>
              )}
              <button
                disabled={saving}
                className="self-end bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        )}
        {tab === "stock" && (
          <section className="mt-6">
            <div className="table-toolbar flex-wrap">
              <input
                type="search"
                aria-label="Search inventory"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search SKU, item or category"
                className="table-search"
              />
              <span className="table-count">{items.length} results</span>
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => setForm("movement")}
                  className="border border-[#3156a3] px-4 py-2 text-sm font-semibold text-[#3156a3]"
                >
                  Record movement
                </button>
                <button
                  onClick={() => setForm("item")}
                  className="bg-[#3156a3] px-4 py-2 text-sm font-semibold text-white"
                >
                  Add item
                </button>
              </div>
            </div>
            <div className="table-wrap">
              {items.length ? (
                <table className="min-w-[820px] text-left">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Category</th>
                      <th className="text-right">Available</th>
                      <th>Storage</th>
                      <th className="text-right">Unit cost</th>
                      <th className="text-right">Value</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id}>
                        <td>
                          <p className="table-primary">{i.name}</p>
                          <p className="table-secondary">{i.sku}</p>
                        </td>
                        <td className="capitalize">{label(i.category)}</td>
                        <td className="text-right font-semibold">
                          {Number(i.quantity).toLocaleString()} {i.unit}
                        </td>
                        <td>{i.storage_location || "—"}</td>
                        <td className="text-right">{money(i.unit_cost_ugx)}</td>
                        <td className="text-right">
                          {money(i.stock_value_ugx)}
                        </td>
                        <td>
                          <Status
                            value={i.low_stock ? "low_stock" : "available"}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState
                  title="No inventory items"
                  description="Add the first item to begin tracking operational stock."
                />
              )}
            </div>
          </section>
        )}
        {tab === "movements" && (
          <section className="mt-6">
            {data.movements.length ? (
              <table className="w-full text-left text-sm">
                <thead className="border-y">
                  <tr>
                    <th className="p-3">Date</th>
                    <th>Item</th>
                    <th>Movement</th>
                    <th className="text-right">Quantity</th>
                    <th>Reason</th>
                    <th>Recorded by</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.movements.map((m) => (
                    <tr key={m.id}>
                      <td className="p-3">
                        {new Date(m.created_at).toLocaleDateString("en-GB")}
                      </td>
                      <td className="font-semibold">{m.item_name}</td>
                      <td>
                        <Status value={m.movement_type} />
                      </td>
                      <td className="text-right font-semibold">{m.quantity}</td>
                      <td>{m.reason}</td>
                      <td>{m.recorded_by_name || "System"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState
                title="No stock movements"
                description="Receipts, issues and adjustments will create the audit trail here."
              />
            )}
          </section>
        )}
        {tab === "requests" && (
          <section className="mt-6">
            {data.requests.length ? (
              <div className="table-wrap">
                <table className="min-w-[900px] text-left">
                  <thead>
                    <tr>
                      <th>Request / item</th>
                      <th>Quantity</th>
                      <th>Requested by</th>
                      <th className="text-right">Estimated cost</th>
                      <th>Status</th>
                      <th className="text-right">Next action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.requests.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <p className="table-primary">{r.item_name}</p>
                          <p className="table-secondary">
                            {r.request_number} · {r.justification}
                          </p>
                        </td>
                        <td>
                          {r.quantity} {r.unit}
                        </td>
                        <td>{r.requested_by_name || "Unknown requester"}</td>
                        <td className="text-right font-semibold">
                          {money(r.estimated_cost_ugx)}
                        </td>
                        <td>
                          <Status value={r.status} />
                        </td>
                        <td>
                          <div className="table-actions">
                            {r.status === "draft" && (
                              <Action request={r} next="submitted" act={act} />
                            )}{" "}
                            {r.status === "submitted" && (
                              <Action request={r} next="approved" act={act} />
                            )}{" "}
                            {r.status === "submitted" && <Action request={r} next="rejected" act={act}/>} 
                            {r.status === "approved" && <span className="text-xs text-slate-500">Ready in Procurement</span>}
                            {r.status === "ordered" && <span className="text-xs text-slate-500">Awaiting supplier delivery</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="No purchase requests"
                description="Create a request when stock must be replenished or new supplies are required."
              />
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}
function Field({
  name,
  label,
  type = "text",
  required = false,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="text-sm font-semibold">
      {label}
      <input
        required={required}
        name={name}
        type={type}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "any" : undefined}
        className="mt-1 w-full border p-2.5"
      />
    </label>
  );
}
function Category() {
  return (
    <label className="text-sm font-semibold">
      Category
      <select name="category" className="mt-1 w-full border p-2.5">
        <option value="bins">Bins</option>
        <option value="ppe">PPE</option>
        <option value="vehicle_parts">Vehicle parts</option>
        <option value="tools">Tools</option>
        <option value="cleaning_supplies">Cleaning supplies</option>
        <option value="office">Office</option>
        <option value="other">Other</option>
      </select>
    </label>
  );
}
function Action({
  request,
  next,
  act,
}: {
  request: PR;
  next: string;
  act: (p: string, m: string, b: unknown, x: string) => Promise<void>;
}) {
  return (
    <button
      onClick={() =>
        void act(
          `/api/waste/inventory/purchase-requests/${request.id}/status`,
          "PATCH",
          { status: next },
          `Request marked ${next}.`,
        )
      }
      className="border border-[#3156a3] px-3 py-2 text-xs font-semibold capitalize text-[#3156a3]"
    >
      Mark {next}
    </button>
  );
}
