import type { PoolClient } from "pg";
import { dbPool } from "../config/database";
import { Page, queryPage } from "../utils/pagination";
import { BILLING_RULES, Cycle, Plan, SubscriptionStatus, dueOn, monthlyValue, overdueEffect, periodEnd, planChange, priceFor, proration } from "../services/subscription.rules";
import { notifyOrganization } from "../services/notify";

const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const ugx = (n: number | string) => `UGX ${Number(n).toLocaleString("en-GB")}`;
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

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
async function event(c: PoolClient, organizationId: string, action: string, note: string | null, actor: string | null) {
  await c.query("INSERT INTO subscription_events(organization_id,action,note,actor_user_id) VALUES($1,$2,$3,$4)", [organizationId, action, note, actor]);
}
const tell = (c: PoolClient, organizationId: string, severity: "info" | "warning" | "critical", title: string, body: string, key: string) =>
  notifyOrganization(c, organizationId, ["company_admin"], { category: "billing", severity, title, body, link: "/dashboard/subscription", dedupeKey: key });

const PLAN_COLUMNS = `p.id,p.code,p.name,p.description,p.organization_type,p.monthly_fee_ugx::float AS monthly_fee_ugx,p.annual_fee_ugx::float AS annual_fee_ugx,
  p.max_vehicles,p.max_users,p.trial_days,p.is_public,p.is_active,p.feature_codes`;

// ---------- Plans ----------

export async function plans(filter: { publicOnly: boolean; organizationType?: string | null }) {
  return (await dbPool.query(
    `SELECT ${PLAN_COLUMNS} FROM platform_packages p WHERE p.is_active AND ($1::boolean=false OR p.is_public) AND ($2::text IS NULL OR p.organization_type=$2)
     ORDER BY p.organization_type,p.monthly_fee_ugx,p.name`, [filter.publicOnly, filter.organizationType ?? null])).rows;
}

export async function updatePlan(code: string, input: { monthlyFeeUgx: number; annualFeeUgx: number; maxVehicles: number | null; maxUsers: number | null; trialDays: number; isPublic: boolean }) {
  const row = (await dbPool.query(
    `UPDATE platform_packages p SET monthly_fee_ugx=$2,annual_fee_ugx=$3,max_vehicles=$4,max_users=$5,trial_days=$6,is_public=$7 WHERE code=$1 RETURNING ${PLAN_COLUMNS}`,
    [code, input.monthlyFeeUgx, input.annualFeeUgx, input.maxVehicles, input.maxUsers, input.trialDays, input.isPublic])).rows[0];
  if (!row) throw fail(404, "Plan not found");
  return row;
}

// ---------- Reading a subscription ----------

/** Vehicles and active staff counted against the plan. Households (citizen accounts) are customers, not staff (107). */
async function usage(c: PoolClient | typeof dbPool, organizationId: string) {
  const row = (await c.query(
    `SELECT (SELECT COUNT(*)::int FROM waste_trucks WHERE organization_id=$1) AS vehicles,
       (SELECT COUNT(*)::int FROM users u WHERE u.organization_id=$1 AND u.status='active' AND NOT is_household_account(u.id)) AS users`, [organizationId])).rows[0];
  return { vehicles: row.vehicles as number, users: row.users as number };
}

async function loadSubscription(c: PoolClient | typeof dbPool, organizationId: string, lock = false) {
  return (await c.query(
    `SELECT s.*,s.current_period_start::text AS period_start,s.current_period_end::text AS period_end,o.name AS organization_name,o.type AS organization_type,
       p.code AS plan_code,p.name AS plan_name,p.monthly_fee_ugx::float AS monthly_fee_ugx,p.annual_fee_ugx::float AS annual_fee_ugx,p.max_vehicles,p.max_users,
       pp.code AS pending_plan_code,pp.name AS pending_plan_name
     FROM organization_subscriptions s JOIN organizations o ON o.id=s.organization_id JOIN platform_packages p ON p.id=s.package_id
     LEFT JOIN platform_packages pp ON pp.id=s.pending_package_id WHERE s.organization_id=$1::uuid${lock ? " FOR UPDATE OF s" : ""}`, [organizationId])).rows[0];
}

const INVOICE_COLUMNS = `i.id,i.invoice_number,i.organization_id,o.name AS organization_name,p.name AS plan_name,i.kind,i.billing_cycle,i.period_start::text AS period_start,
  i.period_end::text AS period_end,i.amount_ugx::float AS amount_ugx,i.status,i.issued_at,i.due_on::text AS due_on,i.payment_reference,i.paid_on::text AS paid_on,
  i.payment_submitted_at,i.confirmed_at,i.void_reason,(i.status IN('open','payment_submitted') AND i.due_on<CURRENT_DATE) AS overdue`;
const INVOICE_FROM = "FROM subscription_invoices i JOIN organizations o ON o.id=i.organization_id JOIN platform_packages p ON p.id=i.package_id";

export async function companySubscription(organizationId: string) {
  const subscription = await loadSubscription(dbPool, organizationId);
  if (!subscription) return { subscription: null, usage: await usage(dbPool, organizationId), invoices: [], plans: [] };
  const [use, invoices, available] = await Promise.all([
    usage(dbPool, organizationId),
    dbPool.query(`SELECT ${INVOICE_COLUMNS} ${INVOICE_FROM} WHERE i.organization_id=$1 ORDER BY i.issued_at DESC LIMIT 12`, [organizationId]),
    plans({ publicOnly: true, organizationType: subscription.organization_type }),
  ]);
  const trialDaysLeft = subscription.status === "trialing" ? Math.max(0, Math.ceil((new Date(subscription.trial_ends_at).getTime() - Date.now()) / 86400000)) : null;
  return { subscription: { ...subscription, trial_days_left: trialDaysLeft, price_ugx: priceFor(subscription, subscription.billing_cycle) }, usage: use, invoices: invoices.rows, plans: available, rules: BILLING_RULES };
}

export async function companyInvoices(organizationId: string, page?: Page) {
  return queryPage(`SELECT ${INVOICE_COLUMNS} ${INVOICE_FROM} WHERE i.organization_id=$1 ORDER BY i.issued_at DESC,i.id`, [organizationId], page);
}

/** For the access guard: the company's subscription status, or null when it has none (not managed by subscriptions). */
export async function statusOf(organizationId: string): Promise<SubscriptionStatus | null> {
  return (await dbPool.query("SELECT status FROM organization_subscriptions WHERE organization_id=$1::uuid", [organizationId])).rows[0]?.status ?? null;
}

// ---------- Company actions ----------

async function issueInvoice(c: PoolClient, s: { organization_id: string; package_id: string }, input: { kind: "period" | "proration"; cycle: Cycle; start: string; end: string; amount: number; today: string }) {
  const invoice = (await c.query(
    `INSERT INTO subscription_invoices(organization_id,package_id,kind,billing_cycle,period_start,period_end,amount_ugx,due_on) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT DO NOTHING RETURNING id,invoice_number,amount_ugx::float AS amount_ugx,due_on::text AS due_on`,
    [s.organization_id, s.package_id, input.kind, input.cycle, input.start, input.end, input.amount, dueOn(input.today)])).rows[0];
  if (invoice) {
    await tell(c, s.organization_id, "info", `Invoice ${invoice.invoice_number}: ${ugx(invoice.amount_ugx)}`,
      `${input.kind === "proration" ? "Plan upgrade for the rest of the current period" : `Subscription from ${dayLabel(input.start)} to ${dayLabel(input.end)}`}. Pay by ${dayLabel(invoice.due_on)}.`,
      `subscription-invoice:${invoice.id}`);
  }
  return invoice ?? null;
}

export async function changePlan(organizationId: string, userId: string, input: { planCode: string; billingCycle?: Cycle }) {
  return inTransaction(async c => {
    const s = await loadSubscription(c, organizationId, true);
    if (!s) throw fail(404, "Your company has no subscription yet; contact the platform team");
    if (s.status === "suspended" || s.status === "cancelled") throw fail(409, s.status === "suspended" ? "Pay the overdue invoice before changing plans" : "Resume the subscription before changing plans");
    const next = (await c.query(`SELECT ${PLAN_COLUMNS} FROM platform_packages p WHERE p.code=$1 AND p.is_active AND p.is_public AND p.organization_type=$2`, [input.planCode, s.organization_type])).rows[0];
    if (!next) throw fail(400, "Choose a plan available to your type of company");
    const cycle: Cycle = input.billingCycle ?? s.billing_cycle;
    if (next.id === s.package_id) {
      if (cycle === s.billing_cycle) throw fail(409, "You are already on this plan");
      await c.query("UPDATE organization_subscriptions SET pending_billing_cycle=$2,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1", [organizationId, cycle]);
      await event(c, organizationId, "cycle_scheduled", `${cycle} billing from ${s.period_end}`, userId);
      return { timing: "period_end", effective_on: s.period_end, plan: next.name, billing_cycle: cycle };
    }
    const change = planChange(s, next, await usage(c, organizationId));
    if (change.blocked) throw fail(409, change.blocked);
    if (change.timing === "period_end" && s.status !== "trialing" && s.status !== "complimentary") {
      await c.query("UPDATE organization_subscriptions SET pending_package_id=$2,pending_billing_cycle=$3,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1", [organizationId, next.id, cycle === s.billing_cycle ? null : cycle]);
      await event(c, organizationId, "downgrade_scheduled", `${s.plan_name} → ${next.name} from ${s.period_end}`, userId);
      return { timing: "period_end", effective_on: s.period_end, plan: next.name, billing_cycle: cycle };
    }
    const today = await todayOf(c);
    await c.query("UPDATE organization_subscriptions SET package_id=$2,pending_package_id=NULL,pending_billing_cycle=$3,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1",
      [organizationId, next.id, cycle === s.billing_cycle ? null : cycle]);
    await c.query("UPDATE organizations SET platform_package_id=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1", [organizationId, next.id]);
    await event(c, organizationId, "plan_changed", `${s.plan_name} → ${next.name}`, userId);
    let invoice = null;
    if (s.status === "active" || s.status === "past_due") {
      const amount = proration(priceFor(s, s.billing_cycle), priceFor(next, s.billing_cycle), s.period_start, s.period_end, today);
      if (amount > 0) invoice = await issueInvoice(c, { organization_id: organizationId, package_id: next.id }, { kind: "proration", cycle: s.billing_cycle, start: today, end: s.period_end, amount, today });
    }
    return { timing: "now", plan: next.name, billing_cycle: s.billing_cycle, invoice };
  });
}

export async function setCancellation(organizationId: string, userId: string, cancel: boolean) {
  return inTransaction(async c => {
    const s = await loadSubscription(c, organizationId, true);
    if (!s) throw fail(404, "Your company has no subscription");
    if (!["trialing", "active", "past_due"].includes(s.status)) throw fail(409, "Only a running subscription can be cancelled or resumed");
    if (s.cancel_at_period_end === cancel) throw fail(409, cancel ? "The subscription is already set to end" : "The subscription is not set to end");
    await c.query("UPDATE organization_subscriptions SET cancel_at_period_end=$2,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1", [organizationId, cancel]);
    await event(c, organizationId, cancel ? "cancellation_scheduled" : "cancellation_withdrawn", cancel ? `Ends ${s.period_end}` : null, userId);
    return { cancel_at_period_end: cancel, ends_on: s.period_end };
  });
}

export async function submitPayment(organizationId: string, userId: string, invoiceId: string, input: { reference: string; paidOn: string }) {
  return inTransaction(async c => {
    const invoice = (await c.query("SELECT id,invoice_number,status FROM subscription_invoices WHERE id=$1::uuid AND organization_id=$2 FOR UPDATE", [invoiceId, organizationId])).rows[0];
    if (!invoice) throw fail(404, "Invoice not found");
    if (invoice.status !== "open") throw fail(409, "This invoice is not awaiting payment");
    if (input.paidOn > await todayOf(c)) throw fail(400, "The payment date cannot be in the future");
    await c.query("UPDATE subscription_invoices SET status='payment_submitted',payment_reference=$2,paid_on=$3,payment_submitted_by=$4,payment_submitted_at=CURRENT_TIMESTAMP WHERE id=$1",
      [invoiceId, input.reference.trim(), input.paidOn, userId]);
    await event(c, organizationId, "payment_submitted", `${invoice.invoice_number}: ${input.reference.trim()}`, userId);
    return { id: invoiceId, status: "payment_submitted" };
  });
}

// ---------- Platform administration ----------

export async function overview() {
  const [subs, invoices, trials] = await Promise.all([
    dbPool.query(
      `SELECT s.status,s.billing_cycle,p.monthly_fee_ugx::float AS monthly_fee_ugx,p.annual_fee_ugx::float AS annual_fee_ugx FROM organization_subscriptions s JOIN platform_packages p ON p.id=s.package_id`),
    dbPool.query(
      `SELECT COUNT(*) FILTER(WHERE status='payment_submitted')::int AS to_confirm,
         COALESCE(SUM(amount_ugx) FILTER(WHERE status IN('open','payment_submitted')),0)::float AS outstanding_ugx,
         COALESCE(SUM(amount_ugx) FILTER(WHERE status IN('open','payment_submitted') AND due_on<CURRENT_DATE),0)::float AS overdue_ugx,
         COALESCE(SUM(amount_ugx) FILTER(WHERE status='paid' AND confirmed_at>date_trunc('month',CURRENT_TIMESTAMP)),0)::float AS collected_this_month_ugx
       FROM subscription_invoices`),
    dbPool.query("SELECT COUNT(*)::int AS n FROM organization_subscriptions WHERE status='trialing' AND trial_ends_at<CURRENT_TIMESTAMP+interval '7 days'"),
  ]);
  const counts: Record<string, number> = {};
  let mrr = 0;
  for (const s of subs.rows) {
    counts[s.status] = (counts[s.status] ?? 0) + 1;
    if (s.status === "active" || s.status === "past_due") mrr += monthlyValue(s as Plan, s.billing_cycle);
  }
  return { counts, mrr_ugx: mrr, trials_ending_7d: trials.rows[0].n, invoices: invoices.rows[0], rules: BILLING_RULES };
}

export async function listSubscriptions(filter: { status: string | null; q: string | null }, page?: Page) {
  return queryPage(
    `SELECT s.organization_id,o.name AS organization_name,o.type AS organization_type,p.name AS plan_name,s.billing_cycle,s.status,s.trial_ends_at,
       s.current_period_end::text AS period_end,s.cancel_at_period_end,
       (SELECT COALESCE(SUM(amount_ugx),0)::float FROM subscription_invoices i WHERE i.organization_id=s.organization_id AND i.status IN('open','payment_submitted')) AS outstanding_ugx
     FROM organization_subscriptions s JOIN organizations o ON o.id=s.organization_id JOIN platform_packages p ON p.id=s.package_id
     WHERE ($1::text IS NULL OR s.status=$1) AND ($2::text IS NULL OR o.name ILIKE '%'||$2||'%')
     ORDER BY CASE s.status WHEN 'suspended' THEN 0 WHEN 'past_due' THEN 1 WHEN 'trialing' THEN 2 ELSE 3 END,o.name`,
    [filter.status, filter.q], page);
}

export async function subscriptionDetail(organizationId: string) {
  const data = await companySubscription(organizationId);
  if (!data.subscription) throw fail(404, "This company has no subscription");
  const events = (await dbPool.query(
    `SELECT e.action,e.note,e.created_at,u.full_name AS actor_name FROM subscription_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE e.organization_id=$1 ORDER BY e.created_at DESC,e.id LIMIT 50`,
    [organizationId])).rows;
  return { ...data, events };
}

export async function unsubscribedCompanies() {
  return (await dbPool.query(
    `SELECT o.id,o.name,o.type,p.code AS plan_code FROM organizations o LEFT JOIN platform_packages p ON p.id=o.platform_package_id
     WHERE o.is_active AND o.type IN('waste_collection_company','recycling_company','processing_plant')
       AND NOT EXISTS(SELECT 1 FROM organization_subscriptions s WHERE s.organization_id=o.id) ORDER BY o.name LIMIT 200`)).rows;
}

export async function startSubscription(organizationId: string, userId: string, input: { planCode: string; mode: "trial" | "complimentary" }) {
  return inTransaction(async c => {
    const org = (await c.query("SELECT id,type FROM organizations WHERE id=$1::uuid AND is_active AND type IN('waste_collection_company','recycling_company','processing_plant')", [organizationId])).rows[0];
    if (!org) throw fail(400, "Choose an active company");
    if (await loadSubscription(c, organizationId)) throw fail(409, "This company already has a subscription");
    const plan = (await c.query("SELECT id,name FROM platform_packages WHERE code=$1 AND is_active AND organization_type=$2", [input.planCode, org.type])).rows[0];
    if (!plan) throw fail(400, "Choose a plan for this type of company");
    await c.query("UPDATE organizations SET platform_package_id=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1", [organizationId, plan.id]);
    if (input.mode === "complimentary") {
      await c.query(`INSERT INTO organization_subscriptions(organization_id,package_id,status,current_period_start,current_period_end,status_reason)
        VALUES($1,$2,'complimentary',CURRENT_DATE,(CURRENT_DATE+interval '1 month')::date,'Started complimentary by the platform')`, [organizationId, plan.id]);
      await event(c, organizationId, "started", "complimentary", userId);
      return { status: "complimentary" };
    }
    const status = (await c.query("SELECT start_subscription_trial($1,$2) AS s", [organizationId, plan.id])).rows[0].s;
    return { status };
  });
}

export type AdminAction = { action: "extend_trial" | "suspend" | "reactivate" | "make_complimentary" | "start_billing"; days?: number; reason?: string };

export async function adminAction(organizationId: string, userId: string, input: AdminAction) {
  return inTransaction(async c => {
    const s = await loadSubscription(c, organizationId, true);
    if (!s) throw fail(404, "This company has no subscription");
    const reason = input.reason?.trim() || null;
    const today = await todayOf(c);
    switch (input.action) {
      case "extend_trial": {
        if (s.status !== "trialing") throw fail(409, "Only a trial can be extended");
        const days = Math.round(Number(input.days));
        if (!(days >= 1 && days <= 60)) throw fail(400, "Extend by 1 to 60 days");
        await c.query(`UPDATE organization_subscriptions SET trial_ends_at=trial_ends_at+make_interval(days=>$2),current_period_end=current_period_end+$2,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1`, [organizationId, days]);
        await event(c, organizationId, "trial_extended", `${days} days. ${reason ?? ""}`.trim(), userId);
        await tell(c, organizationId, "info", "Trial extended", `Your trial was extended by ${days} days.`, `subscription-trial-extended:${organizationId}:${Date.now()}`);
        break;
      }
      case "suspend": {
        if (!reason || reason.length < 5) throw fail(400, "Give the reason");
        if (s.status === "suspended" || s.status === "cancelled") throw fail(409, "The subscription is not running");
        await c.query("UPDATE organization_subscriptions SET status='suspended',status_reason=$2,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1", [organizationId, reason]);
        await event(c, organizationId, "suspended", reason, userId);
        await tell(c, organizationId, "critical", "Subscription suspended", `The platform suspended your subscription: ${reason}. Your data stays available to read, and KCCA obligations can still be met.`, `subscription-suspended:${organizationId}:${Date.now()}`);
        break;
      }
      case "reactivate": {
        if (s.status !== "suspended" && s.status !== "cancelled") throw fail(409, "The subscription is already running");
        const newEnd = periodEnd(today, s.billing_cycle);
        await c.query(`UPDATE organization_subscriptions SET status='active',status_reason=$2,cancel_at_period_end=false,
            current_period_start=CASE WHEN status='cancelled' THEN CURRENT_DATE ELSE current_period_start END,
            current_period_end=CASE WHEN status='cancelled' THEN $3::date ELSE current_period_end END,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1`, [organizationId, reason, newEnd]);
        await event(c, organizationId, "reactivated", reason, userId);
        await tell(c, organizationId, "info", "Subscription active again", "Your subscription is active again.", `subscription-reactivated:${organizationId}:${Date.now()}`);
        break;
      }
      case "make_complimentary": {
        if (!reason || reason.length < 5) throw fail(400, "Give the reason");
        await c.query("UPDATE organization_subscriptions SET status='complimentary',status_reason=$2,cancel_at_period_end=false,pending_package_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1", [organizationId, reason]);
        await event(c, organizationId, "made_complimentary", reason, userId);
        break;
      }
      case "start_billing": {
        if (s.status !== "complimentary") throw fail(409, "Only a complimentary subscription can start billing");
        const price = priceFor(s, s.billing_cycle), end = periodEnd(today, s.billing_cycle);
        await c.query("UPDATE organization_subscriptions SET status='active',status_reason=NULL,current_period_start=CURRENT_DATE,current_period_end=$2,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1", [organizationId, end]);
        await event(c, organizationId, "billing_started", reason, userId);
        if (price > 0) await issueInvoice(c, s, { kind: "period", cycle: s.billing_cycle, start: today, end, amount: price, today });
        break;
      }
      default: throw fail(400, "Unknown action");
    }
    return (await loadSubscription(c, organizationId))!;
  });
}

export async function listInvoices(filter: { status: string | null; organizationId: string | null }, page?: Page) {
  return queryPage(
    `SELECT ${INVOICE_COLUMNS} ${INVOICE_FROM}
     WHERE ($1::text IS NULL OR ($1='overdue' AND i.status IN('open','payment_submitted') AND i.due_on<CURRENT_DATE) OR i.status=$1) AND ($2::uuid IS NULL OR i.organization_id=$2::uuid)
     ORDER BY CASE i.status WHEN 'payment_submitted' THEN 0 WHEN 'open' THEN 1 ELSE 2 END,i.due_on,i.issued_at DESC,i.id`, [filter.status, filter.organizationId], page);
}

/** After a payment, a past-due or payment-suspended subscription runs again once nothing overdue remains. */
async function restoreIfSettled(c: PoolClient, organizationId: string, actor: string) {
  const s = await loadSubscription(c, organizationId, true);
  if (!s || (s.status !== "past_due" && s.status !== "suspended")) return;
  if (s.status === "suspended" && s.status_reason && !s.status_reason.startsWith("Unpaid invoice")) return;
  const overdue = (await c.query("SELECT 1 FROM subscription_invoices WHERE organization_id=$1 AND status IN('open','payment_submitted') AND due_on<CURRENT_DATE LIMIT 1", [organizationId])).rowCount;
  if (overdue) return;
  await c.query("UPDATE organization_subscriptions SET status='active',status_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1", [organizationId]);
  await event(c, organizationId, "restored", "All overdue invoices paid", actor);
  await tell(c, organizationId, "info", "Subscription active again", "Thank you. All overdue invoices are paid and your subscription is active.", `subscription-restored:${organizationId}:${Date.now()}`);
}

export async function confirmInvoice(id: string, userId: string, input: { reference?: string; paidOn?: string }) {
  return inTransaction(async c => {
    const invoice = (await c.query("SELECT id,organization_id,invoice_number,status,amount_ugx FROM subscription_invoices WHERE id=$1::uuid FOR UPDATE", [id])).rows[0];
    if (!invoice) throw fail(404, "Invoice not found");
    if (invoice.status === "open") {
      if (!input.reference || !input.paidOn) throw fail(400, "Enter the payment reference and date");
      await c.query("UPDATE subscription_invoices SET status='paid',payment_reference=$2,paid_on=$3,confirmed_by=$4,confirmed_at=CURRENT_TIMESTAMP WHERE id=$1", [id, input.reference.trim(), input.paidOn, userId]);
    } else if (invoice.status === "payment_submitted") {
      await c.query("UPDATE subscription_invoices SET status='paid',confirmed_by=$2,confirmed_at=CURRENT_TIMESTAMP WHERE id=$1", [id, userId]);
    } else throw fail(409, "This invoice is not awaiting payment");
    await event(c, invoice.organization_id, "invoice_paid", invoice.invoice_number, userId);
    await tell(c, invoice.organization_id, "info", `Payment received: ${invoice.invoice_number}`, `We have received ${ugx(invoice.amount_ugx)}. Thank you.`, `subscription-paid:${id}`);
    await restoreIfSettled(c, invoice.organization_id, userId);
    return { id, status: "paid" };
  });
}

export async function rejectPayment(id: string, userId: string, reason: string) {
  return inTransaction(async c => {
    const invoice = (await c.query("SELECT id,organization_id,invoice_number,status FROM subscription_invoices WHERE id=$1::uuid FOR UPDATE", [id])).rows[0];
    if (!invoice || invoice.status !== "payment_submitted") throw fail(409, "There is no submitted payment to reject");
    await c.query("UPDATE subscription_invoices SET status='open',payment_reference=NULL,paid_on=NULL,payment_submitted_by=NULL,payment_submitted_at=NULL WHERE id=$1", [id]);
    await event(c, invoice.organization_id, "payment_rejected", `${invoice.invoice_number}: ${reason}`, userId);
    await tell(c, invoice.organization_id, "warning", `Payment not found: ${invoice.invoice_number}`, `${reason}. The invoice is still open.`, `subscription-payment-rejected:${id}:${Date.now()}`);
    return { id, status: "open" };
  });
}

export async function voidInvoice(id: string, userId: string, reason: string) {
  return inTransaction(async c => {
    const invoice = (await c.query("SELECT id,organization_id,invoice_number,status FROM subscription_invoices WHERE id=$1::uuid FOR UPDATE", [id])).rows[0];
    if (!invoice || invoice.status !== "open") throw fail(409, "Only an open invoice can be voided");
    await c.query("UPDATE subscription_invoices SET status='void',void_reason=$2 WHERE id=$1", [id, reason]);
    await event(c, invoice.organization_id, "invoice_voided", `${invoice.invoice_number}: ${reason}`, userId);
    await restoreIfSettled(c, invoice.organization_id, userId);
    return { id, status: "void" };
  });
}

// ---------- Billing cycle (scheduled) ----------

/**
 * Moves subscriptions through time: ends trials and periods (issuing the next invoice, applying scheduled plan or cycle
 * changes, ending cancelled subscriptions) and turns unpaid invoices into past due, then suspended.
 */
export async function runBillingCycle() {
  const today = await todayOf(dbPool);
  const outcome = { renewed: 0, cancelled: 0, past_due: 0, suspended: 0, trial_reminders: 0 };
  const due = (await dbPool.query(
    `SELECT organization_id FROM organization_subscriptions WHERE (status='trialing' AND trial_ends_at<=CURRENT_TIMESTAMP)
       OR (status IN('active','past_due') AND current_period_end<=CURRENT_DATE)`)).rows;
  for (const row of due) {
    await inTransaction(async c => {
      const s = await loadSubscription(c, row.organization_id, true);
      if (!s) return;
      if (s.cancel_at_period_end) {
        await c.query("UPDATE organization_subscriptions SET status='cancelled',status_reason='Cancelled by the company',updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1", [s.organization_id]);
        await event(c, s.organization_id, "cancelled", `Ended ${s.period_end}`, null);
        await tell(c, s.organization_id, "warning", "Subscription ended", "Your subscription has ended. Your records stay available to read, and KCCA obligations can still be met. Resume it at any time.", `subscription-ended:${s.organization_id}:${s.period_end}`);
        outcome.cancelled++;
        return;
      }
      const packageId = s.pending_package_id ?? s.package_id, cycle: Cycle = s.pending_billing_cycle ?? s.billing_cycle;
      const plan = (await c.query(`SELECT ${PLAN_COLUMNS} FROM platform_packages p WHERE p.id=$1`, [packageId])).rows[0];
      const start = s.status === "trialing" ? today : s.period_end, end = periodEnd(start, cycle);
      await c.query(`UPDATE organization_subscriptions SET package_id=$2,billing_cycle=$3,pending_package_id=NULL,pending_billing_cycle=NULL,
          status=CASE WHEN status='trialing' THEN 'active' ELSE status END,current_period_start=$4,current_period_end=$5,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1`,
        [s.organization_id, packageId, cycle, start, end]);
      if (packageId !== s.package_id) await c.query("UPDATE organizations SET platform_package_id=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1", [s.organization_id, packageId]);
      await event(c, s.organization_id, s.status === "trialing" ? "trial_ended" : "renewed", `${plan.name}, ${cycle}, ${start} to ${end}`, null);
      const price = priceFor(plan, cycle);
      if (price > 0) await issueInvoice(c, { organization_id: s.organization_id, package_id: packageId }, { kind: "period", cycle, start, end, amount: price, today });
      outcome.renewed++;
    });
  }
  const unpaid = (await dbPool.query(
    `SELECT DISTINCT ON (i.organization_id) i.organization_id,i.invoice_number,i.due_on::text AS due_on,i.amount_ugx::float AS amount_ugx,s.status
     FROM subscription_invoices i JOIN organization_subscriptions s ON s.organization_id=i.organization_id
     WHERE i.status='open' AND i.due_on<CURRENT_DATE AND s.status IN('active','past_due') ORDER BY i.organization_id,i.due_on`)).rows;
  for (const invoice of unpaid) {
    const effect = overdueEffect(invoice.due_on, today);
    if (effect === "none" || (effect === "past_due" && invoice.status === "past_due")) continue;
    await inTransaction(async c => {
      if (effect === "suspend") {
        await c.query("UPDATE organization_subscriptions SET status='suspended',status_reason=$2,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1",
          [invoice.organization_id, `Unpaid invoice ${invoice.invoice_number}`]);
        await event(c, invoice.organization_id, "suspended", `Unpaid invoice ${invoice.invoice_number}`, null);
        await tell(c, invoice.organization_id, "critical", "Subscription suspended for non-payment",
          `Invoice ${invoice.invoice_number} (${ugx(invoice.amount_ugx)}) was due on ${dayLabel(invoice.due_on)}. The platform is read-only until it is paid; KCCA obligations can still be met.`,
          `subscription-suspended:${invoice.organization_id}:${invoice.invoice_number}`);
        outcome.suspended++;
      } else {
        await c.query("UPDATE organization_subscriptions SET status='past_due',updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1", [invoice.organization_id]);
        await event(c, invoice.organization_id, "past_due", invoice.invoice_number, null);
        await tell(c, invoice.organization_id, "warning", `Invoice overdue: ${invoice.invoice_number}`,
          `${ugx(invoice.amount_ugx)} was due on ${dayLabel(invoice.due_on)}. The subscription is suspended ${BILLING_RULES.suspendAfterDays} days after the due date.`,
          `subscription-overdue:${invoice.organization_id}:${invoice.invoice_number}`);
        outcome.past_due++;
      }
    });
  }
  // Trial-ending reminders a week, three days and a day before the end, each sent once per trial (the notification
  // key carries the end date, so an extended trial is reminded again before its new end).
  const ending = (await dbPool.query(
    `SELECT s.organization_id, s.billing_cycle, p.name AS plan_name, p.monthly_fee_ugx::float AS monthly, p.annual_fee_ugx::float AS annual,
            (s.trial_ends_at AT TIME ZONE 'Africa/Kampala')::date::text AS ends_on,
            CEIL(EXTRACT(EPOCH FROM (s.trial_ends_at - CURRENT_TIMESTAMP)) / 86400)::int AS days_left
       FROM organization_subscriptions s JOIN platform_packages p ON p.id = s.package_id
      WHERE s.status = 'trialing' AND s.trial_ends_at > CURRENT_TIMESTAMP AND s.trial_ends_at <= CURRENT_TIMESTAMP + interval '7 days'`)).rows;
  for (const trial of ending) {
    const price = trial.billing_cycle === "annual" ? trial.annual : trial.monthly;
    if (!(price > 0)) continue;
    const step = trial.days_left <= 1 ? 1 : trial.days_left <= 3 ? 3 : 7;
    const amount = `${ugx(price)} ${trial.billing_cycle === "annual" ? "a year" : "a month"}`;
    await inTransaction(c => tell(c, trial.organization_id, step === 1 ? "warning" : "info",
      trial.days_left <= 1 ? "Your free trial ends tomorrow" : `Your free trial ends in ${trial.days_left} days`,
      `Your ${trial.plan_name} trial ends on ${dayLabel(trial.ends_on)}. Your first invoice of ${amount} follows; pay it from the Subscription page to keep full access. You can change plan before then.`,
      `subscription-trial-ending:${trial.organization_id}:${trial.ends_on}:${step}`));
    outcome.trial_reminders++;
  }
  return outcome;
}

export type { SubscriptionStatus };
