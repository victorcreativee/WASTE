import type { PoolClient } from "pg";
import { dbPool } from "../config/database";
import { Page, queryPage } from "../utils/pagination";
import { Channel, formatMessage, isSkip, retryDelayMinutes, send } from "../services/notification-delivery";
import { notifyOrganization } from "../services/notify";
import { dueOn, requiredPeriods } from "../services/regulatory-returns.rules";
import { CUSTODY_RULES } from "../services/factory.rules";
import { notifyDisposalGaps } from "./disposal.repository";
import { notifyOverdueCleanups } from "./dumping.repository";
import { notifyPenaltyDeadlines } from "./penalty.repository";

export const CATEGORIES = ["permit", "renewal", "returns", "compliance", "custody", "disposal", "dumping", "penalties", "billing", "system"] as const;

// ---------- In-app ----------

export async function listForUser(userId: string, page: Page | undefined, unreadOnly: boolean) {
  return queryPage(
    `SELECT id,category,severity,title,body,link,read_at,created_at FROM notifications
     WHERE recipient_user_id=$1::uuid AND ($2::boolean=false OR read_at IS NULL) ORDER BY created_at DESC,id`,
    [userId, unreadOnly], page);
}

export async function unreadCount(userId: string) {
  return (await dbPool.query("SELECT COUNT(*)::int AS n FROM notifications WHERE recipient_user_id=$1::uuid AND read_at IS NULL", [userId])).rows[0].n as number;
}

/** Marks the given notifications (or all of the user's) as read. Only the recipient's own rows are touched. */
export async function markRead(userId: string, ids: string[] | "all") {
  const result = ids === "all"
    ? await dbPool.query("UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE recipient_user_id=$1::uuid AND read_at IS NULL", [userId])
    : await dbPool.query("UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE recipient_user_id=$1::uuid AND id=ANY($2::uuid[]) AND read_at IS NULL", [userId, ids]);
  return result.rowCount ?? 0;
}

export async function preferences(userId: string) {
  const [rows, user] = await Promise.all([
    dbPool.query("SELECT category,email,sms FROM notification_preferences WHERE user_id=$1::uuid", [userId]),
    dbPool.query("SELECT email,phone FROM users WHERE id=$1::uuid", [userId]),
  ]);
  const saved = new Map(rows.rows.map(row => [row.category, row]));
  return {
    contact: { email: user.rows[0]?.email ?? null, phone: user.rows[0]?.phone ?? null },
    // Each flag allows or blocks a channel; both are allowed until the person changes them.
    categories: CATEGORIES.map(category => ({ category, email: saved.get(category)?.email ?? true, sms: saved.get(category)?.sms ?? true })),
  };
}

export async function savePreferences(userId: string, choices: Array<{ category: string; email: boolean; sms: boolean }>) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    for (const choice of choices) {
      await client.query(
        `INSERT INTO notification_preferences(user_id,category,email,sms) VALUES($1,$2,$3,$4)
         ON CONFLICT(user_id,category) DO UPDATE SET email=EXCLUDED.email,sms=EXCLUDED.sms,updated_at=CURRENT_TIMESTAMP`,
        [userId, choice.category, choice.email, choice.sms]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return preferences(userId);
}

export async function deliverySummary() {
  const [counts, failures] = await Promise.all([
    dbPool.query(`SELECT channel,status,COUNT(*)::int AS n FROM notification_deliveries WHERE created_at>CURRENT_TIMESTAMP-interval '7 days' GROUP BY 1,2 ORDER BY 1,2`),
    dbPool.query(`SELECT d.id,d.channel,d.destination,d.status,d.attempts,d.last_error,d.created_at,n.title FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id
      WHERE d.status IN('failed','skipped') ORDER BY d.created_at DESC LIMIT 50`),
  ]);
  return { last_7_days: counts.rows, recent_problems: failures.rows };
}

// ---------- Delivery worker ----------

type Due = { id: string; channel: Channel; destination: string; attempts: number; title: string; body: string; link: string | null; category: string };

/**
 * Sends due email/SMS deliveries. Rows are claimed with SKIP LOCKED so several instances never send the same message;
 * deliveries stuck in "sending" for 10 minutes (a crash mid-send) are released for another attempt.
 */
export async function processDueDeliveries(limit = 25) {
  await dbPool.query("UPDATE notification_deliveries SET status='pending' WHERE status='sending' AND next_attempt_at<CURRENT_TIMESTAMP-interval '10 minutes'");
  const claimed = (await dbPool.query(
    `UPDATE notification_deliveries d SET status='sending',attempts=d.attempts+1,next_attempt_at=CURRENT_TIMESTAMP
     FROM notifications n
     WHERE n.id=d.notification_id AND d.id IN (
       SELECT id FROM notification_deliveries WHERE status='pending' AND next_attempt_at<=CURRENT_TIMESTAMP ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING d.id,d.channel,d.destination,d.attempts,n.title,n.body,n.link,n.category`, [limit])).rows as Due[];
  const outcome = { sent: 0, retried: 0, failed: 0, skipped: 0 };
  for (const delivery of claimed) {
    const content = formatMessage(delivery.channel, delivery);
    try {
      const result = await send({ channel: delivery.channel, to: delivery.destination, ...content });
      await dbPool.query("UPDATE notification_deliveries SET status='sent',sent_at=CURRENT_TIMESTAMP,provider=$2,provider_message_id=$3,last_error=NULL WHERE id=$1",
        [delivery.id, result.provider, result.messageId ?? null]);
      outcome.sent++;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      if (isSkip(error)) {
        await dbPool.query("UPDATE notification_deliveries SET status='skipped',last_error=$2 WHERE id=$1", [delivery.id, message]);
        outcome.skipped++;
        continue;
      }
      const wait = retryDelayMinutes(delivery.attempts);
      if (wait === null) {
        await dbPool.query("UPDATE notification_deliveries SET status='failed',last_error=$2 WHERE id=$1", [delivery.id, message]);
        outcome.failed++;
      } else {
        await dbPool.query("UPDATE notification_deliveries SET status='pending',last_error=$2,next_attempt_at=CURRENT_TIMESTAMP+make_interval(mins=>$3) WHERE id=$1", [delivery.id, message, wait]);
        outcome.retried++;
      }
    }
  }
  return outcome;
}

// ---------- Scheduled checks ----------

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

const monthLabel = (period: string) => new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Overdue monthly returns and overdue factory deliveries. Each event is notified once per recipient (dedupe keys). */
export async function runNotificationChecks() {
  return inTransaction(async client => {
    const today = (await client.query("SELECT CURRENT_DATE::text AS d")).rows[0].d as string;
    let returns = 0, custody = 0;
    const orgs = (await client.query(
      `SELECT o.id,o.created_at::date::text AS joined_on,
         COALESCE((SELECT array_agg(to_char(period_month,'YYYY-MM')) FROM regulatory_returns r WHERE r.organization_id=o.id),'{}') AS filed
       FROM organizations o WHERE o.is_active AND o.type IN('waste_collection_company','recycling_company','processing_plant')`)).rows;
    for (const org of orgs) {
      for (const period of requiredPeriods(org.joined_on, today)) {
        if (org.filed.includes(period) || today <= dueOn(period)) continue;
        await notifyOrganization(client, org.id, ["company_admin"], {
          category: "returns", severity: "warning", title: `Monthly return overdue: ${monthLabel(period)}`,
          body: `The return for ${monthLabel(period)} was due on ${dayLabel(dueOn(period))}. File it in Monthly returns.`,
          link: "/dashboard/returns", dedupeKey: `return-overdue:${org.id}:${period}`,
        });
        returns++;
      }
    }
    const overdue = (await client.query(
      `SELECT s.id,s.organization_id AS seller_id,s.buyer_organization_id AS factory_id,s.quantity_kg,s.sold_on::text AS sold_on,seller.name AS seller_name,factory.name AS factory_name
       FROM recycling_material_sales s JOIN organizations seller ON seller.id=s.organization_id JOIN organizations factory ON factory.id=s.buyer_organization_id
       WHERE s.buyer_organization_id IS NOT NULL AND s.sold_on<CURRENT_DATE-$1::int
         AND NOT EXISTS(SELECT 1 FROM factory_intakes i WHERE i.source_sale_id=s.id AND i.status='received')`, [CUSTODY_RULES.awaitDays])).rows;
    for (const sale of overdue) {
      const kg = Number(sale.quantity_kg).toLocaleString("en-GB");
      await notifyOrganization(client, sale.factory_id, ["company_admin"], {
        category: "custody", severity: "warning", title: `Delivery from ${sale.seller_name} not received`,
        body: `${kg} kg sold to your factory on ${dayLabel(sale.sold_on)} has not been received. Receive it or tell the recycler.`,
        link: "/dashboard/factory", dedupeKey: `custody-overdue:${sale.id}`,
      });
      await notifyOrganization(client, sale.seller_id, ["company_admin"], {
        category: "custody", severity: "warning", title: `${sale.factory_name} has not received your delivery`,
        body: `${kg} kg sold on ${dayLabel(sale.sold_on)} is still not received after ${CUSTODY_RULES.awaitDays} days.`,
        link: "/dashboard/recycling", dedupeKey: `custody-overdue:${sale.id}`,
      });
      custody++;
    }
    const disposal = await notifyDisposalGaps(client);
    const dumping = await notifyOverdueCleanups(client);
    const penalties = await notifyPenaltyDeadlines(client);
    await client.query("SELECT prune_notifications()");
    return { returns_checked: returns, custody_checked: custody, disposal_checked: disposal, dumping_checked: dumping, penalties_checked: penalties };
  });
}
