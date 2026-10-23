"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";

// Household self-service. A household opens its private link (/my?k=…) or signs in with its phone number and an SMS
// code; it stays signed in on that phone. Everything it needs is on one light page that works on a basic smartphone.

type Session = { user: { id: string; fullName: string; email: string; organizationId: string | null }; roles: { name: string }[]; tokens: { accessToken: string; refreshToken: string } };
type Overview = {
  household: { name: string; phone: string | null; customerNumber: string | null; address: string | null; zone: string | null; status: string; smsReminders: boolean };
  company: { name: string; phone: string | null; email: string | null } | null;
  plan: { name: string; fee_ugx: string; billing_frequency: string } | null;
  schedule: { weekdays: string[]; routes: string[]; upcoming: { scheduled_date: string; status: string }[] };
  collections: { id: string; scheduled_date: string; status: string; completed_at: string | null; exception_reason: string | null }[];
  invoices: { id: string; invoice_number: string; amount_ugx: string; balance_ugx: string; status: string; due_on: string; period_start: string | null; period_end: string | null }[];
  payments: { id: string; invoice_id: string | null; amount_ugx: string; provider: string; status: string; receipt_number: string | null; created_at: string }[];
  requests: { id: string; category: string; title: string; status: string; created_at: string; resolution_notes: string | null }[];
  messages: { id: string; title: string; body: string; created_at: string }[];
  balanceUgx: number;
};

const REFRESH_KEY = "kwms.household.refresh";
const ugx = (value: number | string) => `UGX ${Math.round(Number(value || 0)).toLocaleString("en-GB")}`;
const day = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
const shortDay = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const ISO_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The next date falling on one of the collection weekdays, from today. */
function nextRouteDay(weekdays: string[]) {
  const today = new Date();
  for (let offset = 0; offset < 8; offset++) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    if (weekdays.includes(ISO_WEEKDAYS[(date.getDay() + 6) % 7])) return { date, offset };
  }
  return null;
}

function store(session: Session) {
  sessionStorage.setItem("accessToken", session.tokens.accessToken);
  sessionStorage.setItem("refreshToken", session.tokens.refreshToken);
  sessionStorage.setItem("currentUser", JSON.stringify({ ...session.user, roles: session.roles.map((role) => role.name) }));
  try { localStorage.setItem(REFRESH_KEY, session.tokens.refreshToken); } catch { /* private browsing: stays signed in for this visit only */ }
}

async function post<T>(path: string, body: unknown) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ""}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({})) as { message?: string; data?: T };
  if (!response.ok) throw Object.assign(new Error(payload.message || "Something went wrong. Try again."), { status: response.status });
  return payload.data as T;
}

export default function HouseholdPage() {
  const [stage, setStage] = useState<"starting" | "phone" | "code" | "ready" | "unreachable">("starting");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const result = await apiRequest<{ data: Overview }>("/api/waste/households/me");
    setOverview(result.data);
    setStage("ready");
  }, []);

  const open = useCallback(async () => {
    setError("");
    try {
      const token = new URLSearchParams(window.location.search).get("k");
      if (token) {
        // The link is used once to sign in, then removed from the address bar so it is not left in history.
        window.history.replaceState(null, "", "/my");
        store(await post<Session>("/api/auth/households/link", { token }));
        return await load();
      }
      if (sessionStorage.getItem("accessToken")) return await load();
      const saved = (() => { try { return localStorage.getItem(REFRESH_KEY); } catch { return null; } })();
      if (saved) {
        store(await post<Session>("/api/auth/refresh", { refreshToken: saved }));
        return await load();
      }
      setStage("phone");
    } catch (cause) {
      // Only a refused sign-in signs the household out. A weak signal or a restarting server keeps the saved
      // sign-in, so the household is not sent back to the phone screen every time the network drops.
      const refused = (cause as { status?: number }).status === 401 || !sessionStorage.getItem("refreshToken");
      if (refused) {
        try { localStorage.removeItem(REFRESH_KEY); } catch { /* ignore */ }
        sessionStorage.removeItem("accessToken");
        setError(cause instanceof Error ? cause.message : "Sign in again.");
        setStage("phone");
      } else {
        setStage("unreachable");
      }
    }
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void open();
  }, [open]);

  async function sendCode() {
    setBusy(true); setError("");
    try { await post("/api/auth/households/code", { phone }); setStage("code"); setNotice("If this number is registered with a collection company, a 6-digit code is on its way by SMS."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not send a code."); }
    finally { setBusy(false); }
  }
  async function verifyCode() {
    setBusy(true); setError("");
    try { store(await post<Session>("/api/auth/households/code/verify", { phone, code })); setNotice(""); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "That code did not work."); }
    finally { setBusy(false); }
  }
  async function signOut() {
    const refreshToken = sessionStorage.getItem("refreshToken");
    try { await post("/api/auth/logout", { refreshToken, accessToken: sessionStorage.getItem("accessToken") }); } catch { /* signed out locally anyway */ }
    sessionStorage.clear();
    try { localStorage.removeItem(REFRESH_KEY); } catch { /* ignore */ }
    setOverview(null); setStage("phone");
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-lg px-4 pb-16 pt-5">
        <header className="mb-5 flex items-center gap-3">
          <Image src="/logo-mark-blue.svg" alt="" width={40} height={40} unoptimized className="h-10 w-10 rounded-[var(--ui-radius)]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{overview?.company?.name || "Kampala WMS"}</p>
            <p className="truncate text-sm text-slate-500">{overview ? `Household service · ${overview.household.name}` : "Household service"}</p>
          </div>
          {stage === "ready" ? <button onClick={() => void signOut()} className="text-sm font-medium text-slate-500 hover:text-slate-800">Sign out</button> : null}
        </header>

        {error ? <p role="alert" className="mb-4 rounded-[var(--ui-radius)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}
        {notice ? <p className="mb-4 rounded-[var(--ui-radius)] border border-blue-200 bg-[var(--color-action-soft)] px-4 py-3 text-sm text-[var(--color-action)]">{notice}</p> : null}

        {stage === "starting" ? <p className="py-16 text-center text-sm text-slate-500">Opening your household page…</p> : null}
        {stage === "unreachable" ? (
          <section className="rounded-[var(--ui-radius)] border border-slate-200 bg-white p-5 text-center shadow-sm">
            <p className="text-base font-semibold">Can&apos;t reach the service right now</p>
            <p className="mt-1 text-sm text-slate-600">Check your internet connection. You are still signed in.</p>
            <button onClick={() => { setStage("starting"); void open(); }} className="mt-4 rounded-[var(--ui-radius)] bg-[var(--color-action)] px-5 py-2.5 text-sm font-semibold text-white">Try again</button>
          </section>
        ) : null}

        {stage === "phone" || stage === "code" ? (
          <section className="rounded-[var(--ui-radius)] border border-slate-200 bg-white p-5 shadow-sm">
            <h1 className="text-xl font-semibold">Your waste collection</h1>
            <p className="mt-1 text-sm leading-6 text-slate-600">See your collection days and bills, pay by mobile money, and report a missed pickup.</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">Open the link your collection company sent you, or sign in with your phone number.</p>
            {stage === "phone" ? (
              <form className="mt-5 space-y-3" onSubmit={(event) => { event.preventDefault(); void sendCode(); }}>
                <label className="block text-sm font-medium">Mobile number
                  <input inputMode="tel" autoComplete="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0772 123 456"
                    className="mt-1 block w-full rounded-[var(--ui-radius)] border border-slate-300 px-3 py-3 text-base outline-none focus:border-[var(--color-action)] focus:ring-2 focus:ring-[var(--color-action-ring)]" />
                </label>
                <button disabled={busy} className="w-full rounded-[var(--ui-radius)] bg-[var(--color-action)] px-4 py-3 text-base font-semibold text-white hover:bg-[var(--color-action-hover)] disabled:opacity-60">{busy ? "Sending…" : "Send me a code"}</button>
              </form>
            ) : (
              <form className="mt-5 space-y-3" onSubmit={(event) => { event.preventDefault(); void verifyCode(); }}>
                <label className="block text-sm font-medium">6-digit code
                  <input inputMode="numeric" autoComplete="one-time-code" required maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="123456"
                    className="mt-1 block w-full rounded-[var(--ui-radius)] border border-slate-300 px-3 py-3 text-center text-2xl tracking-[0.4em] outline-none focus:border-[var(--color-action)] focus:ring-2 focus:ring-[var(--color-action-ring)]" />
                </label>
                <button disabled={busy || code.length !== 6} className="w-full rounded-[var(--ui-radius)] bg-[var(--color-action)] px-4 py-3 text-base font-semibold text-white hover:bg-[var(--color-action-hover)] disabled:opacity-60">{busy ? "Checking…" : "Sign in"}</button>
                <button type="button" onClick={() => { setStage("phone"); setCode(""); setNotice(""); }} className="w-full py-2 text-sm font-medium text-slate-600">Use a different number</button>
              </form>
            )}
          </section>
        ) : null}

        {stage === "ready" && overview ? <Dashboard overview={overview} reload={load} setNotice={setNotice} setError={setError} /> : null}
      </div>
    </main>
  );
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-[var(--ui-radius)] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-base font-semibold">{title}</h2>{action}</div>
      {children}
    </section>
  );
}

function Dashboard({ overview, reload, setNotice, setError }: { overview: Overview; reload: () => Promise<void>; setNotice: (text: string) => void; setError: (text: string) => void }) {
  const [paying, setPaying] = useState<string | null>(null);
  const [payPhone, setPayPhone] = useState(overview.household.phone || "");
  const [provider, setProvider] = useState<"mtn_momo" | "airtel_money">("mtn_momo");
  const [requestKind, setRequestKind] = useState<"missed_collection" | "pickup_request" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const planned = overview.schedule.upcoming[0];
  const routeNext = nextRouteDay(overview.schedule.weekdays);
  const next = planned ? planned.scheduled_date : routeNext ? routeNext.date.toLocaleDateString("en-CA") : null;
  const openInvoices = overview.invoices.filter((invoice) => Number(invoice.balance_ugx) > 0);
  // A payment the company has not confirmed yet: offering "pay" again would invite paying twice.
  const waitingFor = (invoiceId: string) => overview.payments.find((payment) => payment.invoice_id === invoiceId && !["successful", "failed", "cancelled"].includes(payment.status));
  const isToday = next === new Date().toLocaleDateString("en-CA");
  const announce = (text: string) => { setNotice(text); window.scrollTo({ top: 0, behavior: "smooth" }); };

  async function pay(invoiceId: string, amount: number) {
    setBusy(true); setError("");
    try {
      await apiRequest("/api/waste/billing/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceId, amountUgx: amount, provider, payerPhone: payPhone }) });
      setPaying(null);
      announce(`Payment of ${ugx(amount)} started. Approve it on your phone; your collection company confirms it and your receipt appears here.`);
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The payment could not be started."); }
    finally { setBusy(false); }
  }
  async function toggleSms(enabled: boolean) {
    setBusy(true); setError("");
    try {
      await apiRequest("/api/waste/households/me/sms", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your choice could not be saved."); }
    finally { setBusy(false); }
  }
  async function sendRequest() {
    if (!requestKind) return;
    setBusy(true); setError("");
    try {
      await apiRequest("/api/waste/households/me/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: requestKind, note: note.trim() || undefined }) });
      setRequestKind(null); setNote("");
      announce("Sent to your collection company. You can follow it under Your requests.");
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your request could not be sent."); }
    finally { setBusy(false); }
  }

  return (
    <>
      {!overview.company ? <p className="mb-4 rounded-[var(--ui-radius)] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Your household is not linked to a collection company yet. Contact the company that collects your waste.</p> : null}

      <section className="mb-4 rounded-[var(--ui-radius)] bg-[var(--color-action)] p-5 text-white shadow-sm">
        <p className="text-sm text-white/80">Next collection</p>
        <p className="mt-1 text-2xl font-semibold">{next ? `${isToday ? "Today, " : ""}${day(next)}` : "Not scheduled yet"}</p>
        <p className="mt-2 text-sm text-white/85">
          {overview.schedule.weekdays.length ? `Collection days: ${overview.schedule.weekdays.join(" and ")}` : "Your company has not set your collection days yet."}
        </p>
        {overview.household.address ? <p className="mt-1 text-sm text-white/70">{overview.household.address}</p> : null}
      </section>

      <Card title="Your bill" action={<span className={`text-sm font-semibold ${overview.balanceUgx > 0 ? "text-amber-700" : "text-emerald-700"}`}>{overview.balanceUgx > 0 ? `${ugx(overview.balanceUgx)} to pay` : "All paid"}</span>}>
        {overview.plan ? <p className="mb-3 text-sm text-slate-600">{overview.plan.name} · {ugx(overview.plan.fee_ugx)} {overview.plan.billing_frequency}</p> : null}
        {openInvoices.length ? openInvoices.map((invoice) => (
          <div key={invoice.id} className="border-t border-slate-100 py-3 first:border-t-0 first:pt-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{invoice.period_start && invoice.period_end ? `${shortDay(invoice.period_start)} – ${shortDay(invoice.period_end)}` : invoice.invoice_number}</p>
                <p className="text-xs text-slate-500">Due {shortDay(invoice.due_on)} · {invoice.invoice_number}</p>
              </div>
              <p className="text-sm font-semibold">{ugx(invoice.balance_ugx)}</p>
            </div>
            {waitingFor(invoice.id) ? (
              <p className="mt-2 rounded-[var(--ui-radius)] bg-amber-50 px-3 py-2 text-sm text-amber-900">Payment of {ugx(waitingFor(invoice.id)!.amount_ugx)} is waiting for your collection company to confirm it.</p>
            ) : paying === invoice.id ? (
              <div className="mt-3 space-y-3 rounded-[var(--ui-radius)] bg-slate-50 p-3">
                <div className="grid grid-cols-2 gap-2">
                  {([["mtn_momo", "MTN MoMo"], ["airtel_money", "Airtel Money"]] as const).map(([value, label]) => (
                    <button key={value} type="button" onClick={() => setProvider(value)} className={`rounded-[var(--ui-radius)] border px-3 py-2 text-sm font-medium ${provider === value ? "border-[var(--color-action)] bg-[var(--color-action-soft)] text-[var(--color-action)]" : "border-slate-300 bg-white"}`}>{label}</button>
                  ))}
                </div>
                <label className="block text-sm font-medium">Pay from this number
                  <input inputMode="tel" value={payPhone} onChange={(event) => setPayPhone(event.target.value)} className="mt-1 block w-full rounded-[var(--ui-radius)] border border-slate-300 px-3 py-2.5 text-base" />
                </label>
                <button disabled={busy || payPhone.trim().length < 7} onClick={() => void pay(invoice.id, Number(invoice.balance_ugx))} className="w-full rounded-[var(--ui-radius)] bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Starting…" : `Pay ${ugx(invoice.balance_ugx)}`}</button>
                <button type="button" onClick={() => setPaying(null)} className="w-full py-1 text-sm text-slate-600">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setPaying(invoice.id)} className="mt-2 rounded-[var(--ui-radius)] border border-[var(--color-action)] px-3 py-2 text-sm font-semibold text-[var(--color-action)]">Pay by mobile money</button>
            )}
          </div>
        )) : <p className="text-sm text-slate-600">Nothing to pay right now.</p>}
        {overview.payments.length ? (
          <details className="mt-3 border-t border-slate-100 pt-3">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">Payment history</summary>
            <ul className="mt-2 space-y-2">{overview.payments.map((payment) => (
              <li key={payment.id} className="flex justify-between gap-3 text-sm"><span>{shortDay(payment.created_at)} · {payment.status === "successful" ? (payment.receipt_number || "Paid") : "Waiting for confirmation"}</span><span className="font-medium">{ugx(payment.amount_ugx)}</span></li>
            ))}</ul>
          </details>
        ) : null}
      </Card>

      <Card title="Need help?">
        {requestKind ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">{requestKind === "missed_collection" ? "Report a missed collection" : "Request an extra pickup"}</p>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={500} placeholder={requestKind === "missed_collection" ? "Which day was missed? Anything the crew should know?" : "When would you like the pickup? How much waste?"}
              className="block w-full rounded-[var(--ui-radius)] border border-slate-300 px-3 py-2.5 text-base" />
            <button disabled={busy} onClick={() => void sendRequest()} className="w-full rounded-[var(--ui-radius)] bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Sending…" : "Send to my collection company"}</button>
            <button type="button" onClick={() => { setRequestKind(null); setNote(""); }} className="w-full py-1 text-sm text-slate-600">Cancel</button>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <button disabled={!overview.company} onClick={() => setRequestKind("missed_collection")} className="rounded-[var(--ui-radius)] border border-slate-300 px-4 py-3 text-left text-sm font-medium hover:bg-slate-50 disabled:opacity-50">My waste was not collected</button>
            <button disabled={!overview.company} onClick={() => setRequestKind("pickup_request")} className="rounded-[var(--ui-radius)] border border-slate-300 px-4 py-3 text-left text-sm font-medium hover:bg-slate-50 disabled:opacity-50">Request an extra pickup</button>
            {overview.company?.phone ? <a href={`tel:${overview.company.phone}`} className="rounded-[var(--ui-radius)] border border-slate-300 px-4 py-3 text-sm font-medium hover:bg-slate-50 sm:col-span-2">Call {overview.company.name} · {overview.company.phone}</a> : null}
          </div>
        )}
      </Card>

      {overview.requests.length ? (
        <Card title="Your requests">
          <ul className="space-y-3">{overview.requests.map((request) => (
            <li key={request.id} className="flex items-start justify-between gap-3 text-sm">
              <div><p className="font-medium">{request.title}</p><p className="text-xs text-slate-500">{shortDay(request.created_at)}{request.resolution_notes ? ` · ${request.resolution_notes}` : ""}</p></div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${request.status === "resolved" ? "bg-emerald-50 text-emerald-700" : request.status === "rejected" ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-800"}`}>
                {request.status === "resolved" ? "Done" : request.status === "rejected" ? "Closed" : request.status === "in_progress" ? "In progress" : "Received"}
              </span>
            </li>
          ))}</ul>
        </Card>
      ) : null}

      <Card title="Messages" action={
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" disabled={busy} checked={overview.household.smsReminders} onChange={(event) => void toggleSms(event.target.checked)} className="h-4 w-4 accent-[var(--color-action)]" />
          SMS reminders
        </label>}>
        {overview.messages.length ? <ul className="space-y-3">{overview.messages.map((message) => (
          <li key={message.id} className="text-sm">
            <p className="font-medium">{message.title} <span className="font-normal text-slate-500">· {shortDay(message.created_at)}</span></p>
            <p className="text-slate-600">{message.body}</p>
          </li>
        ))}</ul> : <p className="text-sm text-slate-600">Reminders from your collection company appear here: collection days, bills and payments.</p>}
        <p className="mt-3 text-xs text-slate-500">{overview.household.smsReminders ? "Your company may also send these by SMS to your phone." : "SMS reminders are off. Messages still appear here."}</p>
      </Card>

      <Card title="Recent collections">
        {overview.collections.length ? <ul className="space-y-2">{overview.collections.map((stop) => (
          <li key={stop.id} className="flex justify-between gap-3 text-sm">
            <span>{shortDay(stop.scheduled_date)}</span>
            <span className={stop.status === "completed" ? "font-medium text-emerald-700" : stop.status === "skipped" ? "font-medium text-amber-700" : "text-slate-500"}>
              {stop.status === "completed" ? "Collected" : stop.status === "skipped" ? `Not collected${stop.exception_reason ? ` · ${stop.exception_reason.replaceAll("_", " ")}` : ""}` : "Planned"}
            </span>
          </li>
        ))}</ul> : <p className="text-sm text-slate-600">Your collections will appear here.</p>}
      </Card>

      <p className="mt-6 text-center text-xs text-slate-500">{overview.household.customerNumber ? `Customer number ${overview.household.customerNumber}` : ""}</p>
    </>
  );
}
