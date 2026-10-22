// KCCA recycling oversight rules: reporting periods, recovery rate and the flags that decide a recycler's standing.
// Kept free of database access so every threshold is unit-tested and easy for KCCA to review.
import { addDays, daysBetween, effectivePermitStatus } from "./permit-lifecycle.rules";

export const OVERSIGHT_THRESHOLDS = {
  /** Days without any recorded purchase, sorting or sale before a recycler is flagged as inactive. */
  inactiveDays: 14,
  /** Stock older than this many days counts as aged. */
  agedStockDays: 90,
  /** Aged stock below this weight is not worth flagging. */
  agedStockMinKg: 500,
  /** Share of sorted input rejected as residue that warrants attention (needs disposal). */
  residueShare: 0.2,
  residueMinInputKg: 100,
  /** Share of working days that should end with a daily closing. */
  closureCoverage: 0.8,
  closureMinActiveDays: 3,
  /** Permits expiring within this many days are flagged. */
  permitExpiryWarningDays: 30,
  /** Longest reporting period KCCA can request in one view. */
  maxPeriodDays: 731,
};

export type Period = { from: string; to: string; label: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Turns `?period=30d|90d|year` or `?from=&to=` into a validated, inclusive date range ending no later than today. */
export function resolvePeriod(query: { period?: unknown; from?: unknown; to?: unknown }, today: string): Period {
  const from = typeof query.from === "string" ? query.from : "", to = typeof query.to === "string" ? query.to : "";
  if (from || to) {
    if (!ISO.test(from) || !ISO.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      throw Object.assign(new Error("Use dates in the form YYYY-MM-DD for both from and to"), { statusCode: 400 });
    }
    if (from > to) throw Object.assign(new Error("The start date must be on or before the end date"), { statusCode: 400 });
    if (daysBetween(from, to) + 1 > OVERSIGHT_THRESHOLDS.maxPeriodDays) {
      throw Object.assign(new Error("Choose a period of at most two years"), { statusCode: 400 });
    }
    return { from, to, label: `${from} to ${to}` };
  }
  if (query.period === "90d") return { from: addDays(today, -89), to: today, label: "Last 90 days" };
  if (query.period === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today, label: `${today.slice(0, 4)} to date` };
  return { from: addDays(today, -29), to: today, label: "Last 30 days" };
}

/** Share of recovered recyclables in all waste accounted for (recyclables plus weighbridge-verified disposal). */
export function recoveryRate(recyclablesKg: number, disposedKg: number): number | null {
  const total = recyclablesKg + disposedKg;
  if (total <= 0) return null;
  return Math.round((recyclablesKg / total) * 1000) / 10;
}

export type RecyclerMetrics = {
  collected_kg: number;
  sold_kg: number;
  sorting_input_kg: number;
  residue_kg: number;
  aged_stock_kg: number;
  last_activity: string | null;
  active_days: number;
  closed_days: number;
  permit: { status: string; valid_until: string | null } | null;
};

export type Flag = { code: string; severity: "action" | "watch"; message: string };
export type Standing = "good" | "watch" | "action";

const kg = (value: number) => `${Math.round(value).toLocaleString("en-GB")} kg`;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function recyclerFlags(metrics: RecyclerMetrics, today: string): Flag[] {
  const t = OVERSIGHT_THRESHOLDS, flags: Flag[] = [];
  if (!metrics.permit) {
    flags.push({ code: "no_permit", severity: "action", message: "No KCCA permit on record" });
  } else {
    const status = effectivePermitStatus(metrics.permit.status, metrics.permit.valid_until, today);
    if (status === "expired") flags.push({ code: "permit_expired", severity: "action", message: metrics.permit.valid_until ? `Permit expired on ${day(metrics.permit.valid_until)}` : "Permit expired" });
    else if (status === "suspended") flags.push({ code: "permit_suspended", severity: "action", message: "Permit suspended" });
    else if (status === "approved" && metrics.permit.valid_until) {
      const left = daysBetween(today, metrics.permit.valid_until);
      if (left <= t.permitExpiryWarningDays) flags.push({ code: "permit_expiring", severity: "watch", message: `Permit expires in ${left} day${left === 1 ? "" : "s"}` });
    }
  }
  if (!metrics.last_activity) {
    flags.push({ code: "no_activity", severity: "watch", message: "No purchases, sorting or sales recorded yet" });
  } else {
    const idle = daysBetween(metrics.last_activity, today);
    if (idle > t.inactiveDays) flags.push({ code: "inactive", severity: "watch", message: `No recorded activity for ${idle} days` });
  }
  if (metrics.aged_stock_kg >= t.agedStockMinKg) {
    flags.push({ code: "aged_stock", severity: "watch", message: `${kg(metrics.aged_stock_kg)} held for over ${t.agedStockDays} days` });
  }
  if (metrics.sorting_input_kg >= t.residueMinInputKg && metrics.residue_kg / metrics.sorting_input_kg > t.residueShare) {
    flags.push({ code: "high_residue", severity: "watch", message: `${Math.round((metrics.residue_kg / metrics.sorting_input_kg) * 100)}% of sorted material rejected as residue` });
  }
  if (metrics.active_days >= t.closureMinActiveDays && metrics.closed_days / metrics.active_days < t.closureCoverage) {
    flags.push({ code: "closure_gap", severity: "watch", message: `Daily closing done on ${metrics.closed_days} of ${metrics.active_days} working days` });
  }
  return flags;
}

export function standingOf(flags: Flag[]): Standing {
  if (flags.some(flag => flag.severity === "action")) return "action";
  return flags.length ? "watch" : "good";
}

/** RFC 4180 CSV with a header row; formula-like cells are prefixed so spreadsheets do not execute them. */
export function toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const cell = (value: string | number | null) => {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text) && typeof value !== "number") text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers, ...rows].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
