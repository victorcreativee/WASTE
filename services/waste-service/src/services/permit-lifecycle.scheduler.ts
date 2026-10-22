import { env } from "../config/env";
import { runLifecycle } from "../repositories/permit-lifecycle.repository";

const HOUR = 60 * 60 * 1000;

/**
 * Expires lapsed permits and issues renewal reminders shortly after start-up and then hourly.
 * An advisory lock in runLifecycle keeps several service instances from doing the same work.
 */
export function startPermitLifecycleScheduler(intervalMs = HOUR) {
  let warnedMissingMigration = false;
  if (env.nodeEnv === "production" && !process.env.PUBLIC_APP_URL) {
    console.warn("PUBLIC_APP_URL is not set: permit certificate QR codes will point to localhost. Set it to the public web address.");
  }
  const tick = async () => {
    try {
      const result = await runLifecycle();
      if (!result) {
        if (!warnedMissingMigration) console.warn("Permit lifecycle is idle: apply database migration 092 to enable automatic expiry and reminders.");
        warnedMissingMigration = true;
        return;
      }
      if (result.expired || result.reminders) console.log(`Permit lifecycle: ${result.expired} expired, ${result.reminders} reminder(s) issued`);
    } catch (error) {
      console.error("Permit lifecycle run failed", error);
    }
  };
  const first = setTimeout(tick, 15_000);
  const timer = setInterval(tick, intervalMs);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
