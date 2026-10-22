// Subscription rules for the Waste Management SaaS: billing periods, what each period costs, proration on upgrade,
// payment terms and when an unpaid subscription becomes past due or suspended. Pure so the business can review the terms
// and tests can pin them.

export const BILLING_RULES = {
  /** Days from issue to pay an invoice. */
  daysToPay: 7,
  /** Days after the due date before the subscription is suspended (read-only). */
  suspendAfterDays: 14,
  /** Proration charges are rounded to this many shillings. */
  roundTo: 100,
};

export type Cycle = "monthly" | "annual";
export type Plan = { monthly_fee_ugx: number | string; annual_fee_ugx: number | string; max_vehicles: number | null; max_users: number | null };
export const STATUSES = ["trialing", "active", "past_due", "suspended", "cancelled", "complimentary"] as const;
export type SubscriptionStatus = typeof STATUSES[number];
/** Statuses in which the company works normally; suspended and cancelled companies can still read and do KCCA obligations. */
export const FULL_ACCESS: SubscriptionStatus[] = ["trialing", "active", "past_due", "complimentary"];

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}
export const periodEnd = (start: string, cycle: Cycle) => addMonths(start, cycle === "annual" ? 12 : 1);
export const priceFor = (plan: Plan, cycle: Cycle) => Number(cycle === "annual" ? plan.annual_fee_ugx : plan.monthly_fee_ugx);
export const dueOn = (issuedOn: string) => addDays(issuedOn, BILLING_RULES.daysToPay);
/** Monthly recurring revenue a subscription contributes. */
export const monthlyValue = (plan: Plan, cycle: Cycle) => cycle === "annual" ? Math.round(Number(plan.annual_fee_ugx) / 12) : Number(plan.monthly_fee_ugx);

/** Charge for moving to a dearer plan part-way through a paid period: the difference for the days that remain. */
export function proration(oldPrice: number, newPrice: number, periodStart: string, periodEnd_: string, today: string): number {
  const total = (Date.parse(periodEnd_) - Date.parse(periodStart)) / 86400000;
  const left = Math.max(0, (Date.parse(periodEnd_) - Date.parse(today)) / 86400000);
  if (total <= 0 || newPrice <= oldPrice) return 0;
  return Math.round(((newPrice - oldPrice) * left / total) / BILLING_RULES.roundTo) * BILLING_RULES.roundTo;
}

/** What an unpaid invoice does to the subscription on a given day. */
export function overdueEffect(due: string, today: string): "none" | "past_due" | "suspend" {
  if (today <= due) return "none";
  return today > addDays(due, BILLING_RULES.suspendAfterDays) ? "suspend" : "past_due";
}

/** A plan change: dearer plans apply now, cheaper ones at the end of the period (and must fit the current usage). */
export function planChange(current: Plan, next: Plan, usage: { vehicles: number; users: number }) {
  const upgrade = Number(next.monthly_fee_ugx) > Number(current.monthly_fee_ugx);
  const blocked = [
    next.max_vehicles !== null && usage.vehicles > next.max_vehicles ? `${usage.vehicles} vehicles (the plan allows ${next.max_vehicles})` : "",
    next.max_users !== null && usage.users > next.max_users ? `${usage.users} active staff (the plan allows ${next.max_users})` : "",
  ].filter(Boolean);
  return { timing: upgrade ? "now" as const : "period_end" as const, blocked: blocked.length ? `You have ${blocked.join(" and ")}. Reduce them before moving to this plan.` : null };
}
