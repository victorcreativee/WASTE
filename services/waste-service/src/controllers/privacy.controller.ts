import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import * as repo from "../repositories/privacy.repository";
import { consentSchema, holdSchema, noticeSchema, releaseSchema, retentionSchema } from "../validators/privacy.validator";

const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
const isRegulator = (roles: string[]) => roles.includes("kcca_admin") || roles.includes("system_admin");
const actor = (req: Request) => ({ userId: auth(req).userId, organizationId: auth(req).organizationId, kcca: isRegulator(auth(req).roles) });
/** Spreadsheet programs run cells starting with these as formulas. */
const cell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function getNotice(_req: Request, res: Response) {
  return res.json({ success: true, message: "Location notice fetched", data: await repo.currentNotice() });
}

export async function getMine(req: Request, res: Response) {
  return res.json({ success: true, message: "Your location data", data: await repo.myGpsStatus(auth(req).userId) });
}

export async function postConsent(req: Request, res: Response) {
  const { decision, noticeVersion } = consentSchema.parse(req.body);
  const data = await repo.recordConsent(auth(req).userId, decision, noticeVersion, req.ip ?? null, req.get("user-agent") ?? null);
  const message = decision === "granted" ? "Location sharing is on during trips" : "Location sharing is off";
  return res.status(201).json({ success: true, message, data });
}

export async function exportMine(req: Request, res: Response) {
  const rows = await repo.exportMyGps(auth(req).userId);
  const header = ["recorded_at", "latitude", "longitude", "accuracy_m", "speed_kph", "heading_degrees", "trip_number", "plate_number"];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="my-location-data.csv"');
  return res.send([header.join(","), ...rows.map(row => header.map(key => cell(row[key])).join(","))].join("\n"));
}

export async function getOverview(req: Request, res: Response) {
  const a = auth(req);
  return res.json({ success: true, message: "GPS data policy fetched", data: await repo.gpsOverview(isRegulator(a.roles) ? null : a.organizationId) });
}

export async function putRetention(req: Request, res: Response) {
  const { rawPointDays } = retentionSchema.parse(req.body);
  return res.json({ success: true, message: `Positions are now kept for ${rawPointDays} days`, data: await repo.setRetention(rawPointDays, auth(req).userId) });
}

export async function postNotice(req: Request, res: Response) {
  const data = await repo.publishNotice(noticeSchema.parse(req.body), auth(req).userId);
  return res.status(201).json({ success: true, message: `Notice version ${data.version} published. Drivers must agree again before sharing location.`, data });
}

export async function postHold(req: Request, res: Response) {
  const { tripNumber, reason } = holdSchema.parse(req.body);
  return res.status(201).json({ success: true, message: `Trip ${tripNumber} is on hold; its positions will be kept`, data: await repo.placeHold(tripNumber, reason, actor(req)) });
}

export async function postRelease(req: Request, res: Response) {
  const { note } = releaseSchema.parse(req.body);
  return res.json({ success: true, message: "Hold released; the positions follow the normal retention period", data: await repo.releaseHold(req.params.id as string, note, actor(req)) });
}

export async function postRunRetention(_req: Request, res: Response) {
  const run = await repo.runGpsRetention(true);
  return res.json({ success: true, message: `${run.deleted_points.toLocaleString("en-GB")} expired positions deleted`, data: run });
}
