import { notifyTripAlerts } from "../repositories/trip-alert.repository";

/** Checks open trips every ten minutes and tells the responsible supervisor about new problems (Phase 4H). */
export function startTripAlertScheduler(intervalMs = 10 * 60 * 1000) {
  let warned = false;
  const tick = async () => {
    try {
      await notifyTripAlerts();
    } catch (error) {
      // Before migration 136 the "operations" category is refused; say so once instead of every run.
      if ((error as { code?: string }).code === "23514") { if (!warned) console.warn("Trip alerts are idle: apply database migration 136."); warned = true; return; }
      console.error("Trip alert run failed", error);
    }
  };
  const first = setTimeout(tick, 30_000);
  const timer = setInterval(tick, intervalMs);
  first.unref();
  timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}
