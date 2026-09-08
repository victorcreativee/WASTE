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
type Bill = {
  id: string;
  bill_number: string;
  supplier_id: string;
  supplier_name: string;
  order_number: string | null;
  description: string;
  amount_ugx: string;
  balance_ugx: string;
  issued_on: string;
  due_on: string;
  status: string;
};
type Payment = {
  id: string;
  bill_number: string;
  supplier_name: string;
  amount_ugx: string;
  payment_method: string;
  reference: string | null;
  paid_on: string;
  recorded_by_name: string | null;
};
type Supplier = { id: string; name: string };
type Order = {
  id: string;
  order_number: string;
  supplier_id: string;
  item_name: string;
  total_ugx: string;
};
type Data = {
  funding?: FundingPosition | null;
  bills: Bill[];
  payments: Payment[];
  suppliers: Supplier[];
  unbilledOrders: Order[];
};
const money = (v: string | number) =>
  new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    maximumFractionDigits: 0,
  }).format(Number(v || 0));
const label = (v: string) => v.replaceAll("_", " ");
const today = () => new Date().toISOString().slice(0, 10);
export default function PayablesPage() {
  const [data, setData] = useState<Data>({
      bills: [],
      payments: [],
      suppliers: [],
      unbilledOrders: [],
    }),
    [tab, setTab] = useState<"bills" | "payments">("bills"),
    [form, setForm] = useState<"none" | "bill" | "payment">("none"),
    [paying, setPaying] = useState<Bill | null>(null),
    [paymentAmount, setPaymentAmount] = useState(""),
    [billDraft, setBillDraft] = useState({purchaseOrderId:"",supplierId:"",description:"",amountUgx:""}),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const r = await apiRequest<{ data: Data }>("/api/waste/finance/payables");
    setData(r.data);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((e) =>
      setError(
        e instanceof Error ? e.message : "Failed to load accounts payable",
      ),
    );
  }, [load]);
  const outstanding = useMemo(
      () => data.bills.reduce((n, b) => n + Number(b.balance_ugx), 0),
      [data.bills],
    ),
    overdue = data.bills.filter((b) => b.status === "overdue").length;
  const filteredBills=useMemo(()=>{const q=query.trim().toLowerCase();return data.bills.filter(b=>(status==="all"||b.status===status)&&(!q||`${b.bill_number} ${b.supplier_name} ${b.description} ${b.order_number||""}`.toLowerCase().includes(q)));},[data.bills,query,status]);
  const filteredPayments=useMemo(()=>{const q=query.trim().toLowerCase();return data.payments.filter(p=>!q||`${p.bill_number} ${p.supplier_name} ${p.payment_method} ${p.reference||""}`.toLowerCase().includes(q));},[data.payments,query]);
  const billPages=usePagination(filteredBills),paymentPages=usePagination(filteredPayments);
  const billFunding = Number(data.funding?.available_to_commit_ugx ?? 0) + Number(data.unbilledOrders.find(o=>o.id===billDraft.purchaseOrderId)?.total_ugx ?? 0);
  function chooseOrder(id:string){const order=data.unbilledOrders.find(o=>o.id===id);setBillDraft(order?{purchaseOrderId:id,supplierId:order.supplier_id,description:order.item_name,amountUgx:order.total_ugx}:{purchaseOrderId:"",supplierId:"",description:"",amountUgx:""});}
  async function act(path: string, body: unknown, msg: string) {
    try {
      setSaving(true);
      setError("");
      setMessage("");
      await apiRequest(path, { method: "POST", body: JSON.stringify(body) });
      setMessage(msg);
      setForm("none");
      setPaying(null);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function submitBill(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const saved=await act(
      "/api/waste/finance/payables/bills",
      {
        billNumber: f.get("billNumber"),
        supplierId: billDraft.supplierId,
        purchaseOrderId: billDraft.purchaseOrderId || undefined,
        description: billDraft.description,
        amountUgx: Number(billDraft.amountUgx),
        issuedOn: f.get("issuedOn"),
        dueOn: f.get("dueOn"),
      },
      "Supplier bill recorded.",
    );
    if(saved)setBillDraft({purchaseOrderId:"",supplierId:"",description:"",amountUgx:""});
  }
  async function submitPayment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!paying) return;
    const f = new FormData(e.currentTarget);
    if (!data.funding || Number(paymentAmount)>Number(data.funding.cash_position_ugx)) {
      setError("Payment exceeds the cash balance. Refresh and review available funds.");
      return;
    }
    if (!window.confirm(`Confirm ${money(paymentAmount)} has actually been paid to ${paying.supplier_name}? This records a cash outflow.`)) return;
    await act(
      `/api/waste/finance/payables/bills/${paying.id}/payments`,
      {
        amountUgx: Number(f.get("amountUgx")),
        paymentMethod: f.get("paymentMethod"),
        reference: f.get("reference"),
        paidOn: f.get("paidOn"),
        notes: f.get("notes") || undefined,
      },
      "Supplier payment recorded.",
    );
  }
  return (
    <AppShell>
      <div className="mx-auto max-w-7xl">
        <OrganizationWorkspaceNav />
        <PageHeader
          eyebrow="Finance"
          title="Accounts payable"
          description="Record supplier bills, see what is due and maintain a reliable payment history."
          action={
            <button
              onClick={() => setForm("bill")}
              className="bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white"
            >
              Record supplier bill
            </button>
          }
        />
        {error && <Feedback tone="error">{error}</Feedback>}
        <FundingSummary funding={data.funding} />
        {message && <Feedback tone="success">{message}</Feedback>}
        <section className="mt-8 grid border-y sm:grid-cols-3">
          {[
            ["Outstanding", money(outstanding)],
            ["Overdue bills", overdue],
            ["Unbilled received orders", data.unbilledOrders.length],
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
        <nav className="mt-8 flex gap-6 border-b">
          {[
            ["bills", "Supplier bills"],
            ["payments", "Payment history"],
          ].map(([v, l]) => (
            <button
              key={v}
              onClick={() => {setTab(v as typeof tab);setQuery("");setStatus("all");}}
              className={`border-b-2 pb-3 text-sm font-semibold ${tab === v ? "border-[#3156a3] text-[#3156a3]" : "border-transparent text-slate-500"}`}
            >
              {l}
            </button>
          ))}
        </nav>
        {form === "bill" && (
          <Modal open title="Record supplier bill" description="Link a received order where possible so supplier and payable values remain traceable." onClose={() => setForm("none")}>
          <form onSubmit={submitBill}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                name="billNumber"
                label="Supplier invoice number"
                required
              />
              <label className="text-sm font-semibold">
                Supplier
                <select
                  required
                  value={billDraft.supplierId}
                  disabled={Boolean(billDraft.purchaseOrderId)}
                  onChange={e=>setBillDraft({...billDraft,supplierId:e.target.value})}
                  className="mt-1 w-full border p-2.5 disabled:bg-slate-100"
                >
                  <option value="">Choose supplier</option>
                  {data.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold">
                Received order
                <select
                  value={billDraft.purchaseOrderId}
                  onChange={e=>chooseOrder(e.target.value)}
                  className="mt-1 w-full border p-2.5"
                >
                  <option value="">No linked order</option>
                  {data.unbilledOrders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.order_number} · {o.item_name} · {money(o.total_ugx)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold">Description<input required value={billDraft.description} onChange={e=>setBillDraft({...billDraft,description:e.target.value})} className="mt-1 w-full border p-2.5"/></label>
              <label className="text-sm font-semibold">Amount (UGX)<input required type="number" min="1" value={billDraft.amountUgx} readOnly={Boolean(billDraft.purchaseOrderId)} onChange={e=>setBillDraft({...billDraft,amountUgx:e.target.value})} className="mt-1 w-full border p-2.5 read-only:bg-slate-100"/></label>
              <Field
                name="issuedOn"
                label="Invoice date"
                type="date"
                defaultValue={today()}
                required
              />
              <Field name="dueOn" label="Due date" type="date" defaultValue={today()} required />
            </div>
            {billDraft.purchaseOrderId && <p className="mt-3 text-xs text-slate-500">This bill replaces the selected order’s existing commitment; it does not reserve the same money twice.</p>}
            <FundingShortfall amount={Number(billDraft.amountUgx)} available={billFunding} action="approval" />
            <div className="mt-6 flex justify-end gap-3 border-t pt-4"><button type="button" onClick={()=>setForm("none")} className="border px-4">Cancel</button><button disabled={saving || !data.funding || Number(billDraft.amountUgx)>billFunding} className="bg-[#3156a3] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving?"Saving...":"Save bill"}</button></div>
          </form>
          </Modal>
        )}
        {form === "payment" && paying && (
          <Modal open title={`Record payment · ${paying.bill_number}`} description={`Apply a verified payment. Outstanding balance: ${money(paying.balance_ugx)}.`} onClose={()=>{setForm("none");setPaying(null)}}>
          <form onSubmit={submitPayment}>
            {error && <p role="alert" className="mb-4 border-l-2 border-red-600 pl-3 text-sm text-red-800">{error}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold">Payment amount<input name="amountUgx" type="number" min="1" max={paying.balance_ugx} value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)} required aria-describedby="supplier-payment-funding" className="mt-1 w-full border p-2.5"/></label>
              <label className="text-sm font-semibold">
                Method
                <select
                  name="paymentMethod"
                  className="mt-1 w-full border p-2.5"
                >
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="mobile_money">Mobile money</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <Field name="reference" label="Receipt or transaction reference" required />
              <Field name="paidOn" label="Payment date" type="date" defaultValue={today()} max={today()} required />
              <p className="text-xs text-slate-500 sm:col-span-2">Use the actual payment date. Dates before your opening balance or after today are not accepted.</p>
              <Field name="notes" label="Notes" />
            </div>
            <div id="supplier-payment-funding" aria-live="polite">{data.funding && <FundingShortfall amount={Number(paymentAmount)} available={Number(data.funding.cash_position_ugx)} action="payment" />}</div>
            <div className="mt-6 flex justify-end gap-3 border-t pt-4"><button type="button" onClick={()=>{setForm("none");setPaying(null)}} className="border px-4">Cancel</button><button disabled={saving || !data.funding || Number(paymentAmount)<=0 || Number(paymentAmount)>Number(data.funding.cash_position_ugx) || Number(paymentAmount)>Number(paying.balance_ugx)} className="bg-[#3156a3] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving?"Recording...":"Record payment"}</button></div>
          </form>
          </Modal>
        )}
        {tab === "bills" && (
          <section className="mt-6">
            <div className="table-toolbar"><input type="search" value={query} onChange={e=>{setQuery(e.target.value);billPages.setPage(1)}} placeholder="Search bill, supplier or order" aria-label="Search supplier bills" className="table-search"/><select value={status} onChange={e=>{setStatus(e.target.value);billPages.setPage(1)}} aria-label="Filter bill status" className="border px-3 py-2"><option value="all">All statuses</option><option value="open">Open</option><option value="partially_paid">Partially paid</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="void">Void</option></select><span className="table-count">{filteredBills.length} results</span></div>
            {filteredBills.length ? (<>
              <div className="table-wrap">
                <table className="min-w-[920px] text-left">
                  <thead>
                    <tr>
                      <th className="p-3">Bill</th>
                      <th>Supplier</th>
                      <th>Issued / due</th>
                      <th className="text-right">Amount</th>
                      <th className="text-right">Balance</th>
                      <th>Status / action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billPages.paged.map((b) => (
                      <tr key={b.id}>
                        <td className="p-3">
                          <p className="table-primary">{b.bill_number}</p>
                          <p className="table-secondary">
                            {b.description}
                            {b.order_number ? ` · ${b.order_number}` : ""}
                          </p>
                        </td>
                        <td>{b.supplier_name}</td>
                        <td>
                          {new Date(b.issued_on).toLocaleDateString("en-GB")}
                          <p className="table-secondary">
                            Due {new Date(b.due_on).toLocaleDateString("en-GB")}
                          </p>
                        </td>
                        <td className="text-right">{money(b.amount_ugx)}</td>
                        <td className="text-right font-semibold">
                          {money(b.balance_ugx)}
                        </td>
                        <td>
                          <div className="flex items-center gap-3">
                            <Status value={b.status} />
                            {Number(b.balance_ugx) > 0 && b.status!=="void" && (
                              <button
                                onClick={() => {
                                  setPaying(b);
                                  setPaymentAmount(b.balance_ugx);
                                  setForm("payment");
                                }}
                                className="border border-[#3156a3] px-3 py-2 text-xs font-semibold text-[#3156a3]"
                              >
                                Record payment
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={billPages.page} pageSize={billPages.pageSize} total={billPages.total} totalPages={billPages.totalPages} onPage={billPages.setPage} onPageSize={billPages.setPageSize}/>
              </>
            ) : (
              <EmptyState
                title={data.bills.length?"No supplier bills match this view":"No supplier bills"}
                description={data.bills.length?"Clear the search or choose another status.":"Record a bill after goods or services are received."}
              />
            )}
          </section>
        )}
        {tab === "payments" && (
          <section className="mt-6">
            <div className="table-toolbar"><input type="search" value={query} onChange={e=>{setQuery(e.target.value);paymentPages.setPage(1)}} placeholder="Search supplier, bill or reference" aria-label="Search supplier payments" className="table-search"/><span className="table-count">{filteredPayments.length} results</span></div>
            {filteredPayments.length ? (<>
              <div className="table-wrap"><table className="min-w-[760px] text-left">
                <thead>
                  <tr>
                    <th className="p-3">Paid on</th>
                    <th>Supplier / bill</th>
                    <th>Method</th>
                    <th>Reference</th>
                    <th className="text-right">Amount</th>
                    <th>Recorded by</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentPages.paged.map((p) => (
                    <tr key={p.id}>
                      <td className="p-3">
                        {new Date(p.paid_on).toLocaleDateString("en-GB")}
                      </td>
                      <td>
                        <p className="table-primary">{p.supplier_name}</p>
                        <p className="table-secondary">
                          {p.bill_number}
                        </p>
                      </td>
                      <td className="capitalize">{label(p.payment_method)}</td>
                      <td>{p.reference || "—"}</td>
                      <td className="text-right font-semibold">
                        {money(p.amount_ugx)}
                      </td>
                      <td>{p.recorded_by_name || "System"}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div><Pagination page={paymentPages.page} pageSize={paymentPages.pageSize} total={paymentPages.total} totalPages={paymentPages.totalPages} onPage={paymentPages.setPage} onPageSize={paymentPages.setPageSize}/></>
            ) : (
              <EmptyState
                title={data.payments.length?"No supplier payments match this search":"No supplier payments"}
                description={data.payments.length?"Try a supplier, bill number or reference.":"Payments will appear here after they are recorded against a bill."}
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
  defaultValue,
  max,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  max?: string;
}) {
  return (
    <label className="text-sm font-semibold">
      {label}
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        max={max}
        min={type === "number" ? 1 : undefined}
        className="mt-1 w-full border p-2.5"
      />
    </label>
  );
}
