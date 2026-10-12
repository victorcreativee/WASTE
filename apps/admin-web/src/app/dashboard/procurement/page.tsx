"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { OrganizationWorkspaceNav } from "@/components/layout/OrganizationWorkspaceNav";
import {
  EmptyState,
  Feedback,
  Modal,
  PageHeader,
  Status,
} from "@/components/ui/System";
import { Pagination, usePagination } from "@/components/ui/Pagination";
import { apiRequest } from "@/lib/api";
import { FundingSummary, type FundingPosition } from "@/components/ui/FundingSummary";
import { FundingShortfall } from "@/components/ui/FundingShortfall";
type Supplier = {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  payment_terms: string | null;
  status: string;
  order_count: number;
  ordered_value_ugx: string;
};
type Order = {
  id: string;
  order_number: string;
  supplier_name: string;
  request_number: string | null;
  item_name: string;
  quantity: string;
  unit: string;
  unit_price_ugx: string;
  total_ugx: string;
  expected_on: string | null;
  status: string;
};
type Request = {
  id: string;
  request_number: string;
  item_name: string;
  quantity: string;
  unit: string;
  estimated_cost_ugx: string;
};
type Data = {
  funding?: FundingPosition | null;
  suppliers: Supplier[];
  orders: Order[];
  approvedRequests: Request[];
};
const money = (v: string | number) =>
  `UGX ${new Intl.NumberFormat("en-UG", { maximumFractionDigits: 0 }).format(Number(v || 0))}`;
export default function ProcurementPage() {
  const [data, setData] = useState<Data>({
      suppliers: [],
      orders: [],
      approvedRequests: [],
    }),
    [tab, setTab] = useState<"orders" | "suppliers">("orders"),
    [form, setForm] = useState<"none" | "supplier" | "order">("none"),
    [orderDraft,setOrderDraft]=useState({purchaseRequestId:"",itemName:"",quantity:"",unit:"",unitPriceUgx:""}),
    [query,setQuery]=useState(""),[status,setStatus]=useState("all"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const r = await apiRequest<{ data: Data }>("/api/waste/procurement");
    setData(r.data);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : "Failed to load procurement"),
    );
  }, [load]);
  const filteredOrders=useMemo(()=>{const q=query.trim().toLowerCase();return data.orders.filter(o=>(status==="all"||o.status===status)&&(!q||`${o.order_number} ${o.supplier_name} ${o.item_name} ${o.request_number||""}`.toLowerCase().includes(q)));},[data.orders,query,status]);
  const filteredSuppliers=useMemo(()=>{const q=query.trim().toLowerCase();return data.suppliers.filter(s=>!q||`${s.name} ${s.contact_person||""} ${s.phone||""} ${s.email||""}`.toLowerCase().includes(q));},[data.suppliers,query]);
  const orderPages=usePagination(filteredOrders),supplierPages=usePagination(filteredSuppliers);
  function chooseRequest(id:string){const request=data.approvedRequests.find(r=>r.id===id);setOrderDraft(request?{purchaseRequestId:id,itemName:request.item_name,quantity:request.quantity,unit:request.unit,unitPriceUgx:String(Math.ceil(Number(request.estimated_cost_ugx)/Number(request.quantity)))}:{purchaseRequestId:"",itemName:"",quantity:"",unit:"",unitPriceUgx:""});}
  async function act(path: string, method: string, body: unknown, msg: string) {
    try {
      setSaving(true);
      setError("");
      setMessage("");
      const response=await apiRequest<{message?:string}>(path, { method, body: JSON.stringify(body) });
      setMessage(response.message||msg);
      setForm("none");
      setOrderDraft({purchaseRequestId:"",itemName:"",quantity:"",unit:"",unitPriceUgx:""});
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
    if (form === "supplier")
      await act(
        "/api/waste/procurement/suppliers",
        "POST",
        {
          name: f.get("name"),
          contactPerson: f.get("contactPerson") || undefined,
          phone: f.get("phone") || undefined,
          email: f.get("email") || undefined,
          address: f.get("address") || undefined,
          taxNumber: f.get("taxNumber") || undefined,
          paymentTerms: f.get("paymentTerms") || undefined,
        },
        "Supplier added.",
      );
    if (form === "order")
      await act(
        "/api/waste/procurement/orders",
        "POST",
        {
          purchaseRequestId: orderDraft.purchaseRequestId || undefined,
          supplierId: f.get("supplierId"),
          itemName: orderDraft.itemName,
          quantity: Number(orderDraft.quantity),
          unit: orderDraft.unit,
          unitPriceUgx: Number(orderDraft.unitPriceUgx),
          expectedOn: f.get("expectedOn") || undefined,
          notes: f.get("notes") || undefined,
        },
        "Purchase order created.",
      );
  }
  return (
    <AppShell>
      <div className="mx-auto max-w-7xl">
        <OrganizationWorkspaceNav />
        <PageHeader
          eyebrow="Procurement"
          title="Suppliers and purchase orders"
          description="Turn approved supply needs into accountable orders and follow delivery through receipt."
          action={
            <button
              onClick={() => setForm("order")}
              className="bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white"
            >
              Create purchase order
            </button>
          }
        />
        {error && <Feedback tone="error">{error}</Feedback>}
        <FundingSummary funding={data.funding} />
        {message && <Feedback tone="success">{message}</Feedback>}
        <nav className="mt-8 flex gap-6 border-b">
          {[
            ["orders", "Purchase orders"],
            ["suppliers", "Suppliers"],
          ].map(([v, l]) => (
            <button
              key={v}
              onClick={() => {setTab(v as typeof tab);setQuery("");setStatus("all")}}
              className={`border-b-2 pb-3 text-sm font-semibold ${tab === v ? "border-[#3156a3] text-[#3156a3]" : "border-transparent text-slate-500"}`}
            >
              {l}
            </button>
          ))}
        </nav>
        {form !== "none" && (
          <Modal open title={form === "supplier" ? "Add supplier" : "Create purchase order"} description={form==="supplier"?"Add an approved supplier for accountable purchasing.":"Use an approved request where possible; its item and quantity cannot be changed."} onClose={()=>setForm("none")}>
          <form onSubmit={submit}>
            <div className="grid gap-4 sm:grid-cols-2">
              {form === "supplier" ? (
                <>
                  <Field name="name" label="Supplier name" required />
                  <Field name="contactPerson" label="Contact person" />
                  <Field name="phone" label="Phone" />
                  <Field name="email" label="Email" type="email" />
                  <Field name="address" label="Address" />
                  <Field name="taxNumber" label="Tax number" />
                  <Field name="paymentTerms" label="Payment terms" />
                </>
              ) : (
                <>
                  <label className="text-sm font-semibold">
                    Approved request
                    <select
                      value={orderDraft.purchaseRequestId}
                      onChange={e=>chooseRequest(e.target.value)}
                      className="mt-1 w-full border p-2.5"
                    >
                      <option value="">Standalone order</option>
                      {data.approvedRequests.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.request_number} · {r.item_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-semibold">
                    Supplier
                    <select
                      required
                      name="supplierId"
                      className="mt-1 w-full border p-2.5"
                    >
                      <option value="">Choose supplier</option>
                      {data.suppliers
                        .filter((s) => s.status === "active")
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="text-sm font-semibold">Item<input required value={orderDraft.itemName} readOnly={Boolean(orderDraft.purchaseRequestId)} onChange={e=>setOrderDraft({...orderDraft,itemName:e.target.value})} className="mt-1 w-full border p-2.5 read-only:bg-slate-100"/></label>
                  <label className="text-sm font-semibold">Quantity<input required type="number" min="0.01" step="any" value={orderDraft.quantity} readOnly={Boolean(orderDraft.purchaseRequestId)} onChange={e=>setOrderDraft({...orderDraft,quantity:e.target.value})} className="mt-1 w-full border p-2.5 read-only:bg-slate-100"/></label>
                  <label className="text-sm font-semibold">Unit<input required value={orderDraft.unit} readOnly={Boolean(orderDraft.purchaseRequestId)} onChange={e=>setOrderDraft({...orderDraft,unit:e.target.value})} className="mt-1 w-full border p-2.5 read-only:bg-slate-100"/></label>
                  <label className="text-sm font-semibold">Unit price (UGX)<input required type="number" min="0" value={orderDraft.unitPriceUgx} onChange={e=>setOrderDraft({...orderDraft,unitPriceUgx:e.target.value})} className="mt-1 w-full border p-2.5"/></label>
                  <Field
                    name="expectedOn"
                    label="Expected delivery"
                    type="date"
                  />
                  <Field name="notes" label="Notes" />
                </>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-3 border-t pt-4"><button type="button" onClick={()=>setForm("none")} className="border px-4">Cancel</button><button disabled={saving} className="bg-[#3156a3] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving?"Saving...":"Save"}</button></div>
          </form>
          </Modal>
        )}
        {tab === "orders" && (
          <section className="mt-6">
            <div className="mb-4 flex justify-between">
              <p className="text-sm text-slate-500">
                {data.approvedRequests.length} approved requests are ready to
                order.
              </p>
            </div>
            <div className="table-toolbar"><input type="search" value={query} onChange={e=>{setQuery(e.target.value);orderPages.setPage(1)}} placeholder="Search order, supplier or item" aria-label="Search purchase orders" className="table-search"/><select value={status} onChange={e=>{setStatus(e.target.value);orderPages.setPage(1)}} aria-label="Filter purchase order status" className="border px-3 py-2"><option value="all">All statuses</option><option value="draft">Draft</option><option value="issued">Issued</option><option value="received">Received</option><option value="cancelled">Cancelled</option></select><span className="table-count">{filteredOrders.length} results</span></div>
            {filteredOrders.length ? (<>
              <div className="table-wrap">
                <table className="min-w-[900px] text-left">
                  <thead>
                    <tr>
                      <th className="p-3">Order</th>
                      <th>Supplier</th>
                      <th>Item</th>
                      <th className="text-right">Quantity</th>
                      <th className="text-right">Total</th>
                      <th>Expected</th>
                      <th>Status / action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderPages.paged.map((o) => (
                      <tr key={o.id}>
                        <td className="p-3">
                          <p className="table-primary">{o.order_number}</p>
                          <p className="table-secondary">
                            {o.request_number || "Standalone"}
                          </p>
                        </td>
                        <td>{o.supplier_name}</td>
                        <td>{o.item_name}</td>
                        <td className="text-right">
                          {o.quantity} {o.unit}
                        </td>
                        <td className="text-right font-semibold">
                          {money(o.total_ugx)}
                        </td>
                        <td>
                          {o.expected_on
                            ? new Date(o.expected_on).toLocaleDateString(
                                "en-GB",
                              )
                            : "—"}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <Status value={o.status} />
                            {o.status === "draft" && (
                              <Step order={o} next="issued" act={act} disabled={saving || !data.funding || Number(o.total_ugx)>Number(data.funding.available_to_commit_ugx)} />
                            )}{" "}
                            {o.status === "issued" && (
                              <Step order={o} next="received" act={act} disabled={saving} />
                            )}
                            {["draft","issued"].includes(o.status)&&<Step order={o} next="cancelled" act={act} disabled={saving}/>} 
                          </div>
                          {o.status === "draft" && data.funding && <FundingShortfall amount={Number(o.total_ugx)} available={Number(data.funding.available_to_commit_ugx)} action="approval" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={orderPages.page} pageSize={orderPages.pageSize} total={orderPages.total} totalPages={orderPages.totalPages} onPage={orderPages.setPage} onPageSize={orderPages.setPageSize}/></>
            ) : (
              <EmptyState
                title="No purchase orders"
                description="Create an order from an approved request or for a standalone purchase."
                action={
                  <button
                    onClick={() => setForm("order")}
                    className="bg-[#3156a3] px-4 py-2 text-sm font-semibold text-white"
                  >
                    Create first order
                  </button>
                }
              />
            )}
          </section>
        )}
        {tab === "suppliers" && (
          <section className="mt-6">
            <div className="mb-4 text-right">
              <button
                onClick={() => setForm("supplier")}
                className="border border-[#3156a3] px-4 py-2 text-sm font-semibold text-[#3156a3]"
              >
                Add supplier
              </button>
            </div>
            <div className="table-toolbar"><input type="search" value={query} onChange={e=>{setQuery(e.target.value);supplierPages.setPage(1)}} placeholder="Search supplier or contact" aria-label="Search suppliers" className="table-search"/><span className="table-count">{filteredSuppliers.length} results</span></div>
            {filteredSuppliers.length ? (<>
              <div className="table-wrap"><table className="min-w-[760px] text-left">
                <thead>
                  <tr>
                    <th className="p-3">Supplier</th>
                    <th>Contact</th>
                    <th>Terms</th>
                    <th className="text-right">Orders</th>
                    <th className="text-right">Ordered value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierPages.paged.map((s) => (
                    <tr key={s.id}>
                      <td className="table-primary">{s.name}</td>
                      <td>
                        {s.contact_person || "—"}
                        <p className="table-secondary">
                          {s.phone || s.email || ""}
                        </p>
                      </td>
                      <td>{s.payment_terms || "—"}</td>
                      <td className="text-right">{s.order_count}</td>
                      <td className="text-right">
                        {money(s.ordered_value_ugx)}
                      </td>
                      <td>
                        <Status value={s.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div><Pagination page={supplierPages.page} pageSize={supplierPages.pageSize} total={supplierPages.total} totalPages={supplierPages.totalPages} onPage={supplierPages.setPage} onPageSize={supplierPages.setPageSize}/></>
            ) : (
              <EmptyState
                title="No suppliers"
                description="Add approved suppliers before creating purchase orders."
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
        name={name}
        type={type}
        required={required}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "any" : undefined}
        className="mt-1 w-full border p-2.5"
      />
    </label>
  );
}
function Step({
  order,
  next,
  act,
  disabled = false,
}: {
  order: Order;
  next: string;
  disabled?: boolean;
  act: (p: string, m: string, b: unknown, x: string) => Promise<void>;
}) {
  return (
    <button
      disabled={disabled}
      onClick={() =>
        void act(
          `/api/waste/procurement/orders/${order.id}/status`,
          "PATCH",
          { status: next },
          `Order marked ${next}.`,
        )
      }
      className="border border-[#3156a3] px-3 py-2 text-xs font-semibold capitalize text-[#3156a3]"
    >
      Mark {next}
    </button>
  );
}
