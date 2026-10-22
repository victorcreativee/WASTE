// Penalty rules: payment and appeal periods, repeat offences, appeal outcomes and when an unpaid fine may be escalated to
// permit suspension. Pure so KCCA can review the periods and tests can pin them; the database guard (migration 101)
// enforces the same status moves.

export const PENALTY_RULES = {
  /** Days from issue to pay. */
  daysToPay: 30,
  /** Days from issue in which the company may appeal. */
  appealDays: 14,
  /** Days to pay after KCCA decides an appeal (upheld or reduced), never earlier than the original due date. */
  daysToPayAfterAppeal: 14,
  /** A notice unpaid this many days after its due date may be escalated to permit suspension. */
  escalateAfterDays: 30,
  /** A notice for the same offence within this window is a repeat offence (higher amount). */
  repeatWindowDays: 365,
};

export const STATUSES = ["issued", "appealed", "payment_submitted", "paid", "waived"] as const;
export type PenaltyStatus = typeof STATUSES[number];
export const OPEN: PenaltyStatus[] = ["issued", "appealed", "payment_submitted"];

const MOVES: Record<PenaltyStatus, PenaltyStatus[]> = {
  issued: ["appealed", "payment_submitted", "paid", "waived"],
  appealed: ["issued", "waived"],
  payment_submitted: ["paid", "issued"],
  paid: [],
  waived: [],
};
export const canMove = (from: PenaltyStatus, to: PenaltyStatus) => MOVES[from].includes(to);

const plus = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

export function issueDates(today: string) {
  return { appealDeadline: plus(today, PENALTY_RULES.appealDays), dueOn: plus(today, PENALTY_RULES.daysToPay) };
}

/** Amount for an offence given how many notices for it the company had in the repeat window. */
export function amountFor(schedule: { amount_ugx: number; repeat_amount_ugx: number }, earlierOffences: number) {
  return { offenceNumber: earlierOffences + 1, amount: earlierOffences > 0 ? Number(schedule.repeat_amount_ugx) : Number(schedule.amount_ugx) };
}

export function canAppeal(notice: { status: PenaltyStatus; appeal_deadline: string; appealed_before: boolean }, today: string): string | null {
  if (notice.appealed_before) return "This notice has already been appealed";
  if (notice.status !== "issued") return "Only an unpaid notice can be appealed";
  if (today > notice.appeal_deadline) return `The appeal period ended on ${notice.appeal_deadline}`;
  return null;
}

export type AppealDecision = { decision: "upheld" | "reduced" | "withdrawn"; newAmount?: number };

/** What an appeal decision does to the notice: its new status, amount and due date. */
export function appealOutcome(notice: { amount_ugx: number; due_on: string }, input: AppealDecision, today: string) {
  if (input.decision === "withdrawn") return { status: "waived" as const, amount: Number(notice.amount_ugx), dueOn: notice.due_on };
  const later = plus(today, PENALTY_RULES.daysToPayAfterAppeal);
  const dueOn = later > notice.due_on ? later : notice.due_on;
  if (input.decision === "upheld") return { status: "issued" as const, amount: Number(notice.amount_ugx), dueOn };
  const amount = Math.round(Number(input.newAmount));
  if (!Number.isFinite(amount) || amount <= 0 || amount >= Number(notice.amount_ugx)) {
    throw Object.assign(new Error("A reduced amount must be above zero and below the current amount"), { statusCode: 400 });
  }
  return { status: "issued" as const, amount, dueOn };
}

export function isOverdue(notice: { status: PenaltyStatus; due_on: string }, today: string) {
  return (notice.status === "issued" || notice.status === "payment_submitted") && notice.due_on < today;
}

/** An unpaid, unescalated notice may be escalated once it is escalateAfterDays past due (an open appeal blocks it). */
export function canEscalate(notice: { status: PenaltyStatus; due_on: string; escalated_at: string | null }, today: string): string | null {
  if (notice.escalated_at) return "This notice was already escalated";
  if (notice.status !== "issued") return notice.status === "appealed" ? "Decide the appeal first" : "Only an unpaid notice can be escalated";
  if (today <= plus(notice.due_on, PENALTY_RULES.escalateAfterDays)) return `A notice can be escalated ${PENALTY_RULES.escalateAfterDays} days after its due date (${plus(notice.due_on, PENALTY_RULES.escalateAfterDays)})`;
  return null;
}

export const ugx = (amount: number | string) => `UGX ${Number(amount).toLocaleString("en-GB")}`;
