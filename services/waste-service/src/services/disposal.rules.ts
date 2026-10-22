// Disposal verification rules: when a completed collection trip must show a KCCA weighbridge ticket, how its state is
// named, and how a company's verification rate and standing are worked out. Pure so KCCA can review the thresholds and
// tests can pin them; the repository's SQL uses the same constants.

export const DISPOSAL_RULES = {
  /** A completed trip has this long to reach a weighbridge before it counts as unverified. */
  graceHours: 48,
  /** A completed ticket not linked to a trip after this long is shown to KCCA. */
  unlinkedTicketHours: 24,
  /** Verification rate at or above which a company is in good standing, and below which it needs action. */
  goodRate: 95,
  actionRate: 80,
  /** Trips before this date are not assessed (history from before weighbridge tickets were linked to trips). */
  firstDate: process.env.DISPOSAL_FIRST_DATE || "2026-10-01",
};

/**
 * verified            a completed KCCA weighbridge ticket is linked
 * weighing            the vehicle is on the weighbridge (ticket open)
 * explained           KCCA accepted the company's explanation
 * explanation_review  an explanation waits for KCCA
 * pending             still within the grace period
 * declared            the company typed a ticket number that no KCCA weighbridge recorded
 * unverified          past the grace period with nothing at all
 */
export const DISPOSAL_STATES = ["verified", "weighing", "explained", "explanation_review", "pending", "declared", "unverified"] as const;
export type DisposalState = typeof DISPOSAL_STATES[number];
export const EXCEPTION_STATES: DisposalState[] = ["declared", "unverified"];

export const EXPLANATION_REASONS = {
  no_load: "The vehicle came back empty",
  delivered_elsewhere: "Delivered to a licensed recycler or other approved site",
  vehicle_breakdown: "Vehicle broke down; load transferred",
  combined_load: "Combined with another trip's load",
  weighbridge_unavailable: "Weighbridge not working",
  other: "Other",
} as const;
export type ExplanationReason = keyof typeof EXPLANATION_REASONS;

export type StateCounts = Partial<Record<DisposalState, number>>;

/** Trips whose disposal can be judged: everything past the grace period and not on the weighbridge right now. */
export function dueTrips(counts: StateCounts): number {
  return DISPOSAL_STATES.filter(state => state !== "pending" && state !== "weighing").reduce((sum, state) => sum + (counts[state] ?? 0), 0);
}

/** Share of due trips that were verified or explained, one decimal place; null without due trips. */
export function verificationRate(counts: StateCounts): number | null {
  const due = dueTrips(counts);
  if (!due) return null;
  return Math.round((((counts.verified ?? 0) + (counts.explained ?? 0)) / due) * 1000) / 10;
}

export type DisposalStanding = "good" | "watch" | "action" | "no_trips";

export function disposalStanding(rate: number | null): DisposalStanding {
  if (rate === null) return "no_trips";
  if (rate >= DISPOSAL_RULES.goodRate) return "good";
  return rate >= DISPOSAL_RULES.actionRate ? "watch" : "action";
}

/** Checks an explanation before it is stored; returns the reason it cannot be accepted, or null. */
export function explanationError(input: { reason: string; details: string; relatedTicketId?: string | null }): string | null {
  if (!(input.reason in EXPLANATION_REASONS)) return "Choose a reason";
  if (input.details.trim().length < 5) return "Describe what happened";
  if (input.reason === "combined_load" && !input.relatedTicketId) return "Choose the weighbridge ticket that carried this load";
  return null;
}

/** SQL expression naming a trip's state from the trip_disposal_facts columns; $graceParam holds DISPOSAL_RULES.graceHours. */
export function disposalStateSql(alias: string, graceParam: string): string {
  return `CASE WHEN ${alias}.ticket_status='completed' THEN 'verified'
    WHEN ${alias}.ticket_status='open' THEN 'weighing'
    WHEN ${alias}.explanation_status='accepted' THEN 'explained'
    WHEN ${alias}.explanation_status='submitted' THEN 'explanation_review'
    WHEN ${alias}.completed_at>LOCALTIMESTAMP-make_interval(hours=>${graceParam}::int) THEN 'pending'
    WHEN ${alias}.declared_ticket IS NOT NULL THEN 'declared'
    ELSE 'unverified' END`;
}
