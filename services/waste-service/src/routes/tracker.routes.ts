import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest, requireRoles } from "../middlewares/auth.middleware";
import * as repo from "../repositories/tracker.repository";
import { MinuteLimiter, parseTrackerKey } from "../services/api-keys";

// GPS trackers fitted to trucks (migration 121). Management sits under /fleet, so the fleet package gate applies.
// Positions arrive at /api/v1/trackers/osmand in the OsmAnd protocol (Traccar Client and most trackers or gateways
// that forward over HTTP), with the device key as the device identifier.

const run = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
const company = (req: Request) => {
  const id = auth(req).organizationId;
  if (!id) throw Object.assign(new Error("Trackers belong to a collection company account"), { statusCode: 403 });
  return id;
};

export const createSchema = z.object({
  truckId: z.guid(),
  label: z.string().trim().min(2).max(80),
  serialNumber: z.string().trim().min(3).max(40).optional(),
});
const retireSchema = z.object({ reason: z.string().trim().min(5).max(300) });

const r = Router();
r.get("/fleet/trackers", requireRoles("company_admin", "supervisor"), run(async (req, res) => {
  const organizationId = company(req);
  const [trackers, trucks] = await Promise.all([repo.listTrackers(organizationId), repo.trucksWithoutTracker(organizationId)]);
  return res.json({ success: true, message: "Trackers", data: { trackers, trucksWithoutTracker: trucks } });
}));
r.post("/fleet/trackers", requireRoles("company_admin"), run(async (req, res) => {
  const data = await repo.createTracker(company(req), auth(req).userId, createSchema.parse(req.body));
  return res.status(201).json({ success: true, message: "Tracker registered. Copy the device key now: it will not be shown again.", data });
}));
r.post("/fleet/trackers/:id/retire", requireRoles("company_admin"), run(async (req, res) => {
  const { reason } = retireSchema.parse(req.body);
  const data = await repo.retireTracker(z.guid().parse(req.params.id), company(req), auth(req).userId, reason);
  return res.json({ success: true, message: `${data.label} is retired. Its positions are refused from now on.`, data });
}));

// ---- Positions from trackers ---------------------------------------------------------------------------------

const KNOTS_TO_KPH = 1.852;
const trackers = new MinuteLimiter(), failures = new MinuteLimiter();
const POSITIONS_PER_MINUTE = 120, FAILED_ATTEMPTS_PER_MINUTE = 20;

const number = (value: unknown) => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Unix seconds or milliseconds, or an ISO time. Missing means now. */
export function parseTimestamp(value: unknown): Date | null {
  if (value === undefined || value === null || value === "") return new Date();
  const n = Number(value);
  const date = Number.isFinite(n) ? new Date(n < 1e11 ? n * 1000 : n) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * One OsmAnd position: query or form fields (`id, lat, lon, timestamp, speed` in knots, `bearing, accuracy`), or the JSON
 * body newer Traccar Client versions send (`device_id, location.coords` with speed in metres a second).
 */
export function parseOsmAnd(query: Record<string, unknown>, body: unknown) {
  const json = body && typeof body === "object" && "location" in body ? body as { device_id?: unknown; location?: { timestamp?: unknown; coords?: Record<string, unknown> } } : null;
  if (json) {
    const c = json.location?.coords ?? {};
    const speed = number(c.speed);
    return { id: String(json.device_id ?? query.id ?? ""), recordedAt: parseTimestamp(json.location?.timestamp), latitude: number(c.latitude), longitude: number(c.longitude),
      accuracyM: number(c.accuracy), speedKph: speed !== null && speed >= 0 ? Math.round(speed * 3.6 * 100) / 100 : null, heading: number(c.heading) };
  }
  const f = { ...(body && typeof body === "object" ? body as Record<string, unknown> : {}), ...query };
  const speed = number(f.speed);
  return { id: String(f.id ?? f.deviceid ?? ""), recordedAt: parseTimestamp(f.timestamp), latitude: number(f.lat), longitude: number(f.lon),
    accuracyM: number(f.accuracy), speedKph: speed !== null && speed >= 0 ? Math.round(speed * KNOTS_TO_KPH * 100) / 100 : null, heading: number(f.bearing) };
}

const clamp = (value: number | null, min: number, max: number) => value === null || value < min || value > max ? null : value;

async function receive(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  const address = req.ip ?? "unknown";
  const position = parseOsmAnd(req.query as Record<string, unknown>, req.body);
  const key = parseTrackerKey(position.id);
  if (!key) {
    if (!failures.take(address, FAILED_ATTEMPTS_PER_MINUTE).allowed) return res.status(429).json({ result: "too_many_failures" });
    return res.status(401).json({ result: "unknown_key", message: "Set the tracker's device identifier to its KWMS device key (kwt_...)." });
  }
  if (!trackers.take(key.prefix, POSITIONS_PER_MINUTE).allowed) return res.status(429).json({ result: "rate_limited" });
  if (position.latitude === null || position.longitude === null || !position.recordedAt) return res.status(400).json({ result: "invalid", message: "Send lat, lon and a valid timestamp." });
  const result = await repo.recordPosition(key.prefix, key.hash, address, {
    recordedAt: position.recordedAt, latitude: position.latitude, longitude: position.longitude,
    accuracyM: clamp(position.accuracyM, 0, 100000), speedKph: clamp(position.speedKph, 0, 300), heading: clamp(position.heading, 0, 360),
  });
  if (result === "unknown_key") {
    failures.take(address, FAILED_ATTEMPTS_PER_MINUTE);
    return res.status(401).json({ result, message: "This device key is not registered, or the tracker was retired." });
  }
  // Every other outcome is final, so the tracker must not resend: answer 200 and say what was done.
  return res.json({ result });
}

export const trackerIngestRoutes = Router();
trackerIngestRoutes.get("/osmand", run(receive));
trackerIngestRoutes.post("/osmand", run(receive));

export default r;
