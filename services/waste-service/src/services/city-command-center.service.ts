/**
 * Pure rules for the KCCA city command center. Kept free of database access so the
 * standards and scoring KCCA relies on are unit-tested and easy to review.
 */

export type ServiceStandards = Record<string, number>;

export const ISSUE_CATEGORIES = ["missed_collection", "overflowing_bin", "illegal_dumping", "pickup_request", "service_complaint"] as const;

/**
 * Fallback resident-issue response standards (hours from report to resolution), used only
 * until migration 091 seeds KCCA's own editable standards in kcca_service_standards.
 */
export const ISSUE_SERVICE_STANDARDS_HOURS: ServiceStandards = {
  missed_collection: 24,
  overflowing_bin: 24,
  illegal_dumping: 48,
  pickup_request: 72,
  service_complaint: 72,
};
const DEFAULT_STANDARD_HOURS = 48;

export function issueStandardHours(category: string, standards: ServiceStandards = ISSUE_SERVICE_STANDARDS_HOURS) {
  return standards[category] ?? DEFAULT_STANDARD_HOURS;
}

/** "overdue" past the standard, "due_soon" in its last quarter, otherwise "within_standard". */
export function issueSlaState(category: string, ageHours: number, standards: ServiceStandards = ISSUE_SERVICE_STANDARDS_HOURS) {
  const standard = issueStandardHours(category, standards);
  if (ageHours > standard) return "overdue" as const;
  if (ageHours >= standard * 0.75) return "due_soon" as const;
  return "within_standard" as const;
}

export function percent(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

export type CollectorInput = {
  jobs: number;
  completed_jobs: number;
  missed_jobs: number;
  completed_trips: number;
  unverified_trips: number;
  open_issues: number;
  overdue_issues: number;
  open_compliance_cases: number;
  critical_compliance_cases: number;
  compliance_state: string;
};

/**
 * Transparent 0–100 service score (null when the collector had no scheduled work).
 *  - 50 pts collection completion (completed / scheduled jobs)
 *  - 20 pts weighbridge verification (verified / completed trips)
 *  - 15 pts resident issues handled within standard (1 − overdue / open)
 *  - 15 pts regulatory standing (permit valid, no critical compliance cases)
 */
export function collectorServiceScore(row: CollectorInput) {
  if (!row.jobs && !row.completed_trips) return null;
  const completion = row.jobs ? row.completed_jobs / row.jobs : 0;
  const verification = row.completed_trips ? (row.completed_trips - row.unverified_trips) / row.completed_trips : 1;
  const issues = row.open_issues ? 1 - row.overdue_issues / row.open_issues : 1;
  const blocked = ["suspended", "permit_missing", "permit_expired"].includes(row.compliance_state);
  const standing = blocked ? 0 : row.critical_compliance_cases > 0 ? 0.3 : row.open_compliance_cases > 0 ? 0.7 : 1;
  const score = completion * 50 + verification * 20 + issues * 15 + standing * 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreBand(score: number | null) {
  if (score === null) return "no_activity" as const;
  if (score >= 85) return "good" as const;
  if (score >= 65) return "watch" as const;
  return "action_required" as const;
}
