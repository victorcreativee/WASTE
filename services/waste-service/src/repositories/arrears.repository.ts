import { dbPool } from "../config/database";

// Arrears management (migration 117): what households owe past the due date, follow-ups and promises to pay, payment
// plans, and the overdue reminder. Every query is narrowed to the company; row-level security does the same.

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const TODAY = "(now() AT TIME ZONE 'Africa/Kampala')::date";
export const BUCKETS = { all: "a.overdue_ugx>0", "1_30": "a.days_1_30_ugx>0", "31_60": "a.days_31_60_ugx>0", "61_90": "a.days_61_90_ugx>0", over_90: "a.days_over_90_ugx>0" } as const;
export type Bucket = keyof typeof BUCKETS;

/** Confirmed payments by a household to this company after a moment. */
const paidSince = (customer: string, org: string, since: string) => `coalesce((SELECT sum(pay.amount_ugx) FROM customer_payments pay
  WHERE pay.customer_id=${customer} AND pay.organization_id=${org} AND pay.status='successful' AND coalesce(pay.confirmed_at,pay.created_at)>=${since}),0)::bigint`;

/** A plan with its progress: paid since it started, due by today, and on track, behind or completed. */
const PLAN = `p.id,p.total_ugx,p.instalments,p.frequency,p.first_due_on::text AS first_due_on,p.note,p.status,p.created_by_name,p.created_at,
  p.cancelled_by_name,p.cancelled_at,p.cancel_reason,
  arrears_plan_due_on(p,p.instalments)::text AS last_due_on,
  ${paidSince("p.customer_id", "p.organization_id", "p.created_at")} AS paid_ugx,
  arrears_plan_due_by(p,${TODAY}) AS due_ugx,
  CASE WHEN p.status='cancelled' THEN 'cancelled'
       WHEN ${paidSince("p.customer_id", "p.organization_id", "p.created_at")}>=p.total_ugx THEN 'completed'
       WHEN ${paidSince("p.customer_id", "p.organization_id", "p.created_at")}<arrears_plan_due_by(p,${TODAY}) THEN 'behind'
       ELSE 'on_track' END AS progress`;

/** A promise is kept when the household paid the promised amount between the follow-up and the promised day. */
const PROMISE = `CASE WHEN f.outcome<>'promise_to_pay' THEN NULL
  WHEN coalesce((SELECT sum(pay.amount_ugx) FROM customer_payments pay WHERE pay.customer_id=f.customer_id AND pay.organization_id=f.organization_id
    AND pay.status='successful' AND coalesce(pay.confirmed_at,pay.created_at)>=f.created_at
    AND (coalesce(pay.confirmed_at,pay.created_at) AT TIME ZONE 'Africa/Kampala')::date<=f.promised_on),0)>=f.promised_amount_ugx THEN 'kept'
  WHEN f.promised_on>=${TODAY} THEN 'open' ELSE 'broken' END`;

export async function arrearsSummary(organizationId: string) {
  const [totals, collection, promises, plans] = await Promise.all([
    dbPool.query(`SELECT count(*) FILTER (WHERE overdue_ugx>0)::int households,coalesce(sum(overdue_ugx),0)::bigint overdue_ugx,
        coalesce(sum(days_1_30_ugx),0)::bigint days_1_30_ugx,coalesce(sum(days_31_60_ugx),0)::bigint days_31_60_ugx,
        coalesce(sum(days_61_90_ugx),0)::bigint days_61_90_ugx,coalesce(sum(days_over_90_ugx),0)::bigint days_over_90_ugx,
        coalesce(sum(open_ugx-overdue_ugx),0)::bigint not_yet_due_ugx
      FROM customer_arrears WHERE organization_id=$1::uuid`, [organizationId]),
    // Of the bills that fell due in the last 90 days, the share already paid.
    dbPool.query(`SELECT coalesce(sum(amount_ugx),0)::bigint billed_ugx,coalesce(sum(amount_ugx-balance_ugx),0)::bigint collected_ugx
      FROM customer_invoices WHERE organization_id=$1::uuid AND status<>'cancelled' AND due_on BETWEEN ${TODAY}-90 AND ${TODAY}`, [organizationId]),
    dbPool.query(`SELECT count(*) FILTER (WHERE state='open')::int open,count(*) FILTER (WHERE state='open' AND promised_on<=${TODAY}+7)::int due_this_week,
        count(*) FILTER (WHERE state='kept')::int kept,count(*) FILTER (WHERE state='broken')::int broken
      FROM (SELECT f.promised_on,${PROMISE} AS state FROM arrears_follow_ups f
        WHERE f.organization_id=$1::uuid AND f.outcome='promise_to_pay' AND f.created_at>now()-interval '90 days') x`, [organizationId]),
    dbPool.query(`SELECT count(*) FILTER (WHERE progress='on_track')::int on_track,count(*) FILTER (WHERE progress='behind')::int behind,
        count(*) FILTER (WHERE progress='completed')::int completed
      FROM (SELECT ${PLAN} FROM arrears_payment_plans p WHERE p.organization_id=$1::uuid AND p.status='active') x`, [organizationId]),
  ]);
  return { ...totals.rows[0], ...collection.rows[0], promises: promises.rows[0], plans: plans.rows[0] };
}

export async function listArrears(organizationId: string, input: { bucket: Bucket; search?: string; page: number; pageSize: number }) {
  const { rows } = await dbPool.query(`SELECT a.customer_id,u.full_name,u.phone,loc.label AS location,a.overdue_ugx,a.open_ugx,a.days_late,
      a.oldest_due_on::text AS oldest_due_on,a.overdue_bills,a.days_1_30_ugx,a.days_31_60_ugx,a.days_61_90_ugx,a.days_over_90_ugx,
      (SELECT max(coalesce(p.confirmed_at,p.created_at)) FROM customer_payments p WHERE p.customer_id=a.customer_id
        AND p.organization_id=a.organization_id AND p.status='successful') AS last_paid_at,
      last.outcome AS last_outcome,last.created_at AS last_follow_up_at,last.promised_on::text AS promised_on,last.promise_state,
      plan.progress AS plan_progress,count(*) OVER() AS total_rows
    FROM customer_arrears a
    JOIN customer_profiles cp ON cp.id=a.customer_id JOIN users u ON u.id=cp.user_id
    LEFT JOIN LATERAL(SELECT l.label FROM customer_service_locations l WHERE l.customer_id=a.customer_id ORDER BY l.is_primary DESC,l.created_at LIMIT 1) loc ON true
    LEFT JOIN LATERAL(SELECT f.outcome,f.created_at,f.promised_on,${PROMISE} AS promise_state FROM arrears_follow_ups f
      WHERE f.customer_id=a.customer_id AND f.organization_id=a.organization_id ORDER BY f.created_at DESC LIMIT 1) last ON true
    LEFT JOIN LATERAL(SELECT ${PLAN} FROM arrears_payment_plans p WHERE p.customer_id=a.customer_id AND p.organization_id=a.organization_id AND p.status='active') plan ON true
    WHERE a.organization_id=$1::uuid AND ${BUCKETS[input.bucket]}
      AND ($2::text IS NULL OR u.full_name ILIKE '%'||$2||'%' OR u.phone ILIKE '%'||$2||'%' OR loc.label ILIKE '%'||$2||'%')
    ORDER BY a.overdue_ugx DESC,a.days_late DESC LIMIT $3 OFFSET $4`,
  [organizationId, input.search || null, input.pageSize, (input.page - 1) * input.pageSize]);
  const total = rows.length ? Number(rows[0].total_rows) : 0;
  return { rows: rows.map(({ total_rows: _, ...row }) => row), page: input.page, pageSize: input.pageSize, total };
}

export async function customerArrears(organizationId: string, customerId: string) {
  const customer = (await dbPool.query(`SELECT cp.id,u.full_name,u.phone,cp.customer_type,cp.service_status,
      (SELECT l.label FROM customer_service_locations l WHERE l.customer_id=cp.id ORDER BY l.is_primary DESC,l.created_at LIMIT 1) AS location,
      a.overdue_ugx,a.open_ugx,a.days_late
    FROM customer_profiles cp JOIN users u ON u.id=cp.user_id LEFT JOIN customer_arrears a ON a.customer_id=cp.id AND a.organization_id=$1::uuid
    WHERE cp.id=$2::uuid AND EXISTS(SELECT 1 FROM customer_invoices i WHERE i.customer_id=cp.id AND i.organization_id=$1::uuid)`,
  [organizationId, customerId])).rows[0];
  if (!customer) throw fail(404, "This household has no bills with your company");
  const [bills, payments, followUps, plans] = await Promise.all([
    dbPool.query(`SELECT id,invoice_number,amount_ugx,balance_ugx,issued_on::text AS issued_on,due_on::text AS due_on,
        GREATEST(${TODAY}-due_on,0) AS days_late FROM customer_invoices
      WHERE organization_id=$1::uuid AND customer_id=$2::uuid AND balance_ugx>0 AND status IN('issued','partially_paid','overdue') ORDER BY due_on`, [organizationId, customerId]),
    dbPool.query(`SELECT amount_ugx,provider,coalesce(confirmed_at,created_at) AS paid_at FROM customer_payments
      WHERE organization_id=$1::uuid AND customer_id=$2::uuid AND status='successful' ORDER BY 3 DESC LIMIT 10`, [organizationId, customerId]),
    dbPool.query(`SELECT f.id,f.channel,f.outcome,f.note,f.promised_amount_ugx,f.promised_on::text AS promised_on,f.balance_at_follow_up_ugx,
        f.created_by_name,f.created_at,${PROMISE} AS promise_state
      FROM arrears_follow_ups f WHERE f.organization_id=$1::uuid AND f.customer_id=$2::uuid ORDER BY f.created_at DESC LIMIT 50`, [organizationId, customerId]),
    dbPool.query(`SELECT ${PLAN} FROM arrears_payment_plans p WHERE p.organization_id=$1::uuid AND p.customer_id=$2::uuid ORDER BY p.created_at DESC`, [organizationId, customerId]),
  ]);
  return { customer, bills: bills.rows, payments: payments.rows, followUps: followUps.rows, plans: plans.rows };
}

async function openBalance(organizationId: string, customerId: string) {
  return Number((await dbPool.query("SELECT coalesce(open_ugx,0) AS open FROM customer_arrears WHERE organization_id=$1::uuid AND customer_id=$2::uuid",
    [organizationId, customerId])).rows[0]?.open ?? 0);
}

export async function addFollowUp(organizationId: string, customerId: string, input: {
  channel: string; outcome: string; note?: string; promisedAmountUgx?: number; promisedOn?: string;
}, userId: string) {
  const balance = await openBalance(organizationId, customerId);
  if (balance <= 0) throw fail(400, "This household owes nothing to your company");
  if (input.promisedAmountUgx && input.promisedAmountUgx > balance) throw fail(400, "The promise is larger than what the household owes");
  return (await dbPool.query(`INSERT INTO arrears_follow_ups(organization_id,customer_id,channel,outcome,note,promised_amount_ugx,promised_on,
      balance_at_follow_up_ugx,created_by,created_by_name)
    VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7::date,$8,$9::uuid,(SELECT full_name FROM users WHERE id=$9::uuid)) RETURNING id,outcome,created_at`,
  [organizationId, customerId, input.channel, input.outcome, input.note || null, input.promisedAmountUgx ?? null, input.promisedOn ?? null, balance, userId])).rows[0];
}

export async function createPlan(organizationId: string, customerId: string, input: {
  totalUgx: number; instalments: number; frequency: string; firstDueOn: string; note?: string;
}, userId: string) {
  const balance = await openBalance(organizationId, customerId);
  if (balance <= 0) throw fail(400, "This household owes nothing to your company");
  if (input.totalUgx > balance) throw fail(400, `The plan cannot be more than the open balance (UGX ${balance.toLocaleString("en-GB")})`);
  try {
    return (await dbPool.query(`INSERT INTO arrears_payment_plans(organization_id,customer_id,total_ugx,instalments,frequency,first_due_on,note,created_by,created_by_name)
      VALUES($1::uuid,$2::uuid,$3,$4,$5,$6::date,$7,$8::uuid,(SELECT full_name FROM users WHERE id=$8::uuid)) RETURNING id,total_ugx,instalments`,
    [organizationId, customerId, input.totalUgx, input.instalments, input.frequency, input.firstDueOn, input.note || null, userId])).rows[0];
  } catch (error) {
    if ((error as { constraint?: string }).constraint === "one_active_plan_per_household") throw fail(409, "This household already has an active plan. Cancel it before agreeing a new one.");
    throw error;
  }
}

export async function cancelPlan(organizationId: string, planId: string, reason: string, userId: string) {
  const row = (await dbPool.query(`UPDATE arrears_payment_plans SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP,cancel_reason=$3,cancelled_by=$4::uuid,
      cancelled_by_name=(SELECT full_name FROM users WHERE id=$4::uuid)
    WHERE id=$1::uuid AND organization_id=$2::uuid AND status='active' RETURNING id`, [planId, organizationId, reason, userId])).rows[0];
  if (!row) throw fail(404, "No active plan with this id");
  return row;
}

/** Every household in arrears, for a spreadsheet. */
export async function arrearsRows(organizationId: string) {
  return (await listArrears(organizationId, { bucket: "all", page: 1, pageSize: 100000 })).rows;
}

/**
 * The overdue reminder: once when a bill is 1, 14 and 30 days late (the latest step reached, so a missed day is not
 * repeated), between 08:00 and 19:00 Kampala time. Households keeping to a payment plan are not reminded.
 */
export async function runOverdueReminders(anyHour = false) {
  const hour = (await dbPool.query("SELECT EXTRACT(HOUR FROM now() AT TIME ZONE 'Africa/Kampala')::int AS hour")).rows[0].hour;
  if (!anyHour && (hour < 8 || hour >= 19)) return 0;
  const { rows } = await dbPool.query(`SELECT notify_household(i.customer_id,i.organization_id,'bill_overdue','Bill overdue',
      household_company_name(i.organization_id)||': '||household_money(i.balance_ugx)||' was due on '||to_char(i.due_on,'FMDD Mon')
        ||'. Please pay by mobile money on your household page, or call us to agree a plan.',
      'household-overdue:'||i.id||':'||CASE WHEN ${TODAY}-i.due_on>=30 THEN 30 WHEN ${TODAY}-i.due_on>=14 THEN 14 ELSE 1 END) AS id
    FROM customer_invoices i
    WHERE i.balance_ugx>0 AND i.status IN('issued','partially_paid','overdue') AND ${TODAY}-i.due_on BETWEEN 1 AND 60
      AND NOT EXISTS(SELECT 1 FROM arrears_payment_plans p WHERE p.customer_id=i.customer_id AND p.organization_id=i.organization_id
        AND p.status='active' AND ${paidSince("p.customer_id", "p.organization_id", "p.created_at")}>=arrears_plan_due_by(p,${TODAY}))`);
  return rows.filter((row: { id: string | null }) => row.id).length;
}
