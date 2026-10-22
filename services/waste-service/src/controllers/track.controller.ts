import { Request, Response } from "express";
import { z } from "zod";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import * as repo from "../repositories/track.repository";
import { resolvePeriod } from "../services/recycling-oversight.rules";
import { parsePage, sendList } from "../utils/pagination";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIEWS = ["exceptions", "stops", "consistent", "no_gps", "no_facility_visit", "ticket_mismatch"];
const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
const bad = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusM: z.number().int().min(50, "Use a radius of at least 50 m").max(3000, "Use a radius of at most 3,000 m"),
}).strict();

function scopeOf(req: Request): repo.Scope {
  const { organizationId, roles } = auth(req);
  if (roles.some(role => role === "kcca_admin" || role === "system_admin")) return { organizationId, kind: "kcca" };
  if (!organizationId) throw Object.assign(new Error("GPS checks belong to a collection company"), { statusCode: 403 });
  return { organizationId, kind: "company" };
}
const periodOf = async (req: Request) => resolvePeriod(req.query, await repo.today());
function orgFilter(req: Request, scope: repo.Scope) {
  if (scope.kind === "company") return scope.organizationId;
  const id = typeof req.query.organizationId === "string" ? req.query.organizationId : "";
  if (id && !UUID.test(id)) throw bad("Invalid organization id");
  return id || null;
}

export async function getFacilities(_req: Request, res: Response) {
  return res.json({ success: true, message: "Facility geofences fetched", data: await repo.facilities() });
}
export async function putFacilityLocation(req: Request, res: Response) {
  return res.json({ success: true, message: "Facility location saved", data: await repo.setFacilityLocation(String(req.params.code), locationSchema.parse(req.body)) });
}
export async function getOverview(req: Request, res: Response) {
  const scope = scopeOf(req);
  res.setHeader("Cache-Control", "no-store");
  return res.json({ success: true, message: "GPS checks fetched", data: await repo.overview(await periodOf(req), orgFilter(req, scope)) });
}
export async function getChecks(req: Request, res: Response) {
  const scope = scopeOf(req), page = parsePage(req.query);
  const view = typeof req.query.view === "string" && req.query.view ? req.query.view : null;
  if (view && !VIEWS.includes(view)) throw bad("Unknown view");
  return sendList(res, "GPS checks fetched", await repo.listChecks(await periodOf(req), { organizationId: orgFilter(req, scope), view }, page), page);
}
export async function getCheck(req: Request, res: Response) {
  const id = String(req.params.tripId);
  if (!UUID.test(id)) throw bad("Invalid trip id");
  return res.json({ success: true, message: "GPS check fetched", data: await repo.checkDetail(id, scopeOf(req)) });
}
export async function postRecheck(req: Request, res: Response) {
  const id = String(req.params.tripId);
  if (!UUID.test(id)) throw bad("Invalid trip id");
  const result = await repo.checkTrip(id);
  if ("skipped" in result && result.skipped) {
    const reasons = { no_facility_locations: "Set the location of at least one disposal facility first", not_a_completed_trip: "Only a completed collection trip can be checked",
      disposal_leg_open: "The disposal leg is still open; the trip is checked once it ends" } as const;
    return res.status(409).json({ success: false, message: reasons[result.skipped] });
  }
  return res.json({ success: true, message: "Trip checked again", data: result });
}
export async function postRun(_req: Request, res: Response) {
  return res.json({ success: true, message: "GPS checks run", data: await repo.runTrackChecks() });
}
