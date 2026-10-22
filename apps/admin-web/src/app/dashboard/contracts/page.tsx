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
type Contract = {
  id: string;
  customer_id:string;
  plan_id:string|null;
  customer_number:string;
  contract_number: string;
  customer_name: string;
  customer_email: string;
  customer_type: string;
  service_name: string;
  plan_name: string | null;
  package_fee_ugx: string | null;
  starts_on: string;
  ends_on: string;
  billing_frequency: string;
  contract_value_ugx: string;
  collections_per_period: number;
  response_hours: number;
  status: string;
};
type Customer = {
  id: string;
  customer_number: string;
  full_name: string;
  email: string;
  customer_type: string;
  address:string;
  zone_name:string|null;
};
type Plan = {
  id: string;
  name: string;
  description: string | null;
  customer_type: string | null;
  billing_frequency: string;
  fee_ugx: string;
  collections_per_period: number;
  response_hours: number;
};
type Data = { contracts: Contract[]; customers: Customer[]; plans: Plan[] };
const money = (v: string | number) =>
  `UGX ${new Intl.NumberFormat("en-UG", { maximumFractionDigits: 0 }).format(Number(v || 0))}`;
const label = (v: string) => v.replaceAll("_", " ");
export default function ContractsPage() {
  const [data, setData] = useState<Data>({
      contracts: [],
      customers: [],
      plans: [],
    }),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [saving, setSaving] = useState(false),
    [selectedCustomer, setSelectedCustomer] = useState(""),
    [selectedPlan, setSelectedPlan] = useState(""),
    [startsOn,setStartsOn]=useState(""),
    [endsOn,setEndsOn]=useState("");
  const load = useCallback(async () => {
    const r = await apiRequest<{ data: Data }>("/api/waste/contracts");
    setData(r.data);
    const customerId=new URLSearchParams(window.location.search).get("customerId");
    if(customerId&&r.data.customers.some(customer=>customer.id===customerId)){const today=new Date(),end=new Date(today);end.setFullYear(end.getFullYear()+1);setSelectedCustomer(customerId);setStartsOn(today.toISOString().slice(0,10));setEndsOn(end.toISOString().slice(0,10));setOpen(true);window.history.replaceState({},"","/dashboard/contracts");}
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : "Failed to load contracts"),
    );
  }, [load]);
  const filtered = useMemo(
      () =>
        data.contracts.filter(
          (c) =>
            (filter === "all" || c.status === filter) &&
            `${c.contract_number} ${c.customer_name} ${c.service_name}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        ),
      [data.contracts, filter, query],
    ),
    pages = usePagination(filtered, 10),
    expiring = data.contracts.filter((c) => c.status === "expiring").length,
    active = data.contracts.filter((c) => c.status === "active").length,
    value = data.contracts
      .filter((c) => ["active", "expiring"].includes(c.status))
      .reduce((n, c) => n + Number(c.contract_value_ugx), 0),
    customer = data.customers.find((c) => c.id === selectedCustomer),
    eligiblePlans = data.plans.filter(
      (p) =>
        !customer ||
        !p.customer_type ||
        p.customer_type === customer.customer_type,
    ),
    plan = data.plans.find((p) => p.id === selectedPlan);
  async function act(path: string, method: string, body: unknown, msg: string) {
    try {
      setSaving(true);
      setError("");
      setMessage("");
      await apiRequest(path, { method, body: JSON.stringify(body) });
      setMessage(msg);
      setOpen(false);
      await load();
    } catch (e) {
      setMessage("");
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setSaving(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await act(
      "/api/waste/contracts",
      "POST",
      {
        customerId: selectedCustomer,
        planId: selectedPlan,
        startsOn,
        endsOn,
        notes: f.get("notes") || undefined,
      },
      "Contract created as draft. Review it, then activate to create the subscription and first invoice.",
    );
  }
  function openContract(customerId="") {const today=new Date(),end=new Date(today);end.setFullYear(end.getFullYear()+1);setSelectedCustomer(customerId);setSelectedPlan("");setStartsOn(today.toISOString().slice(0,10));setEndsOn(end.toISOString().slice(0,10));setError("");setOpen(true);}
  function renewContract(contract:Contract){const start=new Date(`${contract.ends_on.slice(0,10)}T00:00:00`);start.setDate(start.getDate()+1);const end=new Date(start);end.setFullYear(end.getFullYear()+1);end.setDate(end.getDate()-1);setSelectedCustomer(contract.customer_id);setSelectedPlan(contract.plan_id||"");setStartsOn(start.toISOString().slice(0,10));setEndsOn(end.toISOString().slice(0,10));setError("");setMessage("");setOpen(true);}
  return (
    <AppShell>
      <div className="mx-auto max-w-7xl">
        <OrganizationWorkspaceNav />
        <PageHeader
          eyebrow="Customer operations"
          title="Contracts & service levels"
          description="Assign a controlled service package to a customer, review the agreement, then activate billing."
          action={data.plans.length ? (
            <button
              onClick={() => openContract()}
              className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white"
            >
              New contract
            </button>
          ) : (
            <a href="/dashboard/billing" className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white">
              Create service package first
            </a>
          )}
        />
        {error && <Feedback tone="error">{error}</Feedback>}
        {message && <Feedback tone="success">{message}</Feedback>}
        <section className="mt-8 grid border-y sm:grid-cols-3">
          {[
            ["Active contracts", active],
            ["Expiring in 30 days", expiring],
            ["Active contract value", money(value)],
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
        <section className="mt-8 grid border-y sm:grid-cols-3">
          {[["Customers available",data.customers.length],["Service packages",data.plans.length],["Drafts awaiting activation",data.contracts.filter(c=>c.status==="draft").length]].map(([title,count])=><div key={String(title)} className="border-b py-4 pr-5 sm:border-b-0 sm:border-r"><p className="text-sm font-semibold text-slate-500">{title}</p><p className="mt-1 text-2xl font-semibold">{count}</p></div>)}
        </section>
        <Modal open={open} onClose={()=>!saving&&setOpen(false)} title="Create customer contract" description="Step 1: choose the customer. Step 2: apply a matching service package. Step 3: save the draft and activate it after review.">
          <form onSubmit={submit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold">
                Customer
                <select
                  required
                  value={selectedCustomer}
                  onChange={(e) => {
                    setSelectedCustomer(e.target.value);
                    setSelectedPlan("");
                  }}
                  className="mt-1 w-full border p-2.5"
                >
                  <option value="">Choose active customer</option>
                  {data.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name} · {c.customer_number}
                    </option>
                  ))}
                </select>
              </label>
              {customer&&<div className="border-l-2 border-slate-300 px-3 text-sm sm:col-span-2"><p className="font-semibold">{customer.full_name}</p><p className="mt-1 text-slate-500">{label(customer.customer_type)} · {customer.zone_name||"Zone review"} · {customer.address}</p></div>}
              <label className="text-sm font-semibold">
                Service package
                <select
                  required
                  value={selectedPlan}
                  disabled={!selectedCustomer}
                  onChange={(e) => setSelectedPlan(e.target.value)}
                  className="mt-1 w-full border p-2.5"
                >
                  <option value="">
                    {selectedCustomer
                      ? "Choose matching package"
                      : "Choose customer first"}
                  </option>
                  {eligiblePlans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {money(p.fee_ugx)} /{" "}
                      {label(p.billing_frequency)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold">Contract starts<input required type="date" value={startsOn} onChange={event=>setStartsOn(event.target.value)} className="mt-1 w-full border p-2.5"/></label>
              <label className="text-sm font-semibold">Contract ends<input required type="date" min={startsOn} value={endsOn} onChange={event=>setEndsOn(event.target.value)} className="mt-1 w-full border p-2.5"/></label>
              {plan && (
                <div className="border-l-2 border-[var(--color-action)] bg-blue-50 px-4 py-3 text-sm sm:col-span-2">
                  <p className="font-semibold">{plan.name}</p>
                  <p className="mt-1 text-slate-500">
                    {money(plan.fee_ugx)} per {label(plan.billing_frequency)} ·{" "}
                    {plan.collections_per_period} collections per period ·{" "}
                    {plan.response_hours}h response target
                  </p>
                </div>
              )}
              <div className="sm:col-span-2"><Field name="notes" label="Contract notes (optional)" /></div>
            </div>
            <div className="mt-6 flex justify-end gap-3 border-t pt-4"><button type="button" disabled={saving} onClick={()=>setOpen(false)} className="border border-slate-300 px-4 py-2.5 text-sm font-semibold">Cancel</button><button disabled={saving||!selectedCustomer||!selectedPlan||!startsOn||!endsOn||endsOn<startsOn} className="bg-[var(--color-action)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving?"Creating draft…":"Create contract draft"}</button></div>
          </form>
        </Modal>
        <section className="mt-8">
          <div className="table-toolbar">
            <input
              type="search"
              aria-label="Search contracts"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                pages.setPage(1);
              }}
              placeholder="Search contract, customer or package"
              className="table-search"
            />
            <select
              aria-label="Filter contract status"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                pages.setPage(1);
              }}
              className="border px-3 py-2"
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="expiring">Expiring</option>
              <option value="expired">Expired</option>
              <option value="suspended">Suspended</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <span className="table-count">{filtered.length} results</span>
          </div>
          {filtered.length ? (
            <>
              <div className="table-wrap">
                <table className="min-w-[1000px] text-left">
                  <thead>
                    <tr>
                      <th>Contract / customer</th>
                      <th>Package</th>
                      <th>Term</th>
                      <th>Service level</th>
                      <th className="text-right">Contract value</th>
                      <th>Status / action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pages.paged.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <p className="table-primary">{c.contract_number}</p>
                          <p>{c.customer_name}</p>
                          <p className="table-secondary">{c.customer_number} · {c.customer_email}</p>
                        </td>
                        <td>
                          {c.plan_name || c.service_name}
                          <p className="table-secondary capitalize">
                            {c.package_fee_ugx
                              ? `${money(c.package_fee_ugx)} / ${label(c.billing_frequency)}`
                              : label(c.billing_frequency)}
                          </p>
                        </td>
                        <td>
                          {new Date(c.starts_on).toLocaleDateString("en-GB")}
                          <p className="table-secondary">
                            to {new Date(c.ends_on).toLocaleDateString("en-GB")}
                          </p>
                        </td>
                        <td>
                          {c.collections_per_period} collections
                          <p className="table-secondary">
                            {c.response_hours}h response
                          </p>
                        </td>
                        <td className="text-right font-semibold">
                          {money(c.contract_value_ugx)}
                        </td>
                        <td>
                          <div className="flex flex-wrap items-center gap-2">
                            <Status value={c.status} />
                            {c.status === "draft" && (
                              <Step c={c} next="active" act={act} />
                            )}{" "}
                            {["active", "expiring"].includes(c.status) && (
                              <Step c={c} next="suspended" act={act} />
                            )}{" "}
                            {c.status === "suspended" && (
                              <Step c={c} next="active" act={act} />
                            )}{" "}
                            {["draft", "suspended"].includes(c.status) && (
                              <Step c={c} next="cancelled" act={act} />
                            )}
                            {["expiring","expired"].includes(c.status)&&c.plan_id&&<button disabled={saving} onClick={()=>renewContract(c)} className="border border-[var(--color-action)] px-3 py-2 text-xs font-semibold text-[var(--color-action)]">Renew</button>}
                          </div>
                        </td>
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
            <EmptyState
              title="No contracts match this view"
              description={
                data.contracts.length
                  ? "Clear the search or choose another status."
                  : "Create a service package first, then assign it to an active customer."
              }
            />
          )}
        </section>
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
        min={type === "number" ? 1 : undefined}
        className="mt-1 w-full border p-2.5"
      />
    </label>
  );
}
function Step({
  c,
  next,
  act,
}: {
  c: Contract;
  next: string;
  act: (p: string, m: string, b: unknown, x: string) => Promise<void>;
}) {
  const action =
    next === "active"
      ? "Activate"
      : next === "suspended"
        ? "Suspend"
        : "Cancel";
  return (
    <button
      onClick={() =>
        void act(
          `/api/waste/contracts/${c.id}/status`,
          "PATCH",
          { status: next },
          `Contract ${next === "active" ? "activated" : `marked ${next}`}.`,
        )
      }
      className="border border-[var(--color-action)] px-3 py-2 text-xs font-semibold text-[var(--color-action)]"
    >
      {action}
    </button>
  );
}
