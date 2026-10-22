"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState, Feedback, PageHeader, Status } from "@/components/ui/System";
import type { LiveVehicle } from "@/components/gis/FleetLiveMap";
import { apiRequest } from "@/lib/api";
import { ComplianceNoticeDialog, type NoticeDraft } from "@/components/command-center/ComplianceNoticeDialog";
import { ServiceStandardsDialog } from "@/components/command-center/ServiceStandardsDialog";

const FleetLiveMap = dynamic(() => import("@/components/gis/FleetLiveMap"), {
  ssr: false,
  loading: () => <div className="grid h-[560px] place-items-center bg-slate-900 text-sm text-slate-400">Loading city map…</div>,
});

type Totals = {
  jobs_today: number; completed_jobs: number; missed_jobs: number; completion_pct: number | null;
  active_trips: number; weighbridge_kg_today: number; trucks_at_weighbridge: number;
  open_compliance_cases: number; overdue_compliance_cases: number; permits_expiring_30d: number;
  active_collectors: number; trucks_reporting: number; fleet_alerts: number; open_issues: number; overdue_issues: number;
};
type Division = {
  id: string | null; code: string; name: string; jobs: number; completed: number; missed: number; completion_pct: number | null;
  active_trips: number; verified_kg: number; open_issues: number; overdue_issues: number; authorized_collectors: number;
};
type IssueCategory = { category: string; open: number; overdue: number; due_soon: number; unassigned: number; standard_hours: number };
type AttentionIssue = {
  id: string; category: string; title: string; status: string; address: string | null; created_at: string;
  organization_name: string | null; division_name: string | null; age_hours: number; standard_hours: number;
  sla_state: "overdue" | "due_soon" | "within_standard";
};
type Collector = {
  id: string; name: string; divisions: string; permit_number: string | null; permit_valid_until: string | null; compliance_state: string;
  jobs: number; completed_jobs: number; missed_jobs: number; completed_trips: number; unverified_trips: number;
  open_issues: number; overdue_issues: number; open_compliance_cases: number; critical_compliance_cases: number;
  completion_pct: number | null; verified_kg: number; service_score: number | null; score_band: "good" | "watch" | "action_required" | "no_activity";
};
type CityVehicle = LiveVehicle & { organization_id: string };
type CommandCenter = {
  generated_at: string; refresh_seconds: number; service_date: string; totals: Totals; divisions: Division[];
  fleet: CityVehicle[]; fleet_alerts: CityVehicle[];
  issues: { open: number; overdue: number; due_soon: number; unassigned: number; by_category: IssueCategory[]; needs_attention: AttentionIssue[] };
  scorecard: { range: { from: string; to: string }; collectors: Collector[] };
};

const tonnes = (kg: number) => (kg / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 });
const label = (value: string) => value.replaceAll("_", " ");
const time = (value: string) => new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const hours = (value: number) => (value >= 48 ? `${Math.floor(value / 24)}d ${Math.round(value % 24)}h` : `${Math.round(value)}h`);
const alertText: Record<string, string> = { signal_missing: "No GPS signal", off_route: "Off planned route", stopped_too_long: "Stopped too long" };
const bandText: Record<Collector["score_band"], string> = { good: "Good", watch: "Watch", action_required: "Action required", no_activity: "No activity" };
const bandTone: Record<Collector["score_band"], string> = {
  good: "bg-emerald-50 text-emerald-800 border-emerald-200",
  watch: "bg-amber-50 text-amber-800 border-amber-200",
  action_required: "bg-red-50 text-red-800 border-red-200",
  no_activity: "bg-slate-50 text-slate-600 border-slate-200",
};
const slaTone: Record<AttentionIssue["sla_state"], string> = { overdue: "text-red-700", due_soon: "text-amber-700", within_standard: "text-slate-500" };

const noSubscription = () => () => {};
/** Signed-in roles as a stable string (useSyncExternalStore needs a primitive snapshot). */
function rolesSnapshot() {
  try {
    const user = JSON.parse(sessionStorage.getItem("currentUser") || "{}") as { roles?: string[] };
    return (user.roles ?? []).slice().sort().join(",");
  } catch {
    return "";
  }
}

const addDays = (days: number) => {
  const date = new Date(Date.now() + days * 86400000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

function collectorNotice(collector: Collector, range: { from: string; to: string }): NoticeDraft {
  const permitIssue = ["permit_missing", "permit_expired", "renewal_due"].includes(collector.compliance_state);
  const weighbridgeIssue = !permitIssue && collector.unverified_trips > 0 && (collector.completion_pct ?? 0) >= 85;
  const category: NoticeDraft["category"] = permitIssue ? "permit" : weighbridgeIssue ? "weighbridge" : "service_delivery";
  const severity: NoticeDraft["severity"] = (collector.service_score ?? 100) < 40 || collector.compliance_state === "permit_expired" ? "critical" : collector.score_band === "action_required" ? "warning" : "advisory";
  const evidence = [
    `Command centre evidence for ${range.from} to ${range.to}:`,
    `- ${collector.completed_jobs} of ${collector.jobs} scheduled collections completed (${collector.completion_pct ?? 0}%), ${collector.missed_jobs} missed.`,
    `- ${collector.unverified_trips} completed trip(s) without a weighbridge-verified weight; ${(collector.verified_kg / 1000).toFixed(1)} t verified.`,
    `- ${collector.overdue_issues} of ${collector.open_issues} open resident issue(s) past the KCCA service standard.`,
    `- Permit ${collector.permit_number || "not on record"}${collector.permit_valid_until ? `, valid until ${collector.permit_valid_until}` : ""}; compliance state: ${collector.compliance_state.replaceAll("_", " ")}.`,
    collector.service_score === null ? "" : `- Service score ${collector.service_score}/100.`,
  ].filter(Boolean).join("\n");
  const action: Record<NoticeDraft["category"], string> = {
    permit: "Submit a complete permit renewal or application to KCCA and confirm the date it will be valid.",
    weighbridge: "Weigh all completed trips at an approved weighbridge and link each ticket to its trip in the platform.",
    service_delivery: "Collect all missed pickups, resolve overdue resident issues, and submit a recovery plan showing how schedules will be met.",
    customer_service: "Resolve the outstanding resident issues and report the actions taken.",
    fleet_safety: "Confirm vehicle status and restore compliant operation.",
    recycling_operations: "Correct the recycling records or operations described and report the actions taken.",
    statutory_returns: "Submit the outstanding monthly return in the regulatory portal.",
    other: "Respond with the corrective actions taken.",
  };
  return {
    key: `collector-${collector.id}-${Date.now()}`,
    organizationId: collector.id,
    organizationName: collector.name,
    category,
    severity,
    title: permitIssue ? `Permit standing requires action — ${collector.name}` : weighbridgeIssue ? `Unverified collection tonnage — ${collector.name}` : `Service delivery below KCCA standard — ${collector.name}`,
    details: evidence,
    requiredAction: action[category],
    dueDate: addDays(severity === "critical" ? 3 : 7),
  };
}

function vehicleNotice(vehicle: CityVehicle): NoticeDraft {
  const what = vehicle.alert_code ? alertText[vehicle.alert_code] : "Fleet concern";
  const lines = [
    `Live fleet monitoring flagged truck ${vehicle.plate_number}: ${what.toLowerCase()}.`,
    vehicle.route_name ? `Trip: ${vehicle.route_name}${vehicle.driver_name ? `, driver ${vehicle.driver_name}` : ""}.` : "",
    vehicle.recorded_at ? `Last GPS signal: ${new Date(vehicle.recorded_at).toLocaleString("en-GB")}.` : "No GPS signal has been received from this truck.",
    vehicle.distance_from_route_m ? `Distance from approved route: ${vehicle.distance_from_route_m} m.` : "",
  ].filter(Boolean).join("\n");
  return {
    key: `vehicle-${vehicle.id}-${Date.now()}`,
    organizationId: vehicle.organization_id,
    organizationName: vehicle.organization_name,
    category: "fleet_safety",
    severity: "warning",
    title: `${what} — ${vehicle.plate_number}`,
    details: lines,
    requiredAction: vehicle.alert_code === "signal_missing"
      ? "Restore GPS reporting for this truck and explain the gap in tracking for the affected trip."
      : vehicle.alert_code === "off_route"
        ? "Explain the deviation from the approved route and confirm where the collected waste was taken."
        : "Confirm the vehicle's status and explain the stoppage.",
    dueDate: addDays(2),
  };
}

function Kpi({ label: name, value, detail, tone = "neutral", href }: { label: string; value: string | number; detail?: string; tone?: "neutral" | "good" | "warn" | "bad"; href?: string }) {
  const accent = tone === "bad" ? "border-t-red-600" : tone === "warn" ? "border-t-amber-500" : tone === "good" ? "border-t-emerald-600" : "border-t-[var(--color-action)]";
  const body = (
    <div className={`h-full border border-slate-200 border-t-4 ${accent} bg-white px-4 py-3`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{name}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-950">{value}</p>
      {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </div>
  );
  return href ? <Link href={href} className="block focus:outline-2 focus:outline-[var(--color-action)]">{body}</Link> : body;
}

function CompletionBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-slate-400">No jobs</span>;
  const color = value >= 85 ? "bg-emerald-600" : value >= 65 ? "bg-amber-500" : "bg-red-600";
  return (
    <div className="flex min-w-28 items-center gap-2" aria-label={`${value}% completed`}>
      <div className="h-2 flex-1 bg-slate-100"><div className={`h-2 ${color}`} style={{ width: `${Math.min(100, value)}%` }} /></div>
      <span className="w-10 text-right text-sm tabular-nums">{value}%</span>
    </div>
  );
}

export default function CommandCenterPage() {
  const [data, setData] = useState<CommandCenter | null>(null);
  const [error, setError] = useState("");
  const [failedAt, setFailedAt] = useState(0);
  // Read once on the client; null while server-rendering.
  const roles = useSyncExternalStore(noSubscription, rolesSnapshot, () => null);
  const allowed = roles === null ? null : roles.split(",").some((role) => role === "kcca_admin" || role === "system_admin");
  const isKcca = Boolean(roles?.split(",").includes("kcca_admin"));
  const [noticeDraft, setNoticeDraft] = useState<NoticeDraft | null>(null);
  const [standardsOpen, setStandardsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);
  const wallRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const result = await apiRequest<{ data: CommandCenter }>("/api/waste/command-center/city");
      setData(result.data);
      setError("");
      setNow(Date.now());
    } catch (e) {
      // Keep the last good picture on screen and say how old it is.
      setError(e instanceof Error ? e.message : "The command center could not be refreshed");
      setFailedAt(Date.now());
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [allowed, load]);

  const refreshMs = (data?.refresh_seconds ?? 30) * 1000;
  useEffect(() => {
    if (!allowed || paused) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, refreshMs);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [allowed, paused, refreshMs, load]);

  // Selection follows the truck across refreshes.
  const selected = useMemo(() => data?.fleet.find((vehicle) => vehicle.id === selectedId) ?? null, [data, selectedId]);

  const totals = data?.totals;
  const mappedFleet = useMemo(() => (data?.fleet ?? []).filter((v) => v.latitude !== null && v.longitude !== null), [data]);
  const staleMinutes = data && failedAt ? Math.max(0, Math.round((failedAt - new Date(data.generated_at).getTime()) / 60000)) : 0;

  async function toggleWallDisplay() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await wallRef.current?.requestFullscreen();
    } catch {
      /* Full screen is optional; some browsers block it. */
    }
  }

  if (allowed === false) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl">
          <PageHeader eyebrow="KCCA command centre" title="City command centre" />
          <EmptyState title="This view is for KCCA city controllers" description="Company workspaces show their own operations on the Today page." action={<Link href="/dashboard" className="font-semibold text-[var(--color-action)]">Go to my dashboard</Link>} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div ref={wallRef} className="mx-auto max-w-[1600px] overflow-y-auto bg-[var(--background)] [&:fullscreen]:p-6">
        <PageHeader
          eyebrow="KCCA command centre"
          title="Kampala live operations"
          description={data ? `Service day ${data.service_date}. Collector scorecard covers ${data.scorecard.range.from} to ${data.scorecard.range.to}.` : "City-wide collection, fleet, resident issues and collector performance."}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-2 text-sm text-slate-600" aria-live="polite">
                <span className={`inline-block h-2 w-2 rounded-full ${error ? "bg-red-600" : paused ? "bg-slate-400" : "bg-emerald-600"}`} />
                {data ? `Updated ${time(data.generated_at)}` : "Connecting…"}
                {paused ? " · paused" : ` · every ${refreshMs / 1000}s`}
              </span>
              <button type="button" onClick={() => setPaused((p) => !p)} className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">{paused ? "Resume" : "Pause"}</button>
              <button type="button" onClick={() => void load()} disabled={loading} className="border border-[var(--color-action)] px-3 py-2 text-sm font-semibold text-[var(--color-action)] disabled:opacity-50">{loading ? "Refreshing…" : "Refresh"}</button>
              <button type="button" onClick={() => setStandardsOpen(true)} className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Service standards</button>
              <button type="button" onClick={() => void toggleWallDisplay()} className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Wall display</button>
            </div>
          }
        />

        {confirmation && <Feedback tone="success">{confirmation}</Feedback>}
        {error && (
          <Feedback tone={data ? "warning" : "error"}>
            {data ? `Live refresh failed (${error}). Showing data from ${time(data.generated_at)}, ${staleMinutes} min earlier.` : error}
          </Feedback>
        )}

        {!data && !error && <p className="py-16 text-center text-sm text-slate-500">Loading city operations…</p>}

        {data && totals && (
          <div className="space-y-8 py-6">
            <section aria-label="City headline figures" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
              <Kpi label="Collection completed" value={totals.completion_pct === null ? "—" : `${totals.completion_pct}%`} detail={`${totals.completed_jobs} of ${totals.jobs_today} scheduled`} tone={totals.completion_pct === null ? "neutral" : totals.completion_pct >= 85 ? "good" : totals.completion_pct >= 65 ? "warn" : "bad"} />
              <Kpi label="Missed today" value={totals.missed_jobs} tone={totals.missed_jobs ? "bad" : "good"} href="/dashboard/waste" />
              <Kpi label="Active trips" value={totals.active_trips} detail={`${totals.trucks_reporting} trucks reporting GPS`} />
              <Kpi label="Fleet alerts" value={totals.fleet_alerts} tone={totals.fleet_alerts ? "bad" : "good"} detail="Unresolved" />
              <Kpi label="Weighbridge today" value={`${tonnes(totals.weighbridge_kg_today)} t`} detail={`${totals.trucks_at_weighbridge} trucks on the bridge`} href="/dashboard/weighbridge" />
              <Kpi label="Resident issues" value={totals.open_issues} detail={`${totals.overdue_issues} past standard`} tone={totals.overdue_issues ? "bad" : totals.open_issues ? "warn" : "good"} href="/dashboard/citizen-issues" />
              <Kpi label="Compliance cases" value={totals.open_compliance_cases} detail={`${totals.overdue_compliance_cases} past due date`} tone={totals.overdue_compliance_cases ? "bad" : "neutral"} href="/dashboard/compliance" />
              <Kpi label="Permits expiring" value={totals.permits_expiring_30d} detail={`Next 30 days · ${totals.active_collectors} active collectors`} tone={totals.permits_expiring_30d ? "warn" : "neutral"} href="/dashboard/permits" />
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="border border-slate-300">
                <FleetLiveMap vehicles={mappedFleet} onSelect={(vehicle) => setSelectedId(vehicle.id)} now={now} trail={[]} />
              </div>
              <aside className="flex flex-col border border-slate-300 bg-white">
                <div className="border-b border-slate-200 px-4 py-3">
                  <h2 className="text-lg font-semibold text-slate-950">Fleet attention</h2>
                  <p className="text-sm text-slate-500">{data.fleet.length} registered trucks · {mappedFleet.length} on the map</p>
                </div>
                {selected && (
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-950">{selected.plate_number}</p>
                        <p className="text-slate-600">{selected.organization_name}</p>
                      </div>
                      <button type="button" onClick={() => setSelectedId(null)} className="text-xs font-semibold text-slate-500">Close</button>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-600">
                      <dt>Driver</dt><dd className="text-slate-900">{selected.driver_name || "—"}</dd>
                      <dt>Trip</dt><dd className="text-slate-900">{selected.route_name || "None active"}</dd>
                      <dt>Speed</dt><dd className="text-slate-900">{selected.speed_kph ? `${Number(selected.speed_kph).toFixed(0)} km/h` : "—"}</dd>
                      <dt>Last signal</dt><dd className="text-slate-900">{selected.recorded_at ? time(selected.recorded_at) : "Never"}</dd>
                    </dl>
                    {selected.alert_code && <p className="mt-2 font-semibold text-red-700">{alertText[selected.alert_code]}</p>}
                    {isKcca && selected.alert_code && (
                      <button type="button" onClick={() => setNoticeDraft(vehicleNotice(selected))} className="mt-3 border border-[var(--color-action)] px-3 py-1.5 text-xs font-semibold text-[var(--color-action)]">Issue compliance notice</button>
                    )}
                  </div>
                )}
                <ul className="max-h-[470px] flex-1 divide-y divide-slate-100 overflow-y-auto">
                  {data.fleet_alerts.length ? data.fleet_alerts.map((vehicle) => (
                    <li key={vehicle.id}>
                      <button type="button" onClick={() => setSelectedId(vehicle.id)} className="w-full px-4 py-3 text-left hover:bg-slate-50">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">{vehicle.plate_number}</span>
                          <span className="text-xs font-semibold text-red-700">{vehicle.alert_code ? alertText[vehicle.alert_code] : ""}</span>
                        </div>
                        <p className="text-sm text-slate-500">{vehicle.organization_name}{vehicle.route_name ? ` · ${vehicle.route_name}` : ""}</p>
                        {vehicle.review_status && <p className="text-xs text-slate-500">Collector {label(vehicle.review_status)}</p>}
                      </button>
                    </li>
                  )) : <li className="px-4 py-6 text-sm text-slate-500">No unresolved fleet alerts. Trucks on active trips are reporting and on route.</li>}
                </ul>
              </aside>
            </section>

            <section>
              <div className="flex items-end justify-between border-b border-slate-300 pb-3">
                <div>
                  <h2 className="text-xl font-semibold text-slate-950">Division performance today</h2>
                  <p className="mt-1 text-sm text-slate-500">Scheduled collections exclude cancelled jobs. Tonnage counts weighbridge-verified trips linked to a division route.</p>
                </div>
              </div>
              <div className="table-wrap mt-4">
                <table className="text-left">
                  <thead><tr><th>Division</th><th>Collectors</th><th>Scheduled</th><th>Completed</th><th>Missed</th><th>Completion</th><th>Active trips</th><th>Verified tonnes</th><th>Open issues</th></tr></thead>
                  <tbody>
                    {data.divisions.map((division) => (
                      <tr key={division.code}>
                        <td className="table-primary">{division.name}</td>
                        <td className="tabular-nums">{division.id ? division.authorized_collectors : "—"}</td>
                        <td className="tabular-nums">{division.jobs}</td>
                        <td className="tabular-nums">{division.completed}</td>
                        <td className={`tabular-nums ${division.missed ? "font-semibold text-red-700" : ""}`}>{division.missed}</td>
                        <td><CompletionBar value={division.completion_pct} /></td>
                        <td className="tabular-nums">{division.active_trips}</td>
                        <td className="tabular-nums">{tonnes(division.verified_kg)}</td>
                        <td className="tabular-nums">{division.open_issues}{division.overdue_issues ? <span className="ml-1 text-red-700">({division.overdue_issues} late)</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div>
                <div className="border-b border-slate-300 pb-3">
                  <h2 className="text-xl font-semibold text-slate-950">Resident issues against service standards</h2>
                  <p className="mt-1 text-sm text-slate-500">{data.issues.open} open · {data.issues.overdue} past standard · {data.issues.due_soon} due soon · {data.issues.unassigned} not yet assigned to a collector</p>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {data.issues.by_category.length ? data.issues.by_category.map((item) => (
                    <div key={item.category} className="border border-slate-200 bg-white px-4 py-3">
                      <p className="text-sm font-semibold capitalize text-slate-900">{label(item.category)}</p>
                      <p className="text-xs text-slate-500">KCCA standard: resolve within {item.standard_hours}h</p>
                      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">{item.open}</p>
                      <p className="text-xs"><span className={item.overdue ? "font-semibold text-red-700" : "text-slate-500"}>{item.overdue} late</span><span className="text-slate-400"> · </span><span className={item.due_soon ? "text-amber-700" : "text-slate-500"}>{item.due_soon} due soon</span></p>
                    </div>
                  )) : <p className="col-span-2 text-sm text-slate-500">No open resident issues.</p>}
                </div>
              </div>
              <div>
                <div className="flex items-end justify-between border-b border-slate-300 pb-3">
                  <h2 className="text-xl font-semibold text-slate-950">Needs attention first</h2>
                  <Link href="/dashboard/citizen-issues" className="text-sm font-semibold text-[var(--color-action)]">Open issue queue</Link>
                </div>
                <ul className="mt-2 divide-y divide-slate-200 border-b border-slate-200">
                  {data.issues.needs_attention.length ? data.issues.needs_attention.map((issue) => (
                    <li key={issue.id} className="flex items-start justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">{issue.title}</p>
                        <p className="text-sm text-slate-500"><span className="capitalize">{label(issue.category)}</span> · {issue.division_name || "Location not mapped"} · {issue.organization_name || "Unassigned"}</p>
                      </div>
                      <div className="shrink-0 text-right text-sm">
                        <p className={`font-semibold ${slaTone[issue.sla_state]}`}>{hours(issue.age_hours)} open</p>
                        <p className="text-xs text-slate-500">standard {issue.standard_hours}h</p>
                      </div>
                    </li>
                  )) : <li className="py-6 text-sm text-slate-500">Nothing waiting.</li>}
                </ul>
              </div>
            </section>

            <section>
              <div className="flex items-end justify-between border-b border-slate-300 pb-3">
                <div>
                  <h2 className="text-xl font-semibold text-slate-950">Collector scorecard · last 7 days</h2>
                  <p className="mt-1 text-sm text-slate-500">Service score out of 100: collection completion 50, weighbridge verification 20, issues within standard 15, permit and compliance standing 15.</p>
                </div>
                <Link href="/dashboard/city-reports" className="text-sm font-semibold text-[var(--color-action)]">Full performance report</Link>
              </div>
              <div className="table-wrap mt-4">
                {data.scorecard.collectors.length ? (
                  <table className="text-left">
                    <thead><tr><th>#</th><th>Collector</th><th>Score</th><th>Completion</th><th>Missed</th><th>Unverified trips</th><th>Verified tonnes</th><th>Issues late</th><th>Compliance</th><th>Permit valid until</th>{isKcca && <th><span className="sr-only">Actions</span></th>}</tr></thead>
                    <tbody>
                      {data.scorecard.collectors.map((collector, index) => (
                        <tr key={collector.id}>
                          <td className="tabular-nums text-slate-500">{collector.service_score === null ? "—" : index + 1}</td>
                          <td><p className="table-primary">{collector.name}</p><p className="text-xs text-slate-500">{collector.divisions || "No authorized divisions"}</p></td>
                          <td><span className={`inline-flex items-center gap-2 border px-2 py-1 text-sm font-semibold ${bandTone[collector.score_band]}`}>{collector.service_score ?? "—"}<span className="font-normal">{bandText[collector.score_band]}</span></span></td>
                          <td><CompletionBar value={collector.completion_pct} /></td>
                          <td className={`tabular-nums ${collector.missed_jobs ? "font-semibold text-red-700" : ""}`}>{collector.missed_jobs}</td>
                          <td className="tabular-nums">{collector.unverified_trips}</td>
                          <td className="tabular-nums">{tonnes(collector.verified_kg)}</td>
                          <td className="tabular-nums">{collector.overdue_issues}</td>
                          <td><Status value={collector.compliance_state} />{collector.open_compliance_cases ? <p className="text-xs text-slate-500">{collector.open_compliance_cases} open case{collector.open_compliance_cases > 1 ? "s" : ""}{collector.critical_compliance_cases ? `, ${collector.critical_compliance_cases} critical` : ""}</p> : null}</td>
                          <td className="tabular-nums">{collector.permit_valid_until || "—"}</td>
                          {isKcca && (
                            <td><button type="button" onClick={() => setNoticeDraft(collectorNotice(collector, data.scorecard.range))} className="whitespace-nowrap border border-[var(--color-action)] px-2 py-1 text-xs font-semibold text-[var(--color-action)]">Issue notice</button></td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <EmptyState title="No licensed waste collectors yet" description="Collectors appear here once KCCA approves their permit and the platform activates them." />}
              </div>
            </section>
          </div>
        )}
      </div>
      <ComplianceNoticeDialog
        draft={noticeDraft}
        onClose={() => setNoticeDraft(null)}
        onIssued={(message) => { setNoticeDraft(null); setConfirmation(message); void load(); }}
      />
      <ServiceStandardsDialog
        open={standardsOpen}
        canEdit={isKcca}
        onClose={() => setStandardsOpen(false)}
        onSaved={(message) => { setConfirmation(message); void load(); }}
      />
    </AppShell>
  );
}
