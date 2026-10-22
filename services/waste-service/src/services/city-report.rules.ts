// KCCA city report rules: reporting periods, period-on-period change, resident-issue standards, and the
// plain-language insights. Pure so every rule is unit-tested and reviewable by KCCA.
import { issueStandardHours, ServiceStandards } from "./city-command-center.service";

export type ReportPeriod = {
  key: string; type: "month" | "quarter"; from: string; to: string; label: string;
  complete: boolean; previous: { key: string; from: string; to: string; label: string };
};

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/, QUARTER = /^(\d{4})-Q([1-4])$/;
const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
const monthLabel = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

function describe(key: string): Omit<ReportPeriod, "complete" | "previous"> {
  let match = MONTH.exec(key);
  if (match) {
    const y = Number(match[1]), m = Number(match[2]);
    return { key, type: "month", from: `${key}-01`, to: monthEnd(y, m), label: monthLabel(y, m) };
  }
  match = QUARTER.exec(key);
  if (match) {
    const y = Number(match[1]), q = Number(match[2]), first = (q - 1) * 3 + 1;
    return { key, type: "quarter", from: `${y}-${String(first).padStart(2, "0")}-01`, to: monthEnd(y, first + 2), label: `Q${q} ${y} (${monthLabel(y, first).split(" ")[0]}–${monthLabel(y, first + 2)})` };
  }
  throw Object.assign(new Error("Use a reporting period such as 2026-09 (month) or 2026-Q3 (quarter)"), { statusCode: 400 });
}

function previousKey(key: string): string {
  let match = MONTH.exec(key);
  if (match) {
    const y = Number(match[1]), m = Number(match[2]);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  }
  match = QUARTER.exec(key)!;
  const y = Number(match[1]), q = Number(match[2]);
  return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`;
}

/** A period may be viewed while in progress (to date) but not in the future. */
export function resolveReportPeriod(key: string, today: string): ReportPeriod {
  const period = describe(key);
  if (period.from > today) throw Object.assign(new Error("That reporting period has not started yet"), { statusCode: 400 });
  const prev = describe(previousKey(key));
  return { ...period, complete: period.to < today, previous: { key: prev.key, from: prev.from, to: prev.to, label: prev.label } };
}

/** The six calendar months ending with the period's last month. */
export function trendMonths(to: string, count = 6): string[] {
  let [y, m] = to.slice(0, 7).split("-").map(Number);
  const months: string[] = [];
  for (let i = 0; i < count; i++) {
    months.unshift(`${y}-${String(m).padStart(2, "0")}`);
    if (--m === 0) { m = 12; y--; }
  }
  return months;
}

export function share(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

/** Relative change in percent, or null when there is no base to compare with. */
export function change(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return Math.round((sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

/** Resolved resident issues measured against KCCA's response standard for their category. */
export function issueStandardSummary(resolved: Array<{ category: string; hours: number }>, standards: ServiceStandards) {
  const within = resolved.filter(issue => issue.hours <= issueStandardHours(issue.category, standards)).length;
  return { resolved: resolved.length, within_standard: within, within_standard_rate: share(within, resolved.length), median_hours: median(resolved.map(issue => issue.hours)) };
}

export type Kpis = {
  jobs_scheduled: number; jobs_completed: number; jobs_missed: number; completion_rate: number | null;
  trips_completed: number; trips_verified: number; verification_rate: number | null; disposed_kg: number;
  issues_received: number; issues_resolved: number; within_standard_rate: number | null; median_resolution_hours: number | null;
  recyclables_kg: number; recovery_rate: number | null;
  cases_opened: number; cases_closed: number; returns_required: number; returns_filed: number; returns_on_time: number; returns_filing_rate: number | null;
};

export type InsightInput = {
  current: Kpis; previous: Kpis;
  collectors: Array<{ name: string; service_score: number | null; band: string; jobs: number }>;
  expiringPermits: number; unlicensedCompanies: number; recyclersNeedingAction: number;
};

export type Insight = { id: string; tone: "risk" | "attention" | "positive"; title: string; detail: string };

const t = (kg: number) => kg >= 1000 ? `${(kg / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} t` : `${Math.round(kg).toLocaleString("en-GB")} kg`;
const pts = (n: number) => `${Math.abs(Math.round(n * 10) / 10)} point${Math.abs(n) === 1 ? "" : "s"}`;
const list = (names: string[]) => names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;

export const INSIGHT_RULES = {
  completionTarget: 90, completionMovePts: 5, tonnageMovePct: 10, issueStandardTarget: 80, issueStandardGood: 95,
  verificationTarget: 90, missedRisePct: 20, missedMinimum: 10, filingTarget: 90, recoveryMovePts: 2, maxInsights: 8,
};

/** Turns the report's numbers into short findings, most serious first. */
export function generateInsights(input: InsightInput): Insight[] {
  const r = INSIGHT_RULES, c = input.current, p = input.previous, out: Insight[] = [];

  if (c.completion_rate !== null) {
    const move = p.completion_rate === null ? null : c.completion_rate - p.completion_rate;
    if (c.completion_rate < r.completionTarget) {
      out.push({ id: "completion_low", tone: move !== null && move <= -r.completionMovePts ? "risk" : "attention", title: `Collection completion at ${c.completion_rate}%`,
        detail: `${c.jobs_completed.toLocaleString("en-GB")} of ${c.jobs_scheduled.toLocaleString("en-GB")} scheduled collections were completed, below the ${r.completionTarget}% target${move !== null ? ` (${move < 0 ? "down" : "up"} ${pts(move)} on the previous period)` : ""}.` });
    } else if (move !== null && move >= r.completionMovePts) {
      out.push({ id: "completion_up", tone: "positive", title: `Collection completion improved to ${c.completion_rate}%`, detail: `Up ${pts(move)} on the previous period.` });
    }
  }
  if (p.jobs_missed >= r.missedMinimum || c.jobs_missed >= r.missedMinimum) {
    const rise = change(c.jobs_missed, p.jobs_missed);
    if (rise !== null && rise >= r.missedRisePct) out.push({ id: "missed_up", tone: "risk", title: `Missed collections up ${rise}%`, detail: `${c.jobs_missed} missed this period against ${p.jobs_missed} in the previous period.` });
  }
  if (c.within_standard_rate !== null) {
    if (c.within_standard_rate < r.issueStandardTarget) out.push({ id: "issues_slow", tone: "risk", title: `Only ${c.within_standard_rate}% of resident issues resolved within standard`,
      detail: `${c.issues_resolved} issues were resolved${c.median_resolution_hours !== null ? `, taking a median of ${c.median_resolution_hours} hours` : ""}. KCCA's target is ${r.issueStandardTarget}% within each category's response standard.` });
    else if (c.within_standard_rate >= r.issueStandardGood) out.push({ id: "issues_fast", tone: "positive", title: `${c.within_standard_rate}% of resident issues resolved within standard`, detail: `${c.issues_resolved} issues resolved in the period.` });
  }
  const actionCollectors = input.collectors.filter(col => col.band === "action_required").map(col => col.name);
  if (actionCollectors.length) out.push({ id: "collectors_action", tone: "risk", title: `${actionCollectors.length} collector${actionCollectors.length === 1 ? " needs" : "s need"} action`, detail: `Service score below 65: ${list(actionCollectors)}.` });
  if (input.unlicensedCompanies) out.push({ id: "unlicensed", tone: "attention", title: `${input.unlicensedCompanies} compan${input.unlicensedCompanies === 1 ? "y operates" : "ies operate"} with no permit on record`, detail: "Issue or link their permits so licensing rules apply to them." });
  if (input.expiringPermits) out.push({ id: "permits_expiring", tone: "attention", title: `${input.expiringPermits} permit${input.expiringPermits === 1 ? "" : "s"} expire within 60 days of period end`, detail: "Renewal requests should be reviewed before these dates to avoid operations stopping." });
  if (c.returns_filing_rate !== null && c.returns_filing_rate < r.filingTarget) {
    out.push({ id: "returns_low", tone: "attention", title: `Monthly returns filed: ${c.returns_filing_rate}%`, detail: `${c.returns_filed} of ${c.returns_required} returns due for the period were filed; ${c.returns_filed - c.returns_on_time} late.` });
  }
  if (c.verification_rate !== null && c.verification_rate < r.verificationTarget) {
    out.push({ id: "verification_low", tone: "attention", title: `${c.verification_rate}% of completed trips weighbridge-verified`, detail: `${c.trips_completed - c.trips_verified} completed trips have no verified weight.` });
  }
  const tonnage = change(c.disposed_kg, p.disposed_kg);
  if (tonnage !== null && Math.abs(tonnage) >= r.tonnageMovePct) {
    out.push({ id: "tonnage_move", tone: "attention", title: `Waste delivered for disposal ${tonnage > 0 ? "up" : "down"} ${Math.abs(tonnage)}%`, detail: `${t(c.disposed_kg)} against ${t(p.disposed_kg)} in the previous period.` });
  }
  if (input.recyclersNeedingAction) out.push({ id: "recyclers_action", tone: "attention", title: `${input.recyclersNeedingAction} recycler${input.recyclersNeedingAction === 1 ? " needs" : "s need"} action`, detail: "See Recycling oversight for the reasons." });
  if (c.recovery_rate !== null && p.recovery_rate !== null && c.recovery_rate - p.recovery_rate >= r.recoveryMovePts) {
    out.push({ id: "recovery_up", tone: "positive", title: `Recovery rate rose to ${c.recovery_rate}%`, detail: `Up ${pts(c.recovery_rate - p.recovery_rate)}: ${t(c.recyclables_kg)} of recyclables recovered.` });
  }
  const ranked = input.collectors.filter(col => col.service_score !== null && col.jobs >= 10).sort((a, b) => b.service_score! - a.service_score!);
  if (ranked[0] && ranked[0].service_score! >= 85) out.push({ id: "top_collector", tone: "positive", title: `Best service: ${ranked[0].name}`, detail: `Service score ${ranked[0].service_score}/100.` });

  const order = { risk: 0, attention: 1, positive: 2 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, r.maxInsights);
}

