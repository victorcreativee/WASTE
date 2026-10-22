// Monthly statutory returns: which months a company owes, when they are due, and how declared figures compare
// with what the platform recorded. Pure functions so KCCA can review and the tests can pin every rule.

/** First month for which returns are required. Earlier months are never requested. */
export const RETURNS_FIRST_PERIOD = process.env.RETURNS_FIRST_PERIOD || "2026-09";
/** Returns are due on this day of the month after the reporting month. */
export const RETURN_DUE_DAY = 15;
/** Declared figures differing from platform records by more than this share are highlighted for KCCA. */
export const VARIANCE_SHARE = 0.1;

export const COLLECTOR_FIELDS = [
  ["customers_served", "Customers served"],
  ["trips_completed", "Collection trips completed"],
  ["collections_completed", "Scheduled collections completed"],
  ["collections_missed", "Scheduled collections missed"],
  ["waste_disposed_kg", "Waste delivered for disposal (kg)"],
  ["vehicles_operated", "Vehicles operated"],
  ["staff_employed", "Staff employed"],
  ["complaints_received", "Resident complaints received"],
  ["complaints_resolved", "Resident complaints resolved"],
] as const;

export const FACTORY_FIELDS = [
  ["accepted_kg", "Material accepted (kg)"],
  ["rejected_kg", "Material rejected at the gate (kg)"],
  ["processed_kg", "Material processed (kg)"],
  ["output_kg", "Product output (kg)"],
  ["residue_kg", "Processing residue (kg)"],
  ["dispatched_kg", "Product dispatched (kg)"],
  ["staff_employed", "Staff employed"],
] as const;

export const MATERIAL_CATEGORIES = ["plastic", "paper", "metal", "glass", "organic", "textile", "other"] as const;

const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function periodStart(period: string): string {
  if (!PERIOD.test(period)) throw Object.assign(new Error("Use a reporting month in the form YYYY-MM"), { statusCode: 400 });
  return `${period}-01`;
}

export function nextPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function periodEnd(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function dueOn(period: string): string {
  return `${nextPeriod(period)}-${String(RETURN_DUE_DAY).padStart(2, "0")}`;
}

/** Months a company must report: from the later of the first returns period and the month it joined, to last month. */
export function requiredPeriods(joinedOn: string, today: string, firstPeriod = RETURNS_FIRST_PERIOD): string[] {
  const current = today.slice(0, 7);
  let period = joinedOn.slice(0, 7) > firstPeriod ? joinedOn.slice(0, 7) : firstPeriod;
  const periods: string[] = [];
  while (period < current) {
    periods.push(period);
    period = nextPeriod(period);
  }
  return periods;
}

/** A return can be filed for a completed month the company is required to report. Returns an error message or null. */
export function periodError(period: string, joinedOn: string, today: string, firstPeriod = RETURNS_FIRST_PERIOD): string | null {
  if (!PERIOD.test(period)) return "Use a reporting month in the form YYYY-MM";
  if (period >= today.slice(0, 7)) return "Returns can only be filed once the month has ended";
  if (!requiredPeriods(joinedOn, today, firstPeriod).includes(period)) return "No return is required for that month";
  return null;
}

export type PeriodState = "due" | "overdue" | "submitted" | "queried" | "accepted";

export function periodState(period: string, returnStatus: string | null, today: string): PeriodState {
  if (returnStatus === "submitted" || returnStatus === "queried" || returnStatus === "accepted") return returnStatus;
  return today > dueOn(period) ? "overdue" : "due";
}

export type Variance = { field: string; declared: number; recorded: number; difference: number };

/**
 * Compares declared and recorded numbers field by field. A field is compared only when the platform recorded
 * something for it (companies that do not use the operations modules have nothing to compare against).
 */
export function variances(declared: Record<string, number>, recorded: Record<string, number>, share = VARIANCE_SHARE): Variance[] {
  const out: Variance[] = [];
  for (const [field, recordedValue] of Object.entries(recorded)) {
    const declaredValue = declared[field];
    if (typeof declaredValue !== "number" || !recordedValue) continue;
    if (Math.abs(declaredValue - recordedValue) / recordedValue > share) {
      out.push({ field, declared: declaredValue, recorded: recordedValue, difference: declaredValue - recordedValue });
    }
  }
  return out;
}

/** Flattens a recycler return's material table to comparable numbers, e.g. plastic_collected_kg. */
export function flattenMaterials(materials: Array<{ category: string; collectedKg: number; soldKg: number }>): Record<string, number> {
  const flat: Record<string, number> = {};
  for (const row of materials) {
    flat[`${row.category}_collected_kg`] = row.collectedKg;
    flat[`${row.category}_sold_kg`] = row.soldKg;
  }
  return flat;
}
