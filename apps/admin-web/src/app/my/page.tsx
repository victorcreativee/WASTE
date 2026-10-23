"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import { Collector, HOUSEHOLD_REFRESH_KEY as REFRESH_KEY, HouseholdSession as Session, inKampala, matchLabel, publicGet, publicPost as post, storeHouseholdSession as store } from "@/lib/household-session";

// Customer self-service for homes, offices and businesses. A customer signs in with phone and password, opens the
// private link its collection company sent, or (where SMS is configured) uses a one-time code; it stays signed in on
// that phone. Customers who signed up themselves choose their company here until one accepts them.

type ServiceRequest = { id: string; status: string; review_note: string | null; created_at: string; company_name: string; company_phone: string | null };
type Overview = {
  household: { name: string; phone: string | null; customerNumber: string | null; address: string | null; zone: string | null; status: string; smsReminders: boolean; locationPrecise: boolean; divisionId: string | null; areaId: string | null };
  company: { name: string; phone: string | null; email: string | null } | null;
  plan: { name: string; fee_ugx: string; billing_frequency: string } | null;
  schedule: { weekdays: string[]; routes: string[]; upcoming: { scheduled_date: string; status: string }[] };
  collections: { id: string; scheduled_date: string; status: string; completed_at: string | null; exception_reason: string | null }[];
  invoices: { id: string; invoice_number: string; amount_ugx: string; balance_ugx: string; status: string; due_on: string; period_start: string | null; period_end: string | null }[];
  payments: { id: string; invoice_id: string | null; amount_ugx: string; provider: string; status: string; receipt_number: string | null; created_at: string }[];
  requests: { id: string; category: string; title: string; status: string; created_at: string; resolution_notes: string | null }[];
  messages: { id: string; title: string; body: string; created_at: string }[];
  serviceRequest: ServiceRequest | null;
  balanceUgx: number;
};

const ugx = (value: number | string) => `UGX ${Math.round(Number(value || 0)).toLocaleString("en-GB")}`;
const day = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
// Dates ("2026-10-24") are calendar days; timestamps are shown in the phone's own time zone.
const shortDay = (value: string) => new Date(value.length > 10 ? value : `${value}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
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

export default function HouseholdPage() {
  const [stage, setStage] = useState<"starting" | "password" | "phone" | "code" | "ready" | "unreachable">("starting");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
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
      setStage("password");
    } catch (cause) {
      // Only a refused sign-in signs the household out. A weak signal or a restarting server keeps the saved
      // sign-in, so the household is not sent back to the phone screen every time the network drops.
      const refused = (cause as { status?: number }).status === 401 || !sessionStorage.getItem("refreshToken");
      if (refused) {
        try { localStorage.removeItem(REFRESH_KEY); } catch { /* ignore */ }
        sessionStorage.removeItem("accessToken");
        setError(cause instanceof Error ? cause.message : "Sign in again.");
        setStage("password");
      } else {
        setStage("unreachable");
      }
    }
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void open();
  }, [open]);

  async function signIn() {
    setBusy(true); setError("");
    try { store(await post<Session>("/api/auth/households/password", { phone, password })); setPassword(""); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sign in."); }
    finally { setBusy(false); }
  }
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
    setOverview(null); setStage("password");
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

        {stage === "password" || stage === "phone" || stage === "code" ? (
          <section className="rounded-[var(--ui-radius)] border border-slate-200 bg-white p-5 shadow-sm">
            <h1 className="text-xl font-semibold">Your waste collection</h1>
            <p className="mt-1 text-sm leading-6 text-slate-600">See your collection days and bills, pay by mobile money, and report a missed pickup or a problem.</p>
            {stage === "password" ? (
              <form className="mt-5 space-y-3" onSubmit={(event) => { event.preventDefault(); void signIn(); }}>
                <label className="block text-sm font-medium">Mobile number
                  <input inputMode="tel" autoComplete="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0772 123 456"
                    className="mt-1 block w-full rounded-[var(--ui-radius)] border border-slate-300 px-3 py-3 text-base outline-none focus:border-[var(--color-action)] focus:ring-2 focus:ring-[var(--color-action-ring)]" />
                </label>
                <label className="block text-sm font-medium">Password
                  <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)}
                    className="mt-1 block w-full rounded-[var(--ui-radius)] border border-slate-300 px-3 py-3 text-base outline-none focus:border-[var(--color-action)] focus:ring-2 focus:ring-[var(--color-action-ring)]" />
                </label>
                <button disabled={busy} className="w-full rounded-[var(--ui-radius)] bg-[var(--color-action)] px-4 py-3 text-base font-semibold text-white hover:bg-[var(--color-action-hover)] disabled:opacity-60">{busy ? "Signing in…" : "Sign in"}</button>
                <button type="button" onClick={() => { setStage("phone"); setError(""); }} className="w-full py-1 text-sm font-medium text-slate-600">Sign in with an SMS code instead</button>
                <p className="border-t border-slate-100 pt-4 text-center text-sm text-slate-600">New here? <Link href="/join" className="font-semibold text-[var(--color-action)]">Create an account</Link></p>
                <p className="text-center text-xs text-slate-500">Registered by your collection company? Open the link it sent you.</p>
              </form>
            ) : stage === "phone" ? (
              <form className="mt-5 space-y-3" onSubmit={(event) => { event.preventDefault(); void sendCode(); }}>
                <label className="block text-sm font-medium">Mobile number
                  <input inputMode="tel" autoComplete="tel" required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0772 123 456"
                    className="mt-1 block w-full rounded-[var(--ui-radius)] border border-slate-300 px-3 py-3 text-base outline-none focus:border-[var(--color-action)] focus:ring-2 focus:ring-[var(--color-action-ring)]" />
                </label>
                <button disabled={busy} className="w-full rounded-[var(--ui-radius)] bg-[var(--color-action)] px-4 py-3 text-base font-semibold text-white hover:bg-[var(--color-action-hover)] disabled:opacity-60">{busy ? "Sending…" : "Send me a code"}</button>
                <button type="button" onClick={() => { setStage("password"); setError(""); }} className="w-full py-1 text-sm font-medium text-slate-600">Sign in with a password</button>
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
  const [requestKind, setRequestKind] = useState<"missed_collection" | "pickup_request" | "service_complaint" | null>(null);
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
      announce(requestKind === "service_complaint" ? "Your complaint was sent to your collection company. You can follow it under Your requests." : "Sent to your collection company. You can follow it under Your requests.");
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your request could not be sent."); }
    finally { setBusy(false); }
  }

  return (
    <>
      {!overview.company ? <ChooseCompany request={overview.serviceRequest} household={overview.household} reload={reload} announce={announce} setError={setError} /> : <>
      {!overview.household.locationPrecise ? <ShareLocation reload={reload} announce={announce} setError={setError} /> : null}

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
            <p className="text-sm font-medium">{requestKind === "missed_collection" ? "Report a missed collection" : requestKind === "service_complaint" ? "Make a complaint" : "Request an extra pickup"}</p>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={500} required={requestKind === "service_complaint"} placeholder={requestKind === "missed_collection" ? "Which day was missed? Anything the crew should know?" : requestKind === "service_complaint" ? "What happened, and when?" : "When would you like the pickup? How much waste?"}
              className="block w-full rounded-[var(--ui-radius)] border border-slate-300 px-3 py-2.5 text-base" />
            <button disabled={busy || (requestKind === "service_complaint" && note.trim().length < 5)} onClick={() => void sendRequest()} className="w-full rounded-[var(--ui-radius)] bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Sending…" : "Send to my collection company"}</button>
            <button type="button" onClick={() => { setRequestKind(null); setNote(""); }} className="w-full py-1 text-sm text-slate-600">Cancel</button>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <button disabled={!overview.company} onClick={() => setRequestKind("missed_collection")} className="rounded-[var(--ui-radius)] border border-slate-300 px-4 py-3 text-left text-sm font-medium hover:bg-slate-50 disabled:opacity-50">My waste was not collected</button>
            <button disabled={!overview.company} onClick={() => setRequestKind("pickup_request")} className="rounded-[var(--ui-radius)] border border-slate-300 px-4 py-3 text-left text-sm font-medium hover:bg-slate-50 disabled:opacity-50">Request an extra pickup</button>
            <button disabled={!overview.company} onClick={() => setRequestKind("service_complaint")} className="rounded-[var(--ui-radius)] border border-slate-300 px-4 py-3 text-left text-sm font-medium hover:bg-slate-50 disabled:opacity-50 sm:col-span-2">Make a complaint</button>
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
      </>}

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

      <PasswordCard setNotice={announce} setError={setError} />

      <p className="mt-6 text-center text-xs text-slate-500">{overview.household.customerNumber ? `Customer number ${overview.household.customerNumber}` : ""}</p>
    </>
  );
}

/** Until a company serves the customer: the request waiting for an answer, or the companies to choose from. */
function ChooseCompany({ request, household, reload, announce, setError }: { request: ServiceRequest | null; household: Overview["household"]; reload: () => Promise<void>; announce: (text: string) => void; setError: (text: string) => void }) {
  const waiting = request?.status === "pending_new_provider" || request?.status === "pending_current_provider";
  const [collectors, setCollectors] = useState<Collector[] | null>(null);
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [changingArea, setChangingArea] = useState(false);
  const place = `${household.divisionId}:${household.areaId}:${household.locationPrecise}`;

  useEffect(() => {
    if (waiting) return;
    apiRequest<{ data: Collector[] }>("/api/waste/customer-service/provider-options")
      .then((result) => { setCollectors(result.data); setChoice(result.data.length === 1 ? result.data[0].id : ""); })
      .catch(() => setCollectors([]));
  }, [waiting, place]);

  async function send() {
    setBusy(true); setError("");
    try {
      await apiRequest("/api/waste/customer-service/provider-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: choice, note: note.trim() || undefined }) });
      announce("Request sent. The company will contact you, then accept your request here.");
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your request could not be sent."); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!request) return;
    setBusy(true); setError("");
    try { await apiRequest(`/api/waste/customer-service/provider-requests/${request.id}`, { method: "DELETE" }); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The request could not be cancelled."); }
    finally { setBusy(false); }
  }

  if (waiting && request) return (
    <Card title="Waiting for your company">
      <p className="text-sm leading-6 text-slate-700">You asked <span className="font-semibold">{request.company_name}</span> to collect your waste on {shortDay(request.created_at)}. They will contact you, then accept your request here.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {request.company_phone ? <a href={`tel:${request.company_phone}`} className="rounded-[var(--ui-radius)] border border-[var(--color-action)] px-3 py-2 text-sm font-semibold text-[var(--color-action)]">Call {request.company_phone}</a> : null}
        <button disabled={busy} onClick={() => void cancel()} className="rounded-[var(--ui-radius)] border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-60">Cancel request</button>
      </div>
    </Card>
  );
  return (
    <Card title="Choose your collection company">
      {request?.status === "rejected" ? <p className="mb-3 rounded-[var(--ui-radius)] bg-amber-50 px-3 py-2 text-sm text-amber-900">{request.company_name} could not take your request{request.review_note ? `: ${request.review_note}` : "."} Choose another company below.</p> : null}
      {collectors === null ? <p className="text-sm text-slate-500">Finding companies near you…</p> : collectors.length ? (
        <div className="space-y-3">
          <div className="space-y-2" role="radiogroup" aria-label="Collection companies">
            {collectors.map((collector) => (
              <button key={collector.id} type="button" role="radio" aria-checked={choice === collector.id} onClick={() => setChoice(collector.id)}
                className={`block w-full rounded-[var(--ui-radius)] border p-3 text-left ${choice === collector.id ? "border-[var(--color-action)] bg-[var(--color-action-soft)]" : "border-slate-300 hover:bg-slate-50"}`}>
                <span className="flex items-start justify-between gap-3"><span className="text-sm font-semibold">{collector.name}</span>{collector.from_fee_ugx ? <span className="shrink-0 text-xs text-slate-600">from {ugx(collector.from_fee_ugx)}/month</span> : null}</span>
                <span className={`mt-0.5 block text-xs ${collector.match === "division" ? "text-slate-500" : "text-emerald-700"}`}>{matchLabel(collector)}{collector.phone ? ` · ${collector.phone}` : ""}</span>
              </button>
            ))}
          </div>
          {choice ? <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={500} placeholder="Message to the company (optional): how much waste, which days suit you" className="block w-full rounded-[var(--ui-radius)] border border-slate-300 px-3 py-2.5 text-base" /> : null}
          <button disabled={busy || !choice} onClick={() => void send()} className="w-full rounded-[var(--ui-radius)] bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Sending…" : "Ask this company to collect"}</button>
        </div>
      ) : <p className="text-sm leading-6 text-slate-600">No collection company serves your area yet. Check back soon, or ask a company near you to register on Kampala WMS.</p>}
      {changingArea
        ? <ChangeArea household={household} done={async (saved) => { setChangingArea(false); if (saved) { announce("Your area is saved."); await reload(); } }} setError={setError} />
        : <button type="button" onClick={() => setChangingArea(true)} className="mt-3 text-sm font-medium text-[var(--color-action)]">Wrong area? Change it</button>}
    </Card>
  );
}

type Division = { id: string; name: string; areas: { id: string; name: string }[] };

/** Before a company serves the household: correct the division, area and address chosen at sign-up. */
function ChangeArea({ household, done, setError }: { household: Overview["household"]; done: (saved: boolean) => Promise<void>; setError: (text: string) => void }) {
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [divisionId, setDivisionId] = useState(household.divisionId || "");
  const [areaId, setAreaId] = useState(household.areaId || "");
  const [address, setAddress] = useState(household.address || "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { publicGet<Division[]>("/api/waste/public/areas").then(setDivisions).catch(() => setError("Areas could not be loaded.")); }, [setError]);
  const division = divisions.find((item) => item.id === divisionId);
  async function save() {
    setBusy(true); setError("");
    try {
      await apiRequest("/api/waste/households/me/place", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ divisionId, areaId: areaId || null, address: address.trim() }) });
      await done(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your area could not be saved."); }
    finally { setBusy(false); }
  }
  const input = "mt-1 block w-full rounded-[var(--ui-radius)] border border-slate-300 bg-white px-3 py-2.5 text-base";
  return (
    <form className="mt-4 space-y-3 border-t border-slate-100 pt-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="block text-sm font-medium">Division
        <select required value={divisionId} onChange={(event) => { setDivisionId(event.target.value); setAreaId(""); }} className={input}>
          <option value="">Choose your division</option>
          {divisions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium">Area
        <select value={areaId} onChange={(event) => setAreaId(event.target.value)} className={input}>
          <option value="">My area is not listed</option>
          {division?.areas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium">Street, building or landmark
        <input required minLength={5} maxLength={300} value={address} onChange={(event) => setAddress(event.target.value)} className={input} />
      </label>
      <button disabled={busy || !divisionId} className="w-full rounded-[var(--ui-radius)] bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Save my area"}</button>
      <button type="button" onClick={() => void done(false)} className="w-full py-1 text-sm text-slate-600">Cancel</button>
    </form>
  );
}

/** The company placed the household at its zone's centre; the household shares its real position for the crew. */
function ShareLocation({ reload, announce, setError }: { reload: () => Promise<void>; announce: (text: string) => void; setError: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  function share() {
    if (!navigator.geolocation) { setError("This phone's browser cannot share its location. Your collection company can record it on its next visit."); return; }
    setBusy(true); setError("");
    navigator.geolocation.getCurrentPosition(async (result) => {
      try {
        if (!inKampala(result.coords.latitude, result.coords.longitude)) throw new Error("Your phone's location is outside Kampala. Share it when you are at the place to be collected from.");
        await apiRequest("/api/waste/households/me/place", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ latitude: result.coords.latitude, longitude: result.coords.longitude }) });
        announce("Thank you. The collection crew can now find you on the map.");
        await reload();
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Your location could not be saved."); }
      finally { setBusy(false); }
    }, () => { setBusy(false); setError("Location was not shared. Allow location for this page in your browser and try again."); }, { enableHighAccuracy: true, timeout: 15000 });
  }
  return (
    <Card title="Help the crew find you">
      <p className="text-sm leading-6 text-slate-600">Your exact location is not on the map yet. Share it while you are at the place to be collected from.</p>
      <button disabled={busy} onClick={share} className="mt-3 rounded-[var(--ui-radius)] border border-[var(--color-action)] px-3 py-2 text-sm font-semibold text-[var(--color-action)] disabled:opacity-60">{busy ? "Finding you…" : "Share my location"}</button>
    </Card>
  );
}

/** Lets a customer set or change the password they sign in with, for example after opening their company's link. */
function PasswordCard({ setNotice, setError }: { setNotice: (text: string) => void; setError: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setError("");
    try {
      const session = await apiRequest<{ data: Session }>("/api/auth/households/me/password", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      store(session.data);
      setOpen(false); setPassword("");
      setNotice("Password saved. You can now sign in on any phone with your mobile number and this password.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your password could not be saved."); }
    finally { setBusy(false); }
  }
  return (
    <Card title="Sign-in" action={open ? null : <button onClick={() => setOpen(true)} className="text-sm font-semibold text-[var(--color-action)]">Set password</button>}>
      {open ? (
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label className="block text-sm font-medium">New password
            <input type="password" autoComplete="new-password" required minLength={6} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 block w-full rounded-[var(--ui-radius)] border border-slate-300 px-3 py-2.5 text-base" />
          </label>
          <button disabled={busy || password.length < 6} className="w-full rounded-[var(--ui-radius)] bg-[var(--color-action)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Save password"}</button>
          <button type="button" onClick={() => setOpen(false)} className="w-full py-1 text-sm text-slate-600">Cancel</button>
        </form>
      ) : <p className="text-sm text-slate-600">Sign in on any phone with your mobile number and a password. Set or change it here.</p>}
    </Card>
  );
}
