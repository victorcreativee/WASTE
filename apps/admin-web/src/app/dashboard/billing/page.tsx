"use client";
import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { AppShell } from "@/components/layout/AppShell";
import { apiRequest } from "@/lib/api";
import { Feedback, Modal, PageHeader, Status } from "@/components/ui/System";
import { Pagination, usePagination } from "@/components/ui/Pagination";
import { FundingShortfall } from "@/components/ui/FundingShortfall";

type Plan = {
  id: string;
  name: string;
  description: string | null;
  customer_type: string | null;
  billing_frequency: string;
  fee_ugx: string;
  collections_per_period: number;
  response_hours: number;
  is_active: boolean;
  contract_count: number;
  subscription_count: number;
  organization_name: string;
};
type Subscription = {
  id: string;
  customer_name: string;
  plan_name: string;
  fee_ugx: string;
  billing_frequency: string;
  status: string;
  starts_on: string;
  next_billing_date: string | null;
  organization_name: string;
};
type Invoice = {
  id: string;
  invoice_number: string;
  customer_name: string;
  plan_name: string;
  amount_ugx: string;
  balance_ugx: string;
  status: string;
  issued_on: string;
  due_on: string;
};
type Payment = {
  id: string;
  invoice_number: string;
  customer_name: string;
  amount_ugx: string;
  provider: string;
  provider_reference: string | null;
  status: string;
  created_at: string;
};
type Overview = {
  subscriptions: Subscription[];
  invoices: Invoice[];
  payments: Payment[];
};
type Expense = {
  id: string;
  expense_number: string;
  category: string;
  description: string;
  vendor: string | null;
  amount_ugx: string;
  expense_date: string;
  status: string;
  reference: string | null;
};
type Expenses = {
  summary: {
    paid_this_month: string;
    awaiting_payment: string;
    awaiting_approval: number;
  };
  expenses: Expense[];
};
type FinancialPosition = {
  opening_balance_configured?: boolean;
  opening_balance_locked?: boolean;
  opening_balance_history?: Array<{opening_balance_ugx:string;as_of_date:string;action:string;changed_at:string}>;
  opening_balance_ugx: string;
  as_of_date: string;
  customer_receipts_ugx: string;
  operating_payments_ugx: string;
  supplier_payments_ugx: string;
  receivables_ugx: string;
  payables_ugx: string;
  cash_position_ugx: string;
  committed_funds_ugx: string;
  available_to_commit_ugx: string;
};
type Response<T> = { data: T; message: string };
function roles() {
  try {
    return (
      JSON.parse(sessionStorage.getItem("currentUser") || "{}").roles?.join(
        ",",
      ) || "unknown"
    );
  } catch {
    return "unknown";
  }
}
function subscribe() {
  return () => undefined;
}
function label(v: string) {
  return v.replaceAll("_", " ");
}
function money(v: string | number) {
  return new Intl.NumberFormat("en-UG", {
    style: "currency",
    currency: "UGX",
    maximumFractionDigits: 0,
  }).format(Number(v));
}

export default function BillingPage() {
  const roleSnapshot = useSyncExternalStore(
    subscribe,
    roles,
    () => "hydrating",
  );
  const isCustomer = roleSnapshot.includes("citizen"),
    isCompanyAdmin = roleSnapshot.includes("company_admin"),
    hasOrganizationContext =
      isCompanyAdmin || roleSnapshot.includes("supervisor");
  const [plans, setPlans] = useState<Plan[]>([]),
    [overview, setOverview] = useState<Overview>({
      subscriptions: [],
      invoices: [],
      payments: [],
    });
  const [expenses, setExpenses] = useState<Expenses>({
    summary: {
      paid_this_month: "0",
      awaiting_payment: "0",
      awaiting_approval: 0,
    },
    expenses: [],
  });
  const [position, setPosition] = useState<FinancialPosition>({
    opening_balance_ugx: "0",
    as_of_date: new Date().toISOString().slice(0, 10),
    customer_receipts_ugx: "0",
    operating_payments_ugx: "0",
    supplier_payments_ugx: "0",
    receivables_ugx: "0",
    payables_ugx: "0",
    cash_position_ugx: "0",
    committed_funds_ugx: "0",
    available_to_commit_ugx: "0",
  });
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [financeTab, setFinanceTab] = useState<"income" | "expenses">("income");
  const [planForm, setPlanForm] = useState({
    name: "",
    description: "",
    customerType: "",
    billingFrequency: "monthly",
    feeUgx: "",
    collectionsPerPeriod: "4",
    responseHours: "24",
  });
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [recordingInvoice, setRecordingInvoice] = useState<Invoice | null>(
    null,
  );
  const [paymentDrafts, setPaymentDrafts] = useState<
    Record<string, { amount: string; provider: string; phone: string }>
  >({});
  const [subscriptionQuery, setSubscriptionQuery] = useState(""),
    [subscriptionStatus, setSubscriptionStatus] = useState("all");
  const [invoiceQuery, setInvoiceQuery] = useState(""),
    [invoiceStatus, setInvoiceStatus] = useState("all");
  const [paymentQuery, setPaymentQuery] = useState(""),
    [paymentStatus, setPaymentStatus] = useState("all");
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function load() {
    const [p, o] = await Promise.all([
      apiRequest<Response<Plan[]>>("/api/waste/billing/plans"),
      apiRequest<Response<Overview>>("/api/waste/billing/overview"),
    ]);
    setPlans(p.data);
    setOverview(o.data);
    if (!isCustomer) {
      const x = await apiRequest<Response<Expenses>>(
        "/api/waste/finance/expenses",
      );
      setExpenses(x.data);
      if (hasOrganizationContext) {
        const f = await apiRequest<Response<FinancialPosition>>(
          "/api/waste/finance/position",
        );
        setPosition(f.data);
      }
    }
  }
  async function saveOpeningBalance(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const f = new FormData(formElement);
    try {
      setSaving(true);
      setError("");
      const r = await apiRequest<Response<unknown>>(
        "/api/waste/finance/position/opening-balance",
        {
          method: "PUT",
          body: JSON.stringify({
            openingBalanceUgx: Number(f.get("openingBalanceUgx")),
            asOfDate: f.get("asOfDate"),
          }),
        },
      );
      setMessage(r.message);
      formElement.reset();
      setBalanceOpen(false);
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to update opening balance",
      );
    } finally {
      setSaving(false);
    }
  }
  // The role snapshot is the deliberate reload boundary for this session-scoped page.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (roleSnapshot === "hydrating" || roleSnapshot === "unknown") return;
    void load()
      .catch((e: unknown) =>
        setError(
          e instanceof Error ? e.message : "Failed to load Income & billing",
        ),
      )
      .finally(() => setLoading(false));
  }, [roleSnapshot]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  function resetPlanForm() {
    setEditingPlanId(null);
    setShowPlanModal(false);
    setPlanForm({
      name: "",
      description: "",
      customerType: "",
      billingFrequency: "monthly",
      feeUgx: "",
      collectionsPerPeriod: "4",
      responseHours: "24",
    });
  }
  function openCreatePlan() {
    resetPlanForm();
    setShowPlanModal(true);
  }
  function editPlan(plan: Plan) {
    setEditingPlanId(plan.id);
    setPlanForm({
      name: plan.name,
      description: plan.description || "",
      customerType: plan.customer_type || "",
      billingFrequency: plan.billing_frequency,
      feeUgx: plan.fee_ugx,
      collectionsPerPeriod: String(plan.collections_per_period),
      responseHours: String(plan.response_hours),
    });
    setShowPlanModal(true);
  }
  async function createPlan(e: FormEvent) {
    e.preventDefault();
    try {
      setSaving(true);
      setError("");
      setMessage("");
      const body = JSON.stringify({
        ...planForm,
        description: planForm.description || undefined,
        customerType: planForm.customerType || undefined,
        feeUgx: Number(planForm.feeUgx),
        collectionsPerPeriod: Number(planForm.collectionsPerPeriod),
        responseHours: Number(planForm.responseHours),
      });
      await apiRequest(
        editingPlanId
          ? `/api/waste/billing/plans/${editingPlanId}`
          : "/api/waste/billing/plans",
        { method: editingPlanId ? "PUT" : "POST", body },
      );
      setMessage(
        editingPlanId
          ? "Service package updated."
          : "Service package created and ready for contracts.",
      );
      resetPlanForm();
      await load();
    } catch (e) {
      setMessage("");
      setError(e instanceof Error ? e.message : "Failed to save package");
    } finally {
      setSaving(false);
    }
  }
  async function changePlanStatus(plan: Plan) {
    try {
      setSaving(true);
      setError("");
      setMessage("");
      await apiRequest(`/api/waste/billing/plans/${plan.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !plan.is_active }),
      });
      setMessage(
        `Service package ${plan.is_active ? "deactivated" : "activated"}.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update package");
    } finally {
      setSaving(false);
    }
  }
  async function pay(invoice: Invoice) {
    const d = paymentDrafts[invoice.id] || {
      amount: invoice.balance_ugx,
      provider: "mtn_momo",
      phone: "",
    };
    try {
      setSaving(true);
      setError("");
      const r = await apiRequest<Response<Payment>>(
        "/api/waste/billing/payments",
        {
          method: "POST",
          body: JSON.stringify({
            invoiceId: invoice.id,
            amountUgx: Number(d.amount),
            provider: d.provider,
            payerPhone: d.phone || undefined,
          }),
        },
      );
      setMessage(r.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to initiate payment");
    } finally {
      setSaving(false);
    }
  }
  async function confirm(paymentId: string) {
    try {
      setSaving(true);
      setError("");
      await apiRequest(`/api/waste/billing/payments/${paymentId}/confirm`, {
        method: "PATCH",
        body: JSON.stringify({}),
      });
      setMessage("Payment confirmed and invoice balance updated.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to confirm payment");
    } finally {
      setSaving(false);
    }
  }
  async function recordPayment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!recordingInvoice) return;
    const f = new FormData(e.currentTarget);
    try {
      setSaving(true);
      setError("");
      setMessage("");
      const r = await apiRequest<Response<unknown>>(
        "/api/waste/billing/payments/record",
        {
          method: "POST",
          body: JSON.stringify({
            invoiceId: recordingInvoice.id,
            amountUgx: Number(f.get("amountUgx")),
            provider: f.get("provider"),
            providerReference: f.get("providerReference"),
          }),
        },
      );
      setRecordingInvoice(null);
      setMessage(r.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record payment");
    } finally {
      setSaving(false);
    }
  }
  async function generateDueInvoices() {
    try {
      setSaving(true);
      setError("");
      setMessage("");
      const r = await apiRequest<Response<{ generated: number }>>(
        "/api/waste/billing/invoices/generate",
        { method: "POST" },
      );
      setMessage(r.message);
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to generate due invoices",
      );
    } finally {
      setSaving(false);
    }
  }
  async function changeSubscriptionStatus(
    subscription: Subscription,
    status: "active" | "suspended" | "cancelled",
  ) {
    if (
      status === "cancelled" &&
      !window.confirm(
        `Cancel ${subscription.customer_name}'s ${subscription.plan_name} service? Billing will stop and this cannot be resumed.`,
      )
    )
      return;
    try {
      setSaving(true);
      setError("");
      setMessage("");
      const r = await apiRequest<Response<Subscription>>(
        `/api/waste/billing/subscriptions/${subscription.id}/status`,
        { method: "PATCH", body: JSON.stringify({ status }) },
      );
      setMessage(r.message);
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to update customer service",
      );
    } finally {
      setSaving(false);
    }
  }
  async function createExpense(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement = e.currentTarget;
    const f = new FormData(formElement);
    try {
      setSaving(true);
      setError("");
      await apiRequest("/api/waste/finance/expenses", {
        method: "POST",
        body: JSON.stringify({
          category: f.get("category"),
          description: f.get("description"),
          vendor: f.get("vendor") || undefined,
          amountUgx: Number(f.get("amountUgx")),
          expenseDate: f.get("expenseDate"),
          reference: f.get("reference") || undefined,
        }),
      });
      setMessage("Expense submitted for approval.");
      formElement.reset();
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record expense");
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function changeExpense(id: string, status: string) {
    try {
      setSaving(true);
      setError("");
      setMessage("");
      await apiRequest(`/api/waste/finance/expenses/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setMessage(`Expense marked ${status}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update expense");
    } finally {
      setSaving(false);
    }
  }
  const outstanding = useMemo(
    () => overview.invoices.reduce((sum, i) => sum + Number(i.balance_ugx), 0),
    [overview.invoices],
  );
  const dueSubscriptions = useMemo(() => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return overview.subscriptions.filter(
      (s) =>
        s.status === "active" &&
        s.next_billing_date &&
        new Date(s.next_billing_date) <= today,
    ).length;
  }, [overview.subscriptions]);
  const filteredSubscriptions = useMemo(() => {
    const q = subscriptionQuery.trim().toLowerCase();
    return overview.subscriptions.filter(
      (s) =>
        (subscriptionStatus === "all" || s.status === subscriptionStatus) &&
        (!q ||
          `${s.customer_name} ${s.plan_name} ${s.billing_frequency}`
            .toLowerCase()
            .includes(q)),
    );
  }, [overview.subscriptions, subscriptionQuery, subscriptionStatus]);
  const filteredInvoices = useMemo(() => {
    const q = invoiceQuery.trim().toLowerCase();
    return overview.invoices.filter(
      (i) =>
        (invoiceStatus === "all" || i.status === invoiceStatus) &&
        (!q ||
          `${i.invoice_number} ${i.customer_name} ${i.plan_name}`
            .toLowerCase()
            .includes(q)),
    );
  }, [overview.invoices, invoiceQuery, invoiceStatus]);
  const filteredPayments = useMemo(() => {
    const q = paymentQuery.trim().toLowerCase();
    return overview.payments.filter(
      (p) =>
        (paymentStatus === "all" || p.status === paymentStatus) &&
        (!q ||
          `${p.invoice_number} ${p.customer_name} ${p.provider} ${p.provider_reference || ""}`
            .toLowerCase()
            .includes(q)),
    );
  }, [overview.payments, paymentQuery, paymentStatus]);
  const planPages = usePagination(plans),
    subscriptionPages = usePagination(filteredSubscriptions),
    invoicePages = usePagination(filteredInvoices),
    paymentPages = usePagination(filteredPayments);
  return (
    <AppShell>
      <div className="mx-auto max-w-7xl">
        <PageHeader eyebrow={isCustomer?"My service":"Organization revenue"} title={isCustomer?"Billing and payments":"Income & billing"} description={isCustomer?"Review your service fee, invoices, balance, and confirmed payments.":"Manage service packages, subscriptions, invoices, payments, and operating expenses."}/>
          {!isCustomer && (
            <nav aria-label="Finance sections" className="flex gap-6 border-b border-slate-300 pt-5">
              <button
                onClick={() => setFinanceTab("income")}
                className={`border-b-2 pb-2 text-sm font-bold ${financeTab === "income" ? "border-[#3156a3] text-[#3156a3]" : "border-transparent text-slate-500"}`}
              >
                Income & billing
              </button>
              <button
                onClick={() => setFinanceTab("expenses")}
                className={`border-b-2 pb-2 text-sm font-bold ${financeTab === "expenses" ? "border-[#3156a3] text-[#3156a3]" : "border-transparent text-slate-500"}`}
              >
                Expenses
              </button>
            </nav>
          )}
        {error&&<Feedback tone="error">{error}</Feedback>}
        {message&&<Feedback tone="success">{message}</Feedback>}
        {!loading&&isCompanyAdmin&&plans.length===0&&<section className="mt-8 border-y border-slate-300 py-6"><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#3156a3]">Required before contracts</p><div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h2 className="text-xl font-semibold">Create your first service package</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">A package defines the price, billing period, included collections and response target. Contracts can only use a package created here.</p></div><button onClick={openCreatePlan} className="bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white">Create service package</button></div></section>}
        {hasOrganizationContext && (
          <Modal
            open={balanceOpen}
            title="Opening cash balance"
            description="This is the starting cash and bank balance, not a top-up. Once receipts or payments are recorded, it is locked to preserve financial history."
            onClose={() => setBalanceOpen(false)}
          >
            <form onSubmit={saveOpeningBalance}>
              {error && <p role="alert" className="mb-4 border-l-2 border-red-600 pl-3 text-sm text-red-800">{error}</p>}
              {position.opening_balance_locked && <p className="mb-4 border-l-2 border-slate-400 pl-3 text-sm text-slate-600">Locked: money has already been recorded. Do not replace the opening balance to add funds or hide a deficit. A reviewed accounting adjustment is required.</p>}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-bold">
                  Opening balance (UGX)
                  <input
                    name="openingBalanceUgx"
                    disabled={position.opening_balance_locked}
                    required
                    type="number"
                    min="0"
                    defaultValue={position.opening_balance_ugx}
                    className="mt-1 w-full border p-3"
                  />
                </label>
                <label className="text-sm font-bold">
                  Balance as of
                  <input
                    name="asOfDate"
                    disabled={position.opening_balance_locked}
                    min="1970-01-01"
                    max={new Date().toISOString().slice(0,10)}
                    required
                    type="date"
                    defaultValue={position.opening_balance_configured ? position.as_of_date?.slice(0,10) : new Date().toISOString().slice(0,10)}
                    className="mt-1 w-full border p-3"
                  />
                </label>
              </div>
              <div className="mt-6 flex justify-end gap-3 border-t pt-4">
                <button
                  type="button"
                  onClick={() => setBalanceOpen(false)}
                  className="border px-4"
                >
                  Cancel
                </button>
                <button
                  disabled={saving || position.opening_balance_locked}
                  className="bg-[#3156a3] px-5 py-2.5 text-white disabled:opacity-50"
                >
                  {position.opening_balance_locked ? "Opening balance locked" : saving ? "Saving..." : "Save opening balance"}
                </button>
              </div>
            </form>
            {!!position.opening_balance_history?.length && <div className="mt-5 overflow-x-auto"><h3 className="mb-2 text-sm font-semibold">Opening balance history · latest 20</h3><table className="w-full text-left text-xs"><thead><tr className="border-b"><th className="py-2">Recorded</th><th>Action</th><th>Opening date</th><th className="text-right">Amount</th></tr></thead><tbody>{position.opening_balance_history.map((h,i)=><tr key={i} className="border-b"><td className="py-2">{new Date(h.changed_at).toLocaleString("en-GB")}</td><td>{h.action}</td><td>{new Date(h.as_of_date).toLocaleDateString("en-GB")}</td><td className="text-right">{money(h.opening_balance_ugx)}</td></tr>)}</tbody></table></div>}
          </Modal>
        )}
        {loading ? (
          <p className="py-8 text-slate-500">Loading billing information...</p>
        ) : (
          <>
            {hasOrganizationContext && (
              <section className="mt-8">
                <div className="flex items-end justify-between gap-4 pb-3">
                  <div>
                    <h2 className="text-xl font-semibold">
                      Financial position
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {position.opening_balance_configured ? `Verified cash movement since ${new Date(position.as_of_date).toLocaleDateString("en-GB")}` : "Opening balance not set; all recorded cash movements are included"}
                      . Approvals use available-to-commit funds; payments use
                      the actual cash balance.
                    </p>
                  </div>
                  {isCompanyAdmin && (
                    <button
                      onClick={() => { setError(""); setBalanceOpen(true); }}
                      className="border border-[#3156a3] px-4 py-2.5 text-sm font-semibold text-[#3156a3]"
                    >
                      {position.opening_balance_configured ? "View opening balance" : "Set opening balance"}
                    </button>
                  )}
                </div>
                <div className="grid border-y border-slate-300 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric
                    label="Cash balance"
                    value={money(position.cash_position_ugx)}
                  />
                  <Metric
                    label="Available to commit"
                    value={money(position.available_to_commit_ugx)}
                  />
                  <Metric
                    label="Committed funds"
                    value={money(position.committed_funds_ugx)}
                  />
                  <Metric
                    label="Customer receivables"
                    value={money(position.receivables_ugx)}
                  />
                </div>
                <p className="border-b py-3 text-xs text-slate-500">
                  Cash calculation: {money(position.opening_balance_ugx)}{" "}
                  opening + {money(position.customer_receipts_ugx)} received −{" "}
                  {money(position.operating_payments_ugx)} operating/payroll −{" "}
                  {money(position.supplier_payments_ugx)} supplier payments.
                  {" "}Committed funds include approved expenses and payroll,
                  supplier bills, and issued purchase orders not yet billed.
                </p>
                {Number(position.cash_position_ugx)<0&&<p className="border-l-4 border-red-600 bg-red-50 p-4 text-sm text-red-800"><strong>Cash deficit:</strong> recorded payments since the opening date exceed the opening balance and received income by {money(Math.abs(Number(position.cash_position_ugx)))}. New approvals and payments are blocked until the balance is corrected with verified funds or the underlying records are corrected.</p>}
                {Number(position.cash_position_ugx)>=0&&Number(position.available_to_commit_ugx)<0&&<p className="border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900"><strong>Overcommitted:</strong> approved obligations exceed cash by {money(Math.abs(Number(position.available_to_commit_ugx)))}. New approvals are blocked until commitments are voided, paid from additional verified funds, or the balance is corrected.</p>}
              </section>
            )}
            {financeTab === "income" && (
              <>
                <section className="grid gap-px border-y border-slate-300 bg-slate-300 sm:grid-cols-3 mt-8">
                  {[
                    [
                      "Active subscriptions",
                      overview.subscriptions.filter(
                        (s) => s.status === "active",
                      ).length,
                    ],
                    ["Outstanding balance", money(outstanding)],
                    [
                      "Pending payments",
                      overview.payments.filter((p) => p.status === "pending")
                        .length,
                    ],
                  ].map(([l, v]) => (
                    <div key={l} className="bg-[#f7f7f5] py-5 pr-5">
                      <p className="text-sm font-bold text-slate-500">{l}</p>
                      <p className="mt-2 text-3xl font-semibold">{v}</p>
                    </div>
                  ))}
                </section>
                <div className="py-8">
                  {isCompanyAdmin && (
                    <Modal
                      open={Boolean(recordingInvoice)}
                      title="Record received payment"
                      description={
                        recordingInvoice
                          ? `Apply a verified payment to ${recordingInvoice.invoice_number}. Outstanding: ${money(recordingInvoice.balance_ugx)}.`
                          : ""
                      }
                      onClose={() => setRecordingInvoice(null)}
                    >
                      <form onSubmit={recordPayment}>
                        <div className="space-y-4">
                          <label className="block text-sm font-bold">
                            Amount received (UGX)
                            <input
                              name="amountUgx"
                              required
                              type="number"
                              min="1"
                              max={recordingInvoice?.balance_ugx}
                              defaultValue={recordingInvoice?.balance_ugx}
                              className="mt-1 w-full border p-3"
                            />
                          </label>
                          <label className="block text-sm font-bold">
                            Payment method
                            <select
                              name="provider"
                              className="mt-1 w-full border p-3"
                            >
                              <option value="bank_transfer">
                                Bank transfer
                              </option>
                              <option value="cash">Cash</option>
                              <option value="mtn_momo">MTN MoMo</option>
                              <option value="airtel_money">Airtel Money</option>
                            </select>
                          </label>
                          <label className="block text-sm font-bold">
                            Receipt or transaction reference
                            <input
                              name="providerReference"
                              required
                              minLength={2}
                              maxLength={150}
                              className="mt-1 w-full border p-3"
                              placeholder="e.g. BANK-28491 or receipt number"
                            />
                          </label>
                        </div>
                        <div className="mt-6 flex justify-end gap-3 border-t pt-4">
                          <button
                            type="button"
                            onClick={() => setRecordingInvoice(null)}
                            className="border px-4 text-slate-600"
                          >
                            Cancel
                          </button>
                          <button
                            disabled={saving}
                            className="bg-[#3156a3] px-5 py-2.5 text-white disabled:opacity-50"
                          >
                            {saving ? "Recording..." : "Record payment"}
                          </button>
                        </div>
                      </form>
                    </Modal>
                  )}
                  {isCompanyAdmin && (
                    <Modal
                      open={showPlanModal}
                      title={
                        editingPlanId
                          ? "Edit service package"
                          : "Create service package"
                      }
                      description="Define the controlled price and service level used by contracts and invoices."
                      onClose={resetPlanForm}
                    >
                      <form onSubmit={createPlan}>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <label className="text-sm font-bold sm:col-span-2">
                            Package name
                            <input
                              required
                              value={planForm.name}
                              onChange={(e) =>
                                setPlanForm({
                                  ...planForm,
                                  name: e.target.value,
                                })
                              }
                              className="mt-1 w-full border p-3"
                            />
                          </label>
                          <label className="text-sm font-bold">
                            Customer type
                            <select
                              value={planForm.customerType}
                              onChange={(e) =>
                                setPlanForm({
                                  ...planForm,
                                  customerType: e.target.value,
                                })
                              }
                              className="mt-1 w-full border p-3"
                            >
                              <option value="">All customer types</option>
                              <option value="residential">Residential</option>
                              <option value="commercial">Commercial</option>
                              <option value="office_business">
                                Office / business
                              </option>
                              <option value="industrial">Industrial</option>
                            </select>
                          </label>
                          <label className="text-sm font-bold">
                            Billing frequency
                            <select
                              value={planForm.billingFrequency}
                              onChange={(e) =>
                                setPlanForm({
                                  ...planForm,
                                  billingFrequency: e.target.value,
                                })
                              }
                              className="mt-1 w-full border p-3"
                            >
                              <option value="monthly">Monthly</option>
                              <option value="quarterly">Quarterly</option>
                              <option value="annual">Annual</option>
                              <option value="on_demand">On demand</option>
                            </select>
                          </label>
                          <label className="text-sm font-bold">
                            Fee per billing period (UGX)
                            <input
                              required
                              min="0"
                              type="number"
                              value={planForm.feeUgx}
                              onChange={(e) =>
                                setPlanForm({
                                  ...planForm,
                                  feeUgx: e.target.value,
                                })
                              }
                              className="mt-1 w-full border p-3"
                            />
                          </label>
                          <label className="text-sm font-bold">
                            Collections per billing period
                            <input
                              required
                              min="1"
                              type="number"
                              value={planForm.collectionsPerPeriod}
                              onChange={(e) =>
                                setPlanForm({
                                  ...planForm,
                                  collectionsPerPeriod: e.target.value,
                                })
                              }
                              className="mt-1 w-full border p-3"
                            />
                          </label>
                          <label className="text-sm font-bold">
                            Response target (hours)
                            <input
                              required
                              min="1"
                              type="number"
                              value={planForm.responseHours}
                              onChange={(e) =>
                                setPlanForm({
                                  ...planForm,
                                  responseHours: e.target.value,
                                })
                              }
                              className="mt-1 w-full border p-3"
                            />
                          </label>
                          <label className="text-sm font-bold sm:col-span-2">
                            Description
                            <textarea
                              value={planForm.description}
                              onChange={(e) =>
                                setPlanForm({
                                  ...planForm,
                                  description: e.target.value,
                                })
                              }
                              className="mt-1 min-h-24 w-full border p-3"
                            />
                          </label>
                        </div>
                        <div className="mt-6 flex justify-end gap-3 border-t pt-4">
                          <button
                            type="button"
                            onClick={resetPlanForm}
                            className="border px-4 text-slate-600"
                          >
                            Cancel
                          </button>
                          <button
                            disabled={saving}
                            className="bg-[#3156a3] px-5 text-white disabled:opacity-50"
                          >
                            {editingPlanId ? "Save changes" : "Create package"}
                          </button>
                        </div>
                      </form>
                    </Modal>
                  )}
                  <div className="space-y-8">
                    <section>
                      <div className="flex items-end justify-between gap-4 pb-3">
                        <div>
                          <h2 className="text-xl font-semibold">
                            {isCustomer
                              ? "Available service packages"
                              : "Service packages"}
                          </h2>
                          <p className="mt-1 text-sm text-slate-500">
                            {isCustomer
                              ? "Your provider assigns a package through an approved contract. Charges begin only after activation."
                              : "Controlled commercial and service-level terms used by contracts."}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="table-count">
                            {plans.length} results
                          </span>
                          {isCompanyAdmin && (
                            <button
                              onClick={openCreatePlan}
                              className="bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white"
                            >
                              Create service package
                            </button>
                          )}
                        </div>
                      </div>
                      {plans.length ? (
                        <>
                          <div className="table-wrap">
                            <table className="min-w-[920px] text-left">
                              <thead>
                                <tr>
                                  <th>Package</th>
                                  <th>Customer type</th>
                                  <th>Billing</th>
                                  <th>Service level</th>
                                  <th>Usage</th>
                                  <th>Status</th>
                                  {isCompanyAdmin && (
                                    <th className="text-right">Actions</th>
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {planPages.paged.map((p) => (
                                  <tr key={p.id}>
                                    <td>
                                      <p className="table-primary">{p.name}</p>
                                      <p className="table-secondary">
                                        {p.description || p.organization_name}
                                      </p>
                                    </td>
                                    <td className="capitalize">
                                      {p.customer_type
                                        ? label(p.customer_type)
                                        : "All customers"}
                                    </td>
                                    <td>
                                      <p className="font-semibold">
                                        {money(p.fee_ugx)}
                                      </p>
                                      <p className="table-secondary capitalize">
                                        Per {label(p.billing_frequency)} period
                                      </p>
                                    </td>
                                    <td>
                                      {p.collections_per_period} collections
                                      <p className="table-secondary">
                                        {p.response_hours}h response
                                      </p>
                                    </td>
                                    <td>
                                      {p.contract_count || 0} contracts
                                      <p className="table-secondary">
                                        {p.subscription_count || 0} current
                                        subscriptions
                                      </p>
                                    </td>
                                    <td>
                                      <Status
                                        value={
                                          p.is_active ? "active" : "inactive"
                                        }
                                      />
                                    </td>
                                    {isCompanyAdmin && (
                                      <td>
                                        <div className="table-actions">
                                          <button
                                            disabled={
                                              saving ||
                                              Number(p.contract_count) > 0 ||
                                              Number(p.subscription_count) > 0
                                            }
                                            onClick={() => editPlan(p)}
                                            className="border px-3 disabled:opacity-35"
                                            title={
                                              Number(p.contract_count) > 0
                                                ? "Used packages cannot be repriced"
                                                : "Edit package"
                                            }
                                          >
                                            Edit
                                          </button>
                                          <button
                                            disabled={saving}
                                            onClick={() => changePlanStatus(p)}
                                            className={`border px-3 ${p.is_active ? "border-red-300 text-red-700" : "border-[#3156a3] text-[#3156a3]"}`}
                                          >
                                            {p.is_active
                                              ? "Deactivate"
                                              : "Activate"}
                                          </button>
                                        </div>
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <Pagination
                            page={planPages.page}
                            pageSize={planPages.pageSize}
                            total={planPages.total}
                            totalPages={planPages.totalPages}
                            onPage={planPages.setPage}
                            onPageSize={planPages.setPageSize}
                          />
                        </>
                      ) : (
                        <p className="p-5 text-sm text-slate-500">
                          No eligible service packages are available yet.
                        </p>
                      )}
                    </section>
                    <section>
                      <div className="flex items-end justify-between gap-4 pb-3">
                        <div>
                          <h2 className="text-xl font-semibold">
                            Customer subscriptions
                          </h2>
                          <p className="mt-1 text-sm text-slate-500">
                            Package access created by activated contracts.
                            Recurring invoices use the next billing date.
                          </p>
                        </div>
                        {isCompanyAdmin && (
                          <button
                            disabled={saving}
                            onClick={generateDueInvoices}
                            className="border border-[#3156a3] px-4 py-2.5 text-sm font-semibold text-[#3156a3] disabled:opacity-50"
                          >
                            {saving ? "Working..." : "Generate due invoices"}
                          </button>
                        )}
                      </div>
                      <div className="table-toolbar">
                        <input
                          type="search"
                          value={subscriptionQuery}
                          onChange={(e) => {
                            setSubscriptionQuery(e.target.value);
                            subscriptionPages.setPage(1);
                          }}
                          placeholder="Search customer or package"
                          aria-label="Search subscriptions"
                          className="table-search"
                        />
                        <select
                          value={subscriptionStatus}
                          onChange={(e) => {
                            setSubscriptionStatus(e.target.value);
                            subscriptionPages.setPage(1);
                          }}
                          aria-label="Filter subscription status"
                          className="border px-3 py-2"
                        >
                          <option value="all">All statuses</option>
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                        <span className="table-count">
                          {filteredSubscriptions.length} results ·{" "}
                          {dueSubscriptions} due
                        </span>
                      </div>
                      {filteredSubscriptions.length ? (
                        <>
                          <div className="table-wrap">
                            <table className="min-w-[900px] text-left">
                              <thead>
                                <tr>
                                  {!isCustomer && <th>Customer</th>}
                                  <th>Package</th>
                                  <th>Started</th>
                                  <th>Next billing</th>
                                  <th>Fee</th>
                                  <th>Status</th>
                                  {isCompanyAdmin && (
                                    <th className="text-right">Actions</th>
                                  )}
                                </tr>
                              </thead>
                              <tbody>
                                {subscriptionPages.paged.map((s) => (
                                  <tr key={s.id}>
                                    {!isCustomer && (
                                      <td className="table-primary">
                                        {s.customer_name}
                                      </td>
                                    )}
                                    <td>
                                      {s.plan_name}
                                      <p className="table-secondary capitalize">
                                        {label(s.billing_frequency)}
                                      </p>
                                    </td>
                                    <td>
                                      {new Date(s.starts_on).toLocaleDateString(
                                        "en-GB",
                                      )}
                                    </td>
                                    <td>
                                      {s.next_billing_date
                                        ? new Date(
                                            s.next_billing_date,
                                          ).toLocaleDateString("en-GB")
                                        : "On demand"}
                                    </td>
                                    <td className="font-semibold">
                                      {money(s.fee_ugx)}
                                    </td>
                                    <td>
                                      <Status value={s.status} />
                                    </td>
                                    {isCompanyAdmin && (
                                      <td>
                                        <div className="table-actions">
                                          {s.status === "active" && (
                                            <button
                                              disabled={saving}
                                              onClick={() =>
                                                changeSubscriptionStatus(
                                                  s,
                                                  "suspended",
                                                )
                                              }
                                              className="border px-3"
                                            >
                                              Suspend
                                            </button>
                                          )}
                                          {s.status === "suspended" && (
                                            <button
                                              disabled={saving}
                                              onClick={() =>
                                                changeSubscriptionStatus(
                                                  s,
                                                  "active",
                                                )
                                              }
                                              className="border border-[#3156a3] px-3 text-[#3156a3]"
                                            >
                                              Resume
                                            </button>
                                          )}
                                          {s.status !== "cancelled" && (
                                            <button
                                              disabled={saving}
                                              onClick={() =>
                                                changeSubscriptionStatus(
                                                  s,
                                                  "cancelled",
                                                )
                                              }
                                              className="border border-red-300 px-3 text-red-700"
                                            >
                                              Cancel
                                            </button>
                                          )}
                                        </div>
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <Pagination
                            page={subscriptionPages.page}
                            pageSize={subscriptionPages.pageSize}
                            total={subscriptionPages.total}
                            totalPages={subscriptionPages.totalPages}
                            onPage={subscriptionPages.setPage}
                            onPageSize={subscriptionPages.setPageSize}
                          />
                        </>
                      ) : (
                        <p className="border-y py-8 text-center text-sm text-slate-500">
                          {overview.subscriptions.length
                            ? "No subscriptions match this view."
                            : "No package subscriptions yet. Activate a package-linked contract to create one."}
                        </p>
                      )}
                    </section>
                    <section>
                      <h2 className="pb-3 text-xl font-semibold">Invoices</h2>
                      <div className="table-toolbar">
                        <input
                          type="search"
                          value={invoiceQuery}
                          onChange={(e) => {
                            setInvoiceQuery(e.target.value);
                            invoicePages.setPage(1);
                          }}
                          placeholder="Search invoice, customer or package"
                          aria-label="Search invoices"
                          className="table-search"
                        />
                        <select
                          value={invoiceStatus}
                          onChange={(e) => {
                            setInvoiceStatus(e.target.value);
                            invoicePages.setPage(1);
                          }}
                          aria-label="Filter invoice status"
                          className="border px-3 py-2"
                        >
                          <option value="all">All statuses</option>
                          <option value="issued">Issued</option>
                          <option value="partially_paid">Partially paid</option>
                          <option value="overdue">Overdue</option>
                          <option value="paid">Paid</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                        <span className="table-count">
                          {filteredInvoices.length} results
                        </span>
                      </div>
                      {filteredInvoices.length ? (
                        <>
                          <div className="table-wrap">
                            <table className="min-w-[920px] text-left">
                              <thead>
                                <tr>
                                  <th>Invoice</th>
                                  {!isCustomer && <th>Customer</th>}
                                  <th>Issued / due</th>
                                  <th className="text-right">Amount</th>
                                  <th className="text-right">Balance</th>
                                  <th>Status</th>
                                  <th className="text-right">Payment</th>
                                </tr>
                              </thead>
                              <tbody>
                                {invoicePages.paged.map((i) => (
                                  <tr key={i.id}>
                                    <td>
                                      <p className="table-primary">
                                        {i.invoice_number}
                                      </p>
                                      <p className="table-secondary">
                                        {i.plan_name}
                                      </p>
                                    </td>
                                    {!isCustomer && <td>{i.customer_name}</td>}
                                    <td>
                                      {new Date(i.issued_on).toLocaleDateString(
                                        "en-GB",
                                      )}
                                      <p className="table-secondary">
                                        Due{" "}
                                        {new Date(i.due_on).toLocaleDateString(
                                          "en-GB",
                                        )}
                                      </p>
                                    </td>
                                    <td className="text-right">
                                      {money(i.amount_ugx)}
                                    </td>
                                    <td className="text-right font-semibold">
                                      {money(i.balance_ugx)}
                                    </td>
                                    <td>
                                      <Status value={i.status} />
                                    </td>
                                    <td>
                                      {Number(i.balance_ugx) > 0 ? (
                                        isCustomer ? (
                                          <div className="table-actions">
                                            <input
                                              aria-label={`Amount for ${i.invoice_number}`}
                                              type="number"
                                              min="1"
                                              max={i.balance_ugx}
                                              value={
                                                paymentDrafts[i.id]?.amount ??
                                                i.balance_ugx
                                              }
                                              onChange={(e) =>
                                                setPaymentDrafts({
                                                  ...paymentDrafts,
                                                  [i.id]: {
                                                    amount: e.target.value,
                                                    provider:
                                                      paymentDrafts[i.id]
                                                        ?.provider ||
                                                      "mtn_momo",
                                                    phone:
                                                      paymentDrafts[i.id]
                                                        ?.phone || "",
                                                  },
                                                })
                                              }
                                              className="w-28 border px-2"
                                            />
                                            <select
                                              aria-label={`Provider for ${i.invoice_number}`}
                                              value={
                                                paymentDrafts[i.id]?.provider ||
                                                "mtn_momo"
                                              }
                                              onChange={(e) =>
                                                setPaymentDrafts({
                                                  ...paymentDrafts,
                                                  [i.id]: {
                                                    amount:
                                                      paymentDrafts[i.id]
                                                        ?.amount ||
                                                      i.balance_ugx,
                                                    provider: e.target.value,
                                                    phone:
                                                      paymentDrafts[i.id]
                                                        ?.phone || "",
                                                  },
                                                })
                                              }
                                              className="border px-2"
                                            >
                                              <option value="mtn_momo">
                                                MTN MoMo
                                              </option>
                                              <option value="airtel_money">
                                                Airtel Money
                                              </option>
                                            </select>
                                            <button
                                              disabled={saving}
                                              onClick={() => pay(i)}
                                              className="border border-[#3156a3] px-3 text-[#3156a3]"
                                            >
                                              Pay
                                            </button>
                                          </div>
                                        ) : isCompanyAdmin ? (
                                          <div className="table-actions">
                                            <button
                                              disabled={saving}
                                              onClick={() =>
                                                setRecordingInvoice(i)
                                              }
                                              className="border border-[#3156a3] px-3 text-[#3156a3]"
                                            >
                                              Record payment
                                            </button>
                                          </div>
                                        ) : (
                                          <span className="text-slate-400">
                                            —
                                          </span>
                                        )
                                      ) : (
                                        <span className="block text-right text-slate-400">
                                          Paid
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <Pagination
                            page={invoicePages.page}
                            pageSize={invoicePages.pageSize}
                            total={invoicePages.total}
                            totalPages={invoicePages.totalPages}
                            onPage={invoicePages.setPage}
                            onPageSize={invoicePages.setPageSize}
                          />
                        </>
                      ) : (
                        <p className="p-5 text-sm text-slate-500">
                          {overview.invoices.length
                            ? "No invoices match this view."
                            : "No invoices issued."}
                        </p>
                      )}
                    </section>
                    <section>
                      <h2 className="pb-3 text-xl font-semibold">
                        Payment history
                      </h2>
                      <div className="table-toolbar">
                        <input
                          type="search"
                          value={paymentQuery}
                          onChange={(e) => {
                            setPaymentQuery(e.target.value);
                            paymentPages.setPage(1);
                          }}
                          placeholder="Search invoice, customer or reference"
                          aria-label="Search payments"
                          className="table-search"
                        />
                        <select
                          value={paymentStatus}
                          onChange={(e) => {
                            setPaymentStatus(e.target.value);
                            paymentPages.setPage(1);
                          }}
                          aria-label="Filter payment status"
                          className="border px-3 py-2"
                        >
                          <option value="all">All statuses</option>
                          <option value="pending">Pending</option>
                          <option value="successful">Successful</option>
                          <option value="failed">Failed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                        <span className="table-count">
                          {filteredPayments.length} results
                        </span>
                      </div>
                      {filteredPayments.length ? (
                        <>
                          <div className="table-wrap">
                            <table className="min-w-[760px] text-left">
                              <thead>
                                <tr>
                                  <th>Payment</th>
                                  <th>Invoice</th>
                                  {!isCustomer && <th>Customer</th>}
                                  <th>Provider</th>
                                  <th>Date</th>
                                  <th>Status</th>
                                  <th className="text-right">Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {paymentPages.paged.map((p) => (
                                  <tr key={p.id}>
                                    <td className="table-primary">
                                      {money(p.amount_ugx)}
                                    </td>
                                    <td>{p.invoice_number}</td>
                                    {!isCustomer && <td>{p.customer_name}</td>}
                                    <td className="capitalize">
                                      {label(p.provider)}
                                      <p className="table-secondary">
                                        {p.provider_reference || "No reference"}
                                      </p>
                                    </td>
                                    <td>
                                      {new Date(
                                        p.created_at,
                                      ).toLocaleDateString("en-GB")}
                                    </td>
                                    <td>
                                      <Status value={p.status} />
                                    </td>
                                    <td>
                                      <div className="table-actions">
                                        {isCompanyAdmin &&
                                          p.status === "pending" && (
                                            <button
                                              disabled={saving}
                                              onClick={() => confirm(p.id)}
                                              className="border border-[#3156a3] px-3 text-[#3156a3]"
                                            >
                                              Confirm received
                                            </button>
                                          )}
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <Pagination
                            page={paymentPages.page}
                            pageSize={paymentPages.pageSize}
                            total={paymentPages.total}
                            totalPages={paymentPages.totalPages}
                            onPage={paymentPages.setPage}
                            onPageSize={paymentPages.setPageSize}
                          />
                        </>
                      ) : (
                        <p className="p-5 text-sm text-slate-500">
                          {overview.payments.length
                            ? "No payments match this view."
                            : "No payment activity yet."}
                        </p>
                      )}
                    </section>
                  </div>
                </div>
              </>
            )}
            {!isCustomer && financeTab === "expenses" && (
              <ExpenseWorkspace
                data={expenses}
                canApprove={isCompanyAdmin}
                saving={saving}
                cashBalance={Number(position.cash_position_ugx)}
                availableToCommit={Number(position.available_to_commit_ugx)}
                onCreate={createExpense}
                onStatus={changeExpense}
              />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function ExpenseWorkspace({
  data,
  canApprove,
  saving,
  cashBalance,
  availableToCommit,
  onCreate,
  onStatus,
}: {
  data: Expenses;
  canApprove: boolean;
  saving: boolean;
  cashBalance: number;
  availableToCommit: number;
  onCreate: (e: FormEvent<HTMLFormElement>) => Promise<boolean>;
  onStatus: (id: string, status: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.expenses.filter(
      (x) =>
        (status === "all" || x.status === status) &&
        (!q ||
          `${x.expense_number} ${x.description} ${x.vendor || ""} ${x.category} ${x.reference || ""}`
            .toLowerCase()
            .includes(q)),
    );
  }, [data.expenses, query, status]);
  const pages = usePagination(filtered);
  async function submit(e: FormEvent<HTMLFormElement>) {
    if (await onCreate(e)) setOpen(false);
  }
  return (
    <div className="py-8">
      <section className="grid border-y border-slate-300 md:grid-cols-3">
        <Metric
          label="Paid this month"
          value={money(data.summary.paid_this_month)}
        />
        <Metric
          label="Approved, unpaid"
          value={money(data.summary.awaiting_payment)}
        />
        <Metric
          label="Awaiting approval"
          value={String(data.summary.awaiting_approval)}
        />
      </section>
      <Modal
        open={open}
        title="Record an expense"
        description="Submit a verified operating cost for approval before payment."
        onClose={() => setOpen(false)}
      >
        <form onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-bold sm:col-span-2">
              Description
              <input
                name="description"
                required
                minLength={3}
                maxLength={240}
                className="mt-1 w-full border p-3"
              />
            </label>
            <label className="text-sm font-bold">
              Category
              <select name="category" className="mt-1 w-full border p-3">
                <option value="fuel">Fuel</option>
                <option value="maintenance">Maintenance</option>
                <option value="payroll">Payroll</option>
                <option value="equipment">Equipment</option>
                <option value="utilities">Utilities</option>
                <option value="disposal_fees">Disposal fees</option>
                <option value="office">Office</option>
                <option value="other">Other</option>
              </select>
            </label>
            <Field
              label="Amount (UGX)"
              name="amountUgx"
              type="number"
              required
            />
            <Field
              label="Expense date"
              name="expenseDate"
              type="date"
              required
            />
            <Field label="Vendor" name="vendor" />
            <label className="text-sm font-bold sm:col-span-2">
              Receipt or reference
              <input
                name="reference"
                maxLength={120}
                className="mt-1 w-full border p-3"
              />
            </label>
          </div>
          <div className="mt-6 flex justify-end gap-3 border-t pt-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="border px-4"
            >
              Cancel
            </button>
            <button
              disabled={saving}
              className="bg-[#3156a3] px-5 py-2.5 text-white disabled:opacity-50"
            >
              {saving ? "Submitting..." : "Submit for approval"}
            </button>
          </div>
        </form>
      </Modal>
      <section className="mt-8">
        <div className="flex items-end justify-between gap-4 pb-3">
          <div>
            <h2 className="text-xl font-semibold">Expense register</h2>
            <p className="mt-1 text-sm text-slate-500">
              Chronological operating costs and approval trail.
            </p>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white"
          >
            Record expense
          </button>
        </div>
        <div className="table-toolbar">
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              pages.setPage(1);
            }}
            placeholder="Search expense, vendor or reference"
            aria-label="Search expenses"
            className="table-search"
          />
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              pages.setPage(1);
            }}
            aria-label="Filter expense status"
            className="border px-3 py-2"
          >
            <option value="all">All statuses</option>
            <option value="draft">Awaiting approval</option>
            <option value="approved">Approved, unpaid</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </select>
          <span className="table-count">{filtered.length} results</span>
        </div>
        {filtered.length ? (
          <>
            <div className="table-wrap">
              <table className="min-w-[900px] text-left">
                <thead>
                  <tr>
                    <th>Date / number</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th>Vendor / reference</th>
                    <th className="text-right">Amount</th>
                    <th>Status</th>
                    {canApprove && <th className="text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {pages.paged.map((x) => (
                    <tr key={x.id}>
                      <td>
                        <p className="table-primary">
                          {new Date(x.expense_date).toLocaleDateString("en-GB")}
                        </p>
                        <p className="table-secondary">{x.expense_number}</p>
                      </td>
                      <td>{x.description}</td>
                      <td className="capitalize">{label(x.category)}</td>
                      <td>
                        {x.vendor || "—"}
                        <p className="table-secondary">
                          {x.reference || "No reference"}
                        </p>
                      </td>
                      <td className="text-right font-semibold">
                        {money(x.amount_ugx)}
                      </td>
                      <td>
                        <Status value={x.status} />
                      </td>
                      {canApprove && (
                        <td>
                          <div className="table-actions">
                            {x.status === "draft" && (
                              <button
                                disabled={saving || Number(x.amount_ugx)>availableToCommit}
                                aria-describedby={`expense-funding-${x.id}`}
                                title={Number(x.amount_ugx)>availableToCommit?`Needs ${money(x.amount_ugx)}, but only ${money(availableToCommit)} is available for approval.`:undefined}
                                onClick={() => onStatus(x.id, "approved")}
                                className="border border-[#3156a3] px-3 text-[#3156a3]"
                              >
                                Approve
                              </button>
                            )}
                            {x.status === "approved" && (
                              <button
                                disabled={saving || Number(x.amount_ugx)>cashBalance}
                                aria-describedby={`expense-funding-${x.id}`}
                                title={Number(x.amount_ugx)>cashBalance?`Needs ${money(x.amount_ugx)}, but cash balance is ${money(cashBalance)}.`:undefined}
                                onClick={() => {
                                  if (window.confirm(`Confirm ${money(x.amount_ugx)} has actually been paid for ${x.expense_number}? This records a cash outflow and cannot be voided from this page.`)) onStatus(x.id, "paid");
                                }}
                                className="border border-[#3156a3] px-3 text-[#3156a3]"
                              >
                                Mark paid
                              </button>
                            )}
                            {["draft", "approved"].includes(x.status) && (
                              <button
                                disabled={saving}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `Void ${x.expense_number}? This keeps the audit record but removes it from payment.`,
                                    )
                                  )
                                    onStatus(x.id, "void");
                                }}
                                className="border border-red-300 px-3 text-red-700"
                              >
                                Void
                              </button>
                            )}
                          </div>
                          <div id={`expense-funding-${x.id}`}>
                            {["draft", "approved"].includes(x.status) && <FundingShortfall amount={Number(x.amount_ugx)} available={x.status === "draft" ? availableToCommit : cashBalance} action={x.status === "draft" ? "approval" : "payment"} />}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={pages.page}
              pageSize={pages.pageSize}
              total={pages.total}
              totalPages={pages.totalPages}
              onPage={pages.setPage}
              onPageSize={pages.setPageSize}
            />
          </>
        ) : (
          <p className="border-y py-10 text-center text-sm text-slate-500">
            {data.expenses.length
              ? "No expenses match this view."
              : "No expenses have been recorded."}
          </p>
        )}
      </section>
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-5 md:border-r md:border-slate-300 md:last:border-r-0">
      <p className="text-sm font-bold text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
    </div>
  );
}
function Field({
  label,
  name,
  type = "text",
  required = false,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm font-bold">
      {label}
      <input
        name={name}
        type={type}
        required={required}
        min={type === "number" ? 1 : undefined}
        className="mt-1 w-full border border-slate-300 bg-white p-2.5"
      />
    </label>
  );
}
