import { dbPool } from "../config/database";
import { processDueDeliveries, runNotificationChecks } from "../repositories/notification.repository";
import { runTrackChecks } from "../repositories/track.repository";
import { runBillingCycle } from "../repositories/subscription.repository";

/**
 * Sends due email/SMS every 30 seconds and runs the overdue checks GPS track checks (Module 11) and the subscription billing cycle (Module 12) hourly. Missing tables (migration 098 not applied)
 * are reported once and otherwise ignored. NOTIFICATION_WORKER=off disables both. Each delivery tick holds a shared
 * advisory lock, so whoever holds it exclusively (the notifications e2e suite) pauses background sending on that database.
 */
export function startNotificationScheduler(deliveryMs = 30_000, checksMs = 60 * 60_000) {
  let warned = false;
  const guard = (label: string, work: () => Promise<unknown>) => async () => {
    try {
      await work();
    } catch (error) {
      if ((error as { code?: string }).code === "42P01") {
        if (!warned) console.warn("Notifications are idle: apply database migration 098.");
        warned = true;
        return;
      }
      console.error(`Notification ${label} failed`, error);
    }
  };
  const deliveries = guard("delivery", async () => {
    const client = await dbPool.connect();
    try {
      const lock = await client.query("SELECT pg_try_advisory_lock_shared(hashtext('notification-delivery')) AS locked");
      if (!lock.rows[0].locked) return;
      try {
        const outcome = await processDueDeliveries();
        if (outcome.sent || outcome.failed || outcome.retried) console.log(`Notifications: ${outcome.sent} sent, ${outcome.retried} retrying, ${outcome.failed} failed, ${outcome.skipped} skipped`);
      } finally {
        await client.query("SELECT pg_advisory_unlock_shared(hashtext('notification-delivery'))");
      }
    } finally {
      client.release();
    }
  });
  const checks = guard("checks", async () => {
    const client = await dbPool.connect();
    try {
      const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('notification-checks')) AS locked");
      if (!lock.rows[0].locked) return;
      try { await runNotificationChecks(); await runTrackChecks(); await runBillingCycle(); } finally { await client.query("SELECT pg_advisory_unlock(hashtext('notification-checks'))"); }
    } finally {
      client.release();
    }
  });
  const timers = [setInterval(deliveries, deliveryMs), setInterval(checks, checksMs), setTimeout(checks, 20_000), setTimeout(deliveries, 5_000)];
  timers.forEach(timer => timer.unref());
  return () => timers.forEach(timer => clearTimeout(timer as NodeJS.Timeout));
}
