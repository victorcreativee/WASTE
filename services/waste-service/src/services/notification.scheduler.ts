import { dbPool } from "../config/database";
import { processDueDeliveries, runNotificationChecks } from "../repositories/notification.repository";
import { runTrackChecks } from "../repositories/track.repository";
import { runBillingCycle } from "../repositories/subscription.repository";
import { runHouseholdReminders } from "../repositories/household.repository";
import { generateDueExports } from "../repositories/receipt.repository";
import { runDuePaymentChecks } from "../repositories/mobile-money.repository";
import { syncTariffPlanFees } from "../repositories/tariff.repository";
import { runGpsRetention } from "../repositories/privacy.repository";
import { refreshBaselineIfDue } from "../repositories/landfill.repository";
import { runOverdueReminders } from "../repositories/arrears.repository";
import { refreshGpsQuality } from "../repositories/fleet-quality.repository";

/**
 * Sends due email/SMS every 30 seconds and runs the overdue checks GPS track checks (Module 11) the subscription billing cycle (Module 12) and household reminders hourly. Missing tables (migration 098 not applied)
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
      try { await runNotificationChecks(); await runTrackChecks(); await runBillingCycle(); await runHouseholdReminders(); await syncTariffPlanFees();
        // GPS retention (migration 114): once a day, positions older than KCCA's period are deleted.
        const purge = await runGpsRetention();
        if (purge?.deleted_points) console.log(`GPS retention: ${purge.deleted_points} positions older than ${purge.raw_point_days} days deleted`);
        // Carbon baseline (migration 115): recalculated once a day.
        await refreshBaselineIfDue();
        // Overdue bills (migration 117): reminded 1, 14 and 30 days after the due date.
        await runOverdueReminders();
        // GPS data completeness (migration 120): ended trips are summarised before their positions are deleted.
        await refreshGpsQuality();
      } finally { await client.query("SELECT pg_advisory_unlock(hashtext('notification-checks'))"); }
    } finally {
      client.release();
    }
  });
  // Signed daily receipt exports for KCCA (migration 111): checked every 10 minutes, so each Kampala day is exported
  // within minutes of midnight, and any missed days are caught up after downtime.
  const exports = guard("receipt exports", async () => {
    const client = await dbPool.connect();
    try {
      const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('receipt-exports')) AS locked");
      if (!lock.rows[0].locked) return;
      try {
        const generated = await generateDueExports();
        if (generated) console.log(`Receipt exports: ${generated} daily export${generated === 1 ? "" : "s"} signed`);
      } finally { await client.query("SELECT pg_advisory_unlock(hashtext('receipt-exports'))"); }
    } finally {
      client.release();
    }
  });
  // Mobile money payments waiting on MTN or Airtel (migration 112): each is checked on its own schedule, starting
  // 10 seconds after the request; a callback brings its check forward.
  const payments = guard("mobile money checks", async () => {
    const client = await dbPool.connect();
    try {
      const lock = await client.query("SELECT pg_try_advisory_lock_shared(hashtext('mobile-money-checks')) AS locked");
      if (!lock.rows[0].locked) return;
      try {
        const outcome = await runDuePaymentChecks();
        if (outcome.confirmed || outcome.failed || outcome.review) console.log(`Mobile money: ${outcome.confirmed} confirmed, ${outcome.failed} failed, ${outcome.review} set aside for review`);
      } finally { await client.query("SELECT pg_advisory_unlock_shared(hashtext('mobile-money-checks'))"); }
    } finally {
      client.release();
    }
  });
  const timers = [setInterval(payments, 5_000), setInterval(deliveries, deliveryMs), setInterval(checks, checksMs), setInterval(exports, 10 * 60_000), setTimeout(checks, 20_000), setTimeout(deliveries, 5_000), setTimeout(exports, 30_000)];
  timers.forEach(timer => timer.unref());
  return () => timers.forEach(timer => clearTimeout(timer as NodeJS.Timeout));
}
