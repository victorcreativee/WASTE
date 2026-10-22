// Permit lifecycle rules shared by KCCA review, company renewal requests and public verification.
// Dates are ISO calendar dates (YYYY-MM-DD) taken from the database's CURRENT_DATE, never the server clock.

export type PermitStatus =
  | "draft" | "submitted" | "under_review" | "information_required"
  | "approved" | "rejected" | "suspended" | "expired";

export type PermitAction =
  | "start_review" | "request_information" | "approve" | "reject"
  | "suspend" | "reinstate" | "renew" | "update_activities";

const ACTIONS_BY_STATUS: Record<string, PermitAction[]> = {
  submitted: ["start_review"],
  under_review: ["request_information", "approve", "reject"],
  information_required: ["start_review"],
  approved: ["suspend", "renew", "update_activities"],
  suspended: ["reinstate", "renew"],
  expired: ["renew"],
};

export const NEXT_STATUS: Record<PermitAction, PermitStatus> = {
  start_review: "under_review",
  request_information: "information_required",
  approve: "approved",
  reject: "rejected",
  suspend: "suspended",
  reinstate: "approved",
  renew: "approved",
  update_activities: "approved",
};

/** Companies may ask for renewal from this many days before expiry. */
export const RENEWAL_WINDOW_DAYS = 90;
/** Longest validity KCCA can grant in one decision. */
export const MAX_VALIDITY_YEARS = 5;

export function allowedPermitActions(status: string): PermitAction[] {
  return ACTIONS_BY_STATUS[status] ?? [];
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The status the public and operations should see: an approved permit past its date is expired even before the nightly job runs. */
export function effectivePermitStatus(status: string, validUntil: string | null, today: string): string {
  if (status === "approved" && validUntil && validUntil < today) return "expired";
  return status;
}

export type RenewalEligibility = { eligible: boolean; reason: string | null; opensOn: string | null };

export function renewalEligibility(
  permit: { status: string; validUntil: string | null; hasOpenRequest: boolean } | null,
  today: string,
): RenewalEligibility {
  if (!permit) return { eligible: false, reason: "No KCCA permit is linked to this organization.", opensOn: null };
  if (permit.hasOpenRequest) return { eligible: false, reason: "A renewal request is already waiting for KCCA review.", opensOn: null };
  const status = effectivePermitStatus(permit.status, permit.validUntil, today);
  if (status === "suspended") return { eligible: false, reason: "The permit is suspended. Resolve the suspension with KCCA before requesting renewal.", opensOn: null };
  if (status === "expired") return { eligible: true, reason: null, opensOn: null };
  if (status !== "approved") return { eligible: false, reason: "Only an issued permit can be renewed.", opensOn: null };
  if (!permit.validUntil) return { eligible: false, reason: "This permit has no expiry date and does not need renewal.", opensOn: null };
  const opensOn = addDays(permit.validUntil, -RENEWAL_WINDOW_DAYS);
  if (today < opensOn) return { eligible: false, reason: `Renewal opens ${RENEWAL_WINDOW_DAYS} days before expiry.`, opensOn };
  return { eligible: true, reason: null, opensOn };
}

/** A new validity date must move the permit forward and stay within the maximum term. Returns an error message or null. */
export function validityDateError(validUntil: string, currentValidUntil: string | null, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) || Number.isNaN(Date.parse(`${validUntil}T00:00:00Z`))) return "Enter a valid date.";
  if (validUntil <= today) return "The validity date must be in the future.";
  if (currentValidUntil && validUntil <= currentValidUntil) return `The new validity date must be after the current expiry (${currentValidUntil}).`;
  const latest = `${Number(today.slice(0, 4)) + MAX_VALIDITY_YEARS}${today.slice(4)}`;
  if (validUntil > latest) return `A permit can be valid for at most ${MAX_VALIDITY_YEARS} years.`;
  return null;
}

export function reminderTypeFor(daysLeft: number): "expiry_60" | "expiry_30" | "expiry_7" | null {
  if (daysLeft < 0 || daysLeft > 60) return null;
  if (daysLeft <= 7) return "expiry_7";
  if (daysLeft <= 30) return "expiry_30";
  return "expiry_60";
}

/** Accepts codes typed by people ("7f3a 91c2-b04e") and returns the stored form ("7F3A-91C2-B04E"). */
export function normalizeVerificationCode(input: string): string | null {
  const compact = String(input || "").toUpperCase().replace(/[^0-9A-F]/g, "");
  if (compact.length !== 12) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8)}`;
}
