import type { PoolClient } from "pg";
import { dbPool } from "../config/database";
import { Page, queryPage } from "../utils/pagination";
import type { Period } from "../services/recycling-oversight.rules";
import { AppealDecision, OPEN, PENALTY_RULES, amountFor, appealOutcome, canAppeal, canEscalate, issueDates, ugx } from "../services/penalty.rules";
import { notifyOrganization, notifyRole } from "../services/notify";
import { reviewPermit } from "./permit-lifecycle.repository";

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export type Scope = { userId: string; organizationId: string | null; kind: "kcca" | "company" };

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
const todayOf = async (c: PoolClient | typeof dbPool) => (await c.query("SELECT CURRENT_DATE::text AS d")).rows[0].d as string;
export const today = () => todayOf(dbPool);

async function log(c: PoolClient, noticeId: string, action: string, from: string | null, to: string, note: string | null, actor: string) {
  await c.query("INSERT INTO penalty_history(notice_id,action,from_status,to_status,note,actor_user_id) VALUES($1,$2,$3,$4,$5,$6)", [noticeId, action, from, to, note, actor]);
}

// ---------- Schedule ----------

export async function schedule(activeOnly: boolean) {
  return (await dbPool.query(
    "SELECT code,title,description,amount_ugx::float AS amount_ugx,repeat_amount_ugx::float AS repeat_amount_ugx,is_active,updated_at FROM penalty_schedule WHERE ($1::boolean=false OR is_active) ORDER BY title",
    [activeOnly])).rows;
}

export async function updateScheduleItem(code: string, userId: string, input: { amountUgx: number; repeatAmountUgx: number; isActive: boolean }) {
  if (input.repeatAmountUgx < input.amountUgx) throw fail(400, "The repeat amount cannot be lower than the first-offence amount");
  return inTransaction(async c => {
    const row = (await c.query(
      `UPDATE penalty_schedule SET amount_ugx=$2,repeat_amount_ugx=$3,is_active=$4,updated_by=$5,updated_at=CURRENT_TIMESTAMP WHERE code=$1
       RETURNING code,title,amount_ugx::float AS amount_ugx,repeat_amount_ugx::float AS repeat_amount_ugx,is_active`,
      [code, input.amountUgx, input.repeatAmountUgx, input.isActive, userId])).rows[0];
    if (!row) throw fail(404, "Penalty not found in the schedule");
    await c.query("INSERT INTO penalty_schedule_history(code,amount_ugx,repeat_amount_ugx,is_active,changed_by) VALUES($1,$2,$3,$4,$5)",
      [code, input.amountUgx, input.repeatAmountUgx, input.isActive, userId]);
    return row;
  });
}

// ---------- Reading ----------

const COLUMNS = `n.id,n.notice_number,n.organization_id,o.name AS organization_name,n.schedule_code,s.title AS offence,n.offence_number,
  n.original_amount_ugx::float AS original_amount_ugx,n.amount_ugx::float AS amount_ugx,n.grounds,n.compliance_case_id,c.case_number,
  n.dumping_site_id,d.site_number,n.return_period,n.status,n.issued_at,n.appeal_deadline::text AS appeal_deadline,n.due_on::text AS due_on,
  n.payment_reference,n.paid_on::text AS paid_on,n.payment_submitted_at,n.payment_confirmed_at,n.waived_reason,n.escalated_at,
  (n.status IN('issued','payment_submitted') AND n.due_on<CURRENT_DATE) AS overdue,
  EXISTS(SELECT 1 FROM penalty_appeals a WHERE a.notice_id=n.id) AS appealed_before`;
const FROM = `FROM penalty_notices n JOIN organizations o ON o.id=n.organization_id JOIN penalty_schedule s ON s.code=n.schedule_code
  LEFT JOIN collector_compliance_cases c ON c.id=n.compliance_case_id LEFT JOIN dumping_sites d ON d.id=n.dumping_site_id`;

export type NoticeFilter = { status: string | null; organizationId: string | null };

export async function listNotices(filter: NoticeFilter, page?: Page) {
  return queryPage(
    `SELECT ${COLUMNS} ${FROM}
     WHERE ($2::uuid IS NULL OR n.organization_id=$2::uuid)
       AND ($1::text IS NULL OR ($1='open' AND n.status=ANY($3::text[])) OR ($1='overdue' AND n.status IN('issued','payment_submitted') AND n.due_on<CURRENT_DATE)
         OR ($1='escalate' AND n.status='issued' AND n.escalated_at IS NULL AND n.due_on<CURRENT_DATE-$4::int) OR n.status=$1)
     ORDER BY CASE n.status WHEN 'appealed' THEN 0 WHEN 'payment_submitted' THEN 1 WHEN 'issued' THEN 2 ELSE 3 END,n.due_on,n.issued_at DESC,n.id`,
    [filter.status, filter.organizationId, OPEN, PENALTY_RULES.escalateAfterDays], page);
}

async function noticeFor(c: PoolClient | typeof dbPool, id: string, scope: Scope, lock = false) {
  const row = (await c.query(`SELECT ${COLUMNS} ${FROM} WHERE n.id=$1::uuid AND ($2='kcca' OR n.organization_id=$3::uuid)${lock ? " FOR UPDATE OF n" : ""}`,
    [id, scope.kind, scope.organizationId])).rows[0];
  if (!row) throw fail(404, "Penalty notice not found");
  return row;
}

export async function noticeDetail(id: string, scope: Scope) {
  const notice = await noticeFor(dbPool, id, scope);
  const [appeal, history] = await Promise.all([
    dbPool.query(`SELECT a.grounds,a.submitted_at,u.full_name AS submitted_by_name,a.decision,a.decision_note,a.decided_at FROM penalty_appeals a
      JOIN users u ON u.id=a.submitted_by WHERE a.notice_id=$1`, [id]),
    dbPool.query(`SELECT h.action,h.from_status,h.to_status,h.note,h.created_at,u.full_name AS actor_name FROM penalty_history h
      LEFT JOIN users u ON u.id=h.actor_user_id WHERE h.notice_id=$1 ORDER BY h.created_at,h.id`, [id]),
  ]);
  const day = await today();
  return {
    ...notice, appeal: appeal.rows[0] ?? null, history: history.rows,
    can: {
      appeal: canAppeal(notice, day) === null, escalate: canEscalate(notice, day) === null,
      escalate_reason: canEscalate(notice, day),
    },
  };
}

// ---------- KCCA: issuing ----------

export type IssueInput = { organizationId: string; scheduleCode: string; grounds: string; complianceCaseId?: string | null; dumpingSiteId?: string | null; returnPeriod?: string | null };

export async function issueNotice(userId: string, input: IssueInput) {
  return inTransaction(async c => {
    const org = (await c.query("SELECT id,name FROM organizations WHERE id=$1::uuid AND type IN('waste_collection_company','recycling_company','processing_plant')", [input.organizationId])).rows[0];
    if (!org) throw fail(400, "Choose a licensed waste company");
    const item = (await c.query("SELECT code,title,amount_ugx,repeat_amount_ugx,is_active FROM penalty_schedule WHERE code=$1", [input.scheduleCode])).rows[0];
    if (!item || !item.is_active) throw fail(400, "Choose an offence from the current penalty schedule");
    if (input.complianceCaseId && !(await c.query("SELECT 1 FROM collector_compliance_cases WHERE id=$1::uuid AND organization_id=$2::uuid", [input.complianceCaseId, org.id])).rowCount) {
      throw fail(400, "The compliance case belongs to another company");
    }
    if (input.dumpingSiteId && !(await c.query(
      "SELECT 1 FROM dumping_sites WHERE id=$1::uuid AND $2::uuid IN(responsible_organization_id,cleanup_organization_id)", [input.dumpingSiteId, org.id])).rowCount) {
      throw fail(400, "KCCA has not linked this dumping site to the company");
    }
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`penalty:${org.id}:${item.code}`]);
    const earlier = (await c.query(
      "SELECT COUNT(*)::int AS n FROM penalty_notices WHERE organization_id=$1 AND schedule_code=$2 AND status<>'waived' AND issued_at>CURRENT_TIMESTAMP-make_interval(days=>$3)",
      [org.id, item.code, PENALTY_RULES.repeatWindowDays])).rows[0].n as number;
    const { offenceNumber, amount } = amountFor(item, earlier);
    const dates = issueDates(await todayOf(c));
    let notice;
    try {
      await c.query("SAVEPOINT issue_notice");
      notice = (await c.query(
        `INSERT INTO penalty_notices(organization_id,schedule_code,offence_number,original_amount_ugx,amount_ugx,grounds,compliance_case_id,dumping_site_id,return_period,issued_by,appeal_deadline,due_on)
         VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,notice_number`,
        [org.id, item.code, offenceNumber, amount, input.grounds.trim(), input.complianceCaseId || null, input.dumpingSiteId || null, input.returnPeriod || null, userId, dates.appealDeadline, dates.dueOn])).rows[0];
    } catch (error) {
      if ((error as { code?: string }).code === "23505") { await c.query("ROLLBACK TO SAVEPOINT issue_notice"); throw fail(409, "A penalty for this offence has already been issued"); }
      throw error;
    }
    await log(c, notice.id, "issued", null, "issued", `${item.title}, offence ${offenceNumber}: ${ugx(amount)}.`, userId);
    await notifyOrganization(c, org.id, ["company_admin"], {
      category: "penalties", severity: "warning", title: `KCCA penalty notice ${notice.notice_number}: ${ugx(amount)}`,
      body: `${item.title}${offenceNumber > 1 ? ` (repeat offence)` : ""}. Pay by ${dayLabel(dates.dueOn)} or appeal by ${dayLabel(dates.appealDeadline)}.`,
      link: "/dashboard/penalty-notices", dedupeKey: `penalty-issued:${notice.id}`,
    });
    return { id: notice.id as string, notice_number: notice.notice_number as string, amount_ugx: amount, offence_number: offenceNumber, ...dates };
  });
}

// ---------- Company ----------

export async function appeal(id: string, scope: Scope, grounds: string) {
  return inTransaction(async c => {
    const notice = await noticeFor(c, id, scope, true);
    const problem = canAppeal(notice, await todayOf(c));
    if (problem) throw fail(409, problem);
    await c.query("INSERT INTO penalty_appeals(notice_id,grounds,submitted_by) VALUES($1,$2,$3)", [id, grounds.trim(), scope.userId]);
    await c.query("UPDATE penalty_notices SET status='appealed' WHERE id=$1", [id]);
    await log(c, id, "appealed", "issued", "appealed", grounds.trim(), scope.userId);
    await notifyRole(c, "kcca_admin", { category: "penalties", severity: "info", title: `Appeal against ${notice.notice_number}`,
      body: `${notice.organization_name} appeals the ${ugx(notice.amount_ugx)} penalty for ${notice.offence.toLowerCase()}. Decide it in Penalties.`,
      link: "/dashboard/penalties", dedupeKey: `penalty-appeal:${id}` }, notice.organization_id);
    return { id, status: "appealed" };
  });
}

export async function submitPayment(id: string, scope: Scope, input: { reference: string; paidOn: string }) {
  return inTransaction(async c => {
    const notice = await noticeFor(c, id, scope, true);
    if (notice.status !== "issued") throw fail(409, notice.status === "appealed" ? "Wait for KCCA's decision on the appeal" : "This notice is not awaiting payment");
    if (input.paidOn > await todayOf(c)) throw fail(400, "The payment date cannot be in the future");
    await c.query("UPDATE penalty_notices SET status='payment_submitted',payment_reference=$2,paid_on=$3,payment_submitted_by=$4,payment_submitted_at=CURRENT_TIMESTAMP WHERE id=$1",
      [id, input.reference.trim(), input.paidOn, scope.userId]);
    await log(c, id, "payment_submitted", "issued", "payment_submitted", `Reference ${input.reference.trim()}, paid ${input.paidOn}.`, scope.userId);
    await notifyRole(c, "kcca_admin", { category: "penalties", severity: "info", title: `Payment to confirm: ${notice.notice_number}`,
      body: `${notice.organization_name} reports paying ${ugx(notice.amount_ugx)} (reference ${input.reference.trim()}).`,
      link: "/dashboard/penalties", dedupeKey: `penalty-payment:${id}:${input.reference.trim()}` }, notice.organization_id);
    return { id, status: "payment_submitted" };
  });
}

// ---------- KCCA: decisions ----------

const kcca = (userId: string): Scope => ({ userId, organizationId: null, kind: "kcca" });

/** Confirms the company's submitted payment, or records a payment KCCA received directly (with its reference). */
export async function confirmPayment(id: string, userId: string, input: { reference?: string; paidOn?: string }) {
  return inTransaction(async c => {
    const notice = await noticeFor(c, id, kcca(userId), true);
    if (notice.status === "issued") {
      if (!input.reference || !input.paidOn) throw fail(400, "Enter the payment reference and date");
      await c.query("UPDATE penalty_notices SET status='paid',payment_reference=$2,paid_on=$3,payment_confirmed_by=$4,payment_confirmed_at=CURRENT_TIMESTAMP WHERE id=$1",
        [id, input.reference.trim(), input.paidOn, userId]);
    } else if (notice.status === "payment_submitted") {
      await c.query("UPDATE penalty_notices SET status='paid',payment_confirmed_by=$2,payment_confirmed_at=CURRENT_TIMESTAMP WHERE id=$1", [id, userId]);
    } else throw fail(409, "This notice is not awaiting payment");
    await log(c, id, "paid", notice.status, "paid", `Payment ${input.reference?.trim() || notice.payment_reference} confirmed.`, userId);
    await notifyOrganization(c, notice.organization_id, ["company_admin"], { category: "penalties", severity: "info",
      title: `Payment confirmed: ${notice.notice_number}`, body: `KCCA confirmed your payment of ${ugx(notice.amount_ugx)}.${notice.escalated_at ? " Ask KCCA to reinstate your permit." : ""}`,
      link: "/dashboard/penalty-notices", dedupeKey: `penalty-paid:${id}` });
    if (notice.escalated_at) {
      await notifyRole(c, "kcca_admin", { category: "penalties", severity: "info", title: `Escalated fine paid: ${notice.notice_number}`,
        body: `${notice.organization_name} has paid. Their permit was suspended for this fine; reinstate it in Permits if nothing else stands in the way.`,
        link: "/dashboard/permits", dedupeKey: `penalty-paid-escalated:${id}` }, notice.organization_id);
    }
    return { id, status: "paid" };
  });
}

export async function rejectPayment(id: string, userId: string, reason: string) {
  return inTransaction(async c => {
    const notice = await noticeFor(c, id, kcca(userId), true);
    if (notice.status !== "payment_submitted") throw fail(409, "There is no submitted payment to reject");
    await c.query("UPDATE penalty_notices SET status='issued',payment_reference=NULL,paid_on=NULL,payment_submitted_by=NULL,payment_submitted_at=NULL WHERE id=$1", [id]);
    await log(c, id, "payment_rejected", "payment_submitted", "issued", reason, userId);
    await notifyOrganization(c, notice.organization_id, ["company_admin"], { category: "penalties", severity: "warning",
      title: `Payment not found: ${notice.notice_number}`, body: `KCCA: ${reason}. The notice is still due on ${dayLabel(notice.due_on)}.`,
      link: "/dashboard/penalty-notices", dedupeKey: `penalty-payment-rejected:${id}:${Date.now()}` });
    return { id, status: "issued" };
  });
}

export async function decideAppeal(id: string, userId: string, input: AppealDecision & { note: string }) {
  return inTransaction(async c => {
    const notice = await noticeFor(c, id, kcca(userId), true);
    if (notice.status !== "appealed") throw fail(409, "There is no open appeal on this notice");
    const outcome = appealOutcome(notice, input, await todayOf(c));
    await c.query("UPDATE penalty_appeals SET decision=$2,decision_note=$3,decided_by=$4,decided_at=CURRENT_TIMESTAMP WHERE notice_id=$1",
      [id, input.decision, input.note.trim(), userId]);
    await c.query("UPDATE penalty_notices SET status=$2,amount_ugx=$3,due_on=$4,waived_reason=$5 WHERE id=$1",
      [id, outcome.status, outcome.amount, outcome.dueOn, outcome.status === "waived" ? `Appeal allowed: ${input.note.trim()}` : null]);
    await log(c, id, `appeal_${input.decision}`, "appealed", outcome.status,
      input.decision === "reduced" ? `Reduced to ${ugx(outcome.amount)}. ${input.note.trim()}` : input.note.trim(), userId);
    const title = input.decision === "withdrawn" ? `Penalty withdrawn: ${notice.notice_number}` : input.decision === "reduced"
      ? `Appeal partly allowed: ${notice.notice_number}` : `Appeal not allowed: ${notice.notice_number}`;
    await notifyOrganization(c, notice.organization_id, ["company_admin"], { category: "penalties", severity: input.decision === "withdrawn" ? "info" : "warning", title,
      body: input.decision === "withdrawn" ? `KCCA withdrew the penalty. ${input.note.trim()}` : `KCCA: ${input.note.trim()} Pay ${ugx(outcome.amount)} by ${dayLabel(outcome.dueOn)}.`,
      link: "/dashboard/penalty-notices", dedupeKey: `penalty-decision:${id}` });
    return { id, status: outcome.status, amount_ugx: outcome.amount, due_on: outcome.dueOn };
  });
}

export async function withdraw(id: string, userId: string, reason: string) {
  return inTransaction(async c => {
    const notice = await noticeFor(c, id, kcca(userId), true);
    if (notice.status !== "issued") throw fail(409, notice.status === "appealed" ? "Decide the appeal instead" : "Only an unpaid notice can be withdrawn");
    await c.query("UPDATE penalty_notices SET status='waived',waived_reason=$2 WHERE id=$1", [id, reason]);
    await log(c, id, "waived", "issued", "waived", reason, userId);
    await notifyOrganization(c, notice.organization_id, ["company_admin"], { category: "penalties", severity: "info", title: `Penalty withdrawn: ${notice.notice_number}`,
      body: `KCCA withdrew the ${ugx(notice.amount_ugx)} penalty. ${reason}`, link: "/dashboard/penalty-notices", dedupeKey: `penalty-withdrawn:${id}` });
    return { id, status: "waived" };
  });
}

/**
 * Suspends the company's permit for a fine left unpaid well past its due date. The permit is suspended through the
 * Module 1 permit process (its own transaction, history and notices); the notice then records the escalation.
 */
export async function escalate(id: string, userId: string, note: string) {
  const notice = await noticeFor(dbPool, id, kcca(userId));
  const problem = canEscalate(notice, await today());
  if (problem) throw fail(409, problem);
  const permit = (await dbPool.query(
    "SELECT id,permit_number FROM organization_permit_applications WHERE organization_id=$1 AND status='approved' ORDER BY valid_until DESC NULLS LAST LIMIT 1", [notice.organization_id])).rows[0];
  if (!permit) throw fail(409, "The company has no permit in force to suspend");
  return inTransaction(async c => {
    const locked = await noticeFor(c, id, kcca(userId), true);
    if (canEscalate(locked, await todayOf(c))) throw fail(409, "The notice changed; reload it");
    await reviewPermit(permit.id, userId, { action: "suspend", notes: `Unpaid penalty ${notice.notice_number} (${ugx(notice.amount_ugx)}, due ${notice.due_on}). ${note}`.trim() });
    await c.query("UPDATE penalty_notices SET escalated_at=CURRENT_TIMESTAMP,escalated_by=$2 WHERE id=$1", [id, userId]);
    await log(c, id, "escalated", "issued", "issued", `Permit ${permit.permit_number} suspended. ${note}`.trim(), userId);
    return { id, permit_number: permit.permit_number, permit_status: "suspended" };
  });
}

// ---------- Overviews ----------

export async function cityOverview(period: Period) {
  const [totals, bySchedule, byCompany] = await Promise.all([
    dbPool.query(
      `SELECT COUNT(*) FILTER(WHERE issued_at::date BETWEEN $1::date AND $2::date)::int AS issued,
         COALESCE(SUM(original_amount_ugx) FILTER(WHERE issued_at::date BETWEEN $1::date AND $2::date),0)::float AS issued_ugx,
         COALESCE(SUM(amount_ugx) FILTER(WHERE status='paid' AND payment_confirmed_at::date BETWEEN $1::date AND $2::date),0)::float AS collected_ugx,
         COUNT(*) FILTER(WHERE status=ANY($3::text[]))::int AS open,
         COALESCE(SUM(amount_ugx) FILTER(WHERE status=ANY($3::text[])),0)::float AS outstanding_ugx,
         COUNT(*) FILTER(WHERE status IN('issued','payment_submitted') AND due_on<CURRENT_DATE)::int AS overdue,
         COALESCE(SUM(amount_ugx) FILTER(WHERE status IN('issued','payment_submitted') AND due_on<CURRENT_DATE),0)::float AS overdue_ugx,
         COUNT(*) FILTER(WHERE status='appealed')::int AS appeals,
         COUNT(*) FILTER(WHERE status='payment_submitted')::int AS payments_to_confirm,
         COUNT(*) FILTER(WHERE status='issued' AND escalated_at IS NULL AND due_on<CURRENT_DATE-$4::int)::int AS can_escalate,
         COUNT(*) FILTER(WHERE status='waived' AND updated_at::date BETWEEN $1::date AND $2::date)::int AS withdrawn
       FROM penalty_notices`, [period.from, period.to, OPEN, PENALTY_RULES.escalateAfterDays]),
    dbPool.query(
      `SELECT s.code,s.title,COUNT(n.id)::int AS notices,COALESCE(SUM(n.original_amount_ugx),0)::float AS issued_ugx,
         COALESCE(SUM(n.amount_ugx) FILTER(WHERE n.status='paid'),0)::float AS collected_ugx
       FROM penalty_schedule s LEFT JOIN penalty_notices n ON n.schedule_code=s.code AND n.issued_at::date BETWEEN $1::date AND $2::date
       GROUP BY s.code,s.title ORDER BY notices DESC,s.title`, [period.from, period.to]),
    dbPool.query(
      `SELECT o.id,o.name,COUNT(n.id) FILTER(WHERE n.status=ANY($1::text[]))::int AS open,
         COALESCE(SUM(n.amount_ugx) FILTER(WHERE n.status=ANY($1::text[])),0)::float AS outstanding_ugx,
         COUNT(n.id) FILTER(WHERE n.status IN('issued','payment_submitted') AND n.due_on<CURRENT_DATE)::int AS overdue,
         COUNT(n.id) FILTER(WHERE n.issued_at>CURRENT_TIMESTAMP-make_interval(days=>$2))::int AS last_year
       FROM organizations o JOIN penalty_notices n ON n.organization_id=o.id GROUP BY o.id,o.name
       HAVING COUNT(n.id) FILTER(WHERE n.status=ANY($1::text[]))>0 ORDER BY outstanding_ugx DESC,o.name LIMIT 50`, [OPEN, PENALTY_RULES.repeatWindowDays]),
  ]);
  return { period, rules: PENALTY_RULES, totals: totals.rows[0], schedule: bySchedule.rows, companies: byCompany.rows };
}

export async function companySummary(organizationId: string) {
  const row = (await dbPool.query(
    `SELECT COUNT(*) FILTER(WHERE status=ANY($2::text[]))::int AS open,COALESCE(SUM(amount_ugx) FILTER(WHERE status=ANY($2::text[])),0)::float AS outstanding_ugx,
       COUNT(*) FILTER(WHERE status IN('issued','payment_submitted') AND due_on<CURRENT_DATE)::int AS overdue,
       COUNT(*) FILTER(WHERE status='appealed')::int AS appeals,
       COALESCE(SUM(amount_ugx) FILTER(WHERE status='paid' AND payment_confirmed_at>CURRENT_TIMESTAMP-interval '365 days'),0)::float AS paid_last_year
     FROM penalty_notices WHERE organization_id=$1`, [organizationId, OPEN])).rows[0];
  return { ...row, rules: PENALTY_RULES };
}

// ---------- Scheduled check ----------

/** Overdue notices are flagged once to the company; notices that may be escalated are flagged once to KCCA. */
export async function notifyPenaltyDeadlines(client: PoolClient) {
  const due = (await client.query(
    `SELECT n.id,n.notice_number,n.organization_id,o.name,n.amount_ugx,n.due_on::text AS due_on,n.status,n.escalated_at,
       (n.status='issued' AND n.escalated_at IS NULL AND n.due_on<CURRENT_DATE-$1::int) AS escalate
     FROM penalty_notices n JOIN organizations o ON o.id=n.organization_id
     WHERE n.status='issued' AND n.due_on<CURRENT_DATE`, [PENALTY_RULES.escalateAfterDays])).rows;
  for (const notice of due) {
    await notifyOrganization(client, notice.organization_id, ["company_admin"], {
      category: "penalties", severity: "warning", title: `Penalty overdue: ${notice.notice_number}`,
      body: `${ugx(notice.amount_ugx)} was due on ${dayLabel(notice.due_on)}. Unpaid penalties can lead to suspension of your KCCA permit.`,
      link: "/dashboard/penalty-notices", dedupeKey: `penalty-overdue:${notice.id}:${notice.due_on}`,
    });
    if (notice.escalate) {
      await notifyRole(client, "kcca_admin", {
        category: "penalties", severity: "warning", title: `Unpaid penalty may be escalated: ${notice.notice_number}`,
        body: `${notice.name} has not paid ${ugx(notice.amount_ugx)}, due ${dayLabel(notice.due_on)}. You can suspend their permit from Penalties.`,
        link: "/dashboard/penalties", dedupeKey: `penalty-escalate:${notice.id}:${notice.due_on}`,
      }, notice.organization_id);
    }
  }
  return due.length;
}

