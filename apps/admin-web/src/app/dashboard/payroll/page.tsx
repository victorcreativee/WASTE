"use client";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import {Feedback,Modal,PageHeader,Status} from "@/components/ui/System";
import {Pagination,usePagination} from "@/components/ui/Pagination";
import { apiRequest } from "@/lib/api";
import { FundingShortfall } from "@/components/ui/FundingShortfall";
type Period = {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  pay_date: string;
  status: string;
  staff_count: number;
  net_total_ugx: string;
};
type Line = {
  id: string;
  period_id: string;
  user_id: string;
  full_name: string;
  email: string;
  roles: string[];
  basic_pay_ugx: string;
  allowance_ugx: string;
  deduction_ugx: string;
  net_pay_ugx: string;
};
type Staff = {
  id: string;
  full_name: string;
  email: string;
  status: string;
  roles: string[];
};
type Data = { periods: Period[]; lines: Line[] };
type FinancialPosition = {
  cash_position_ugx: string;
  committed_funds_ugx: string;
  available_to_commit_ugx: string;
};
const money = (v: string | number) =>
  `UGX ${new Intl.NumberFormat("en-UG", { maximumFractionDigits: 0 }).format(Number(v || 0))}`;
export default function PayrollPage() {
  const [data, setData] = useState<Data>({ periods: [], lines: [] }),
    [position,setPosition]=useState<FinancialPosition>({cash_position_ugx:"0",committed_funds_ugx:"0",available_to_commit_ugx:"0"}),
    [staff, setStaff] = useState<Staff[]>([]),
    [selected, setSelected] = useState(""),
    [periodOpen,setPeriodOpen]=useState(false),[lineOpen,setLineOpen]=useState(false),[query,setQuery]=useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [saving, setSaving] = useState(false);
  const period = useMemo(
    () => data.periods.find((p) => p.id === selected) || data.periods[0],
    [data, selected],
  );
  const lines = useMemo(()=>data.lines.filter((l) => l.period_id === period?.id),[data.lines,period?.id]);
  const filteredLines=useMemo(()=>{const q=query.trim().toLowerCase();return lines.filter(l=>!q||`${l.full_name} ${l.email} ${l.roles.join(" ")}`.toLowerCase().includes(q));},[lines,query]);
  const pages=usePagination(filteredLines);
  async function load() {
    const [p, s, f] = await Promise.all([
      apiRequest<{ data: Data }>("/api/auth/organization-payroll"),
      apiRequest<{ data: Staff[] }>("/api/auth/organization-users"),
      apiRequest<{ data: FinancialPosition }>("/api/waste/finance/position"),
    ]);
    setData(p.data);
    setStaff(s.data);
    setPosition(f.data);
    setSelected((x) => x || p.data.periods[0]?.id || "");
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch((e) =>
      setError(e instanceof Error ? e.message : "Failed to load payroll"),
    );
  }, []);
  async function act(path: string, method: string, body: unknown, msg: string) {
    try {
      setSaving(true);
      setError("");
      setMessage("");
      await apiRequest(path, { method, body: JSON.stringify(body) });
      setMessage(msg);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payroll action failed");
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function createPeriod(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formElement=e.currentTarget;const f = new FormData(formElement);
    if(await act(
      "/api/auth/organization-payroll/periods",
      "POST",
      {
        name: f.get("name"),
        startsOn: f.get("startsOn"),
        endsOn: f.get("endsOn"),
        payDate: f.get("payDate"),
      },
      "Payroll period created.",
    )){formElement.reset();setPeriodOpen(false);}
  }
  async function saveLine(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!period) return;
    const formElement=e.currentTarget;const f = new FormData(formElement);
    if(await act(
      `/api/auth/organization-payroll/periods/${period.id}/lines`,
      "PUT",
      {
        userId: f.get("userId"),
        basicPayUgx: Number(f.get("basicPayUgx")),
        allowanceUgx: Number(f.get("allowanceUgx") || 0),
        deductionUgx: Number(f.get("deductionUgx") || 0),
        notes: f.get("notes") || undefined,
      },
      "Staff pay line saved.",
    )){formElement.reset();setLineOpen(false);}
  }
  return (
    <AppShell>
      <div className="mx-auto max-w-7xl">
        <PageHeader eyebrow="Workforce finance" title="Payroll" description="Prepare staff pay, review deductions, approve available funds, and record payment." action={<button onClick={()=>setPeriodOpen(true)} className="bg-[#3156a3] px-4 py-2.5 text-sm font-semibold text-white">New pay period</button>}/>
        <div className="mt-4 text-right"><a href="/dashboard/team" className="text-sm font-semibold text-[#3156a3]">Review staff and attendance →</a></div>
        {error&&<Feedback tone="error">{error}</Feedback>}
        {message&&<Feedback tone="success">{message}</Feedback>}
        <section className="mt-8 grid border-y border-slate-300 sm:grid-cols-3">
          <FinanceMetric label="Cash balance" value={money(position.cash_position_ugx)} />
          <FinanceMetric label="Already committed" value={money(position.committed_funds_ugx)} />
          <FinanceMetric label="Available for approval" value={money(position.available_to_commit_ugx)} />
        </section>
        <p className="border-b py-3 text-xs text-slate-500">Approving payroll reserves funds. Marking it paid requires enough cash on hand and records the payroll expense automatically.</p>
        <Modal open={periodOpen} title="New pay period" description="Create one non-overlapping payroll period. Pay date must be on or after the period end." onClose={()=>setPeriodOpen(false)}><form onSubmit={createPeriod}><div className="grid gap-4 sm:grid-cols-2"><Input name="name" label="Period name" required/><Input name="startsOn" label="Starts" type="date" required/><Input name="endsOn" label="Ends" type="date" required/><Input name="payDate" label="Pay date" type="date" required/></div><div className="mt-6 flex justify-end gap-3 border-t pt-4"><button type="button" onClick={()=>setPeriodOpen(false)} className="border px-4">Cancel</button><button disabled={saving} className="bg-[#3156a3] px-5 py-2.5 text-white disabled:opacity-50">{saving?"Creating...":"Create period"}</button></div></form></Modal>
        <Modal open={lineOpen&&Boolean(period)} title="Add or update staff pay" description={period?`Prepare an auditable pay line for ${period.name}. Deductions cannot exceed total earnings.`:""} onClose={()=>setLineOpen(false)}><form onSubmit={saveLine}><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">Staff member<select required name="userId" className="mt-1 w-full border p-2.5"><option value="">Choose staff</option>{staff.filter(s=>s.status==="active"&&!s.roles.includes("company_admin")).map(s=><option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label><Input name="basicPayUgx" label="Basic pay (UGX)" type="number" required/><Input name="allowanceUgx" label="Allowance (UGX)" type="number"/><Input name="deductionUgx" label="Deduction (UGX)" type="number"/><label className="text-sm font-bold sm:col-span-2">Notes<input name="notes" maxLength={500} className="mt-1 w-full border p-2.5"/></label></div><div className="mt-6 flex justify-end gap-3 border-t pt-4"><button type="button" onClick={()=>setLineOpen(false)} className="border px-4">Cancel</button><button disabled={saving} className="bg-[#3156a3] px-5 py-2.5 text-white disabled:opacity-50">{saving?"Saving...":"Save pay line"}</button></div></form></Modal>
        <section className="mt-8 grid gap-8 xl:grid-cols-[300px_1fr]">
          <aside>
            <div className="border-t border-slate-300 pt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Pay periods
              </p>
              {data.periods.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelected(p.id)}
                  className={`block w-full border-b py-3 text-left ${period?.id === p.id ? "text-[#3156a3]" : "text-slate-700"}`}
                >
                  <span className="font-semibold">{p.name}</span>
                  <span className="float-right"><Status value={p.status}/></span>
                  <p className="mt-1 text-xs text-slate-500">
                    {money(p.net_total_ugx)} · {p.staff_count} staff
                  </p>
                </button>
              ))}
            </div>
          </aside>
          <main>
            {!period ? (
              <p className="border-y py-12 text-center text-sm text-slate-500">
                Create the first payroll period to begin.
              </p>
            ) : (
              <>
                <div className="flex flex-col justify-between gap-4 border-b border-slate-300 pb-4 md:flex-row md:items-end">
                  <div>
                    <p className="text-xs font-bold uppercase text-slate-500">
                      {period.status} period
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold">
                      {period.name}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {new Date(period.starts_on).toLocaleDateString("en-GB")}–
                      {new Date(period.ends_on).toLocaleDateString("en-GB")} ·
                      pay{" "}
                      {new Date(period.pay_date).toLocaleDateString("en-GB")}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    {period.status === "draft" && <button onClick={()=>setLineOpen(true)} className="bg-[#3156a3] px-4 py-2 text-sm font-bold text-white">Add staff pay</button>}
                    {period.status === "draft" && (
                      <button
                        disabled={saving || !lines.length || Number(period.net_total_ugx)<=0 || Number(period.net_total_ugx)>Number(position.available_to_commit_ugx)}
                        aria-describedby="payroll-funding-feedback"
                        title={Number(period.net_total_ugx)>Number(position.available_to_commit_ugx)?`Needs ${money(period.net_total_ugx)}, but only ${money(position.available_to_commit_ugx)} is available for approval.`:undefined}
                        onClick={() =>
                          void act(
                            `/api/auth/organization-payroll/periods/${period.id}/status`,
                            "PATCH",
                            { status: "approved" },
                            "Payroll approved.",
                          )
                        }
                        className="border border-[#3156a3] px-4 py-2 text-sm font-bold text-[#3156a3] disabled:opacity-40"
                      >
                        Approve payroll
                      </button>
                    )}
                    {period.status === "approved" && (
                      <button
                        disabled={saving || Number(period.net_total_ugx)>Number(position.cash_position_ugx)}
                        aria-describedby="payroll-funding-feedback"
                        title={Number(period.net_total_ugx)>Number(position.cash_position_ugx)?`Needs ${money(period.net_total_ugx)}, but cash balance is ${money(position.cash_position_ugx)}.`:undefined}
                        onClick={() => {
                          if (!window.confirm(`Confirm ${money(period.net_total_ugx)} has actually been paid for ${period.name}? This records a cash outflow and cannot be cancelled from this page.`)) return;
                          void act(
                            `/api/auth/organization-payroll/periods/${period.id}/status`,
                            "PATCH",
                            { status: "paid" },
                            "Payroll marked paid.",
                          );
                        }}
                        className="bg-[#3156a3] px-4 py-2 text-sm font-bold text-white"
                      >
                        Mark paid
                      </button>
                    )}
                    {["draft","approved"].includes(period.status)&&<button disabled={saving} onClick={()=>{if(window.confirm(`Cancel ${period.name}? Pay lines will remain for audit but this period cannot be paid.`))void act(`/api/auth/organization-payroll/periods/${period.id}/status`,"PATCH",{status:"cancelled"},"Payroll cancelled.")}} className="border border-red-300 px-4 py-2 text-sm font-bold text-red-700">Cancel period</button>}
                  </div>
                </div>
                <div id="payroll-funding-feedback" aria-live="polite">
                  {period.status === "draft" && Number(period.net_total_ugx) <= 0 && <p className="mt-2 text-xs text-slate-600">Add staff pay with a positive net total before approving this period.</p>}
                  {["draft", "approved"].includes(period.status) && <FundingShortfall amount={Number(period.net_total_ugx)} available={Number(period.status === "draft" ? position.available_to_commit_ugx : position.cash_position_ugx)} action={period.status === "draft" ? "approval" : "payment"} />}
                </div>
                <div className="table-toolbar mt-5"><input type="search" value={query} onChange={e=>{setQuery(e.target.value);pages.setPage(1)}} placeholder="Search staff or role" aria-label="Search payroll lines" className="table-search"/><span className="table-count">{filteredLines.length} results</span></div>
                <div className="table-wrap">
                  <table className="min-w-[720px] text-left">
                    <thead>
                      <tr>
                        <th className="py-3">Staff</th>
                        <th className="text-right">Basic pay</th>
                        <th className="text-right">Allowance</th>
                        <th className="text-right">Deduction</th>
                        <th className="text-right">Net pay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pages.paged.map((l) => (
                        <tr key={l.id}>
                          <td className="py-4">
                            <p className="table-primary">{l.full_name}</p>
                            <p className="table-secondary">
                              {l.roles.join(", ").replaceAll("_", " ")}
                            </p>
                          </td>
                          <td className="text-right">
                            {money(l.basic_pay_ugx)}
                          </td>
                          <td className="text-right">
                            {money(l.allowance_ugx)}
                          </td>
                          <td className="text-right">
                            {money(l.deduction_ugx)}
                          </td>
                          <td className="text-right font-semibold">
                            {money(l.net_pay_ugx)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-slate-900">
                      <tr>
                        <td className="py-4 font-semibold">Payroll total</td>
                        <td
                          colSpan={4}
                          className="text-right text-lg font-semibold"
                        >
                          {money(period.net_total_ugx)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <Pagination page={pages.page} pageSize={pages.pageSize} total={pages.total} totalPages={pages.totalPages} onPage={pages.setPage} onPageSize={pages.setPageSize}/>
              </>
            )}
          </main>
        </section>
      </div>
    </AppShell>
  );
}
function FinanceMetric({label,value}:{label:string;value:string}){
  return <div className="px-1 py-4 sm:border-r sm:px-5 last:border-r-0"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold text-slate-900">{value}</p></div>;
}
function Input({
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
    <label className="block text-sm font-bold">
      {label}
      <input
        name={name}
        type={type}
        required={required}
        min={type === "number" ? 0 : undefined}
        className="mt-1 w-full border border-slate-300 bg-white p-2.5"
      />
    </label>
  );
}
