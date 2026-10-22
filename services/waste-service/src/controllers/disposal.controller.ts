import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import * as repo from "../repositories/disposal.repository";
import { DISPOSAL_STATES, EXCEPTION_STATES } from "../services/disposal.rules";
import { resolvePeriod } from "../services/recycling-oversight.rules";
import { parsePage, sendList } from "../utils/pagination";
import { acceptWithoutTripSchema, explanationSchema, facilitySchema, linkTicketSchema, reviewSchema } from "../validators/disposal.validator";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
const periodOf = async (req: Request) => resolvePeriod(req.query, await repo.today());
const collectorOf = async (req: Request) => (await repo.requireCollector(auth(req).organizationId)).id;
function idParam(req: Request, name = "id") {
  const id = String(req.params[name]);
  if (!UUID.test(id)) throw Object.assign(new Error("Invalid id"), { statusCode: 400 });
  return id;
}
/** `?state=unverified,declared` or `?state=exceptions`; unknown names are refused. */
function statesOf(req: Request): string[] | null {
  const raw = typeof req.query.state === "string" ? req.query.state.trim() : "";
  if (!raw) return null;
  if (raw === "exceptions") return EXCEPTION_STATES;
  const states = raw.split(",").map(state => state.trim());
  if (states.some(state => !(DISPOSAL_STATES as readonly string[]).includes(state))) throw Object.assign(new Error("Unknown disposal state"), { statusCode: 400 });
  return states;
}
const orgFilter = (req: Request) => {
  const id = typeof req.query.organizationId === "string" ? req.query.organizationId : "";
  if (id && !UUID.test(id)) throw Object.assign(new Error("Invalid organization id"), { statusCode: 400 });
  return id || null;
};

export async function getFacilities(req: Request, res: Response) {
  return res.json({ success: true, message: "Disposal facilities fetched", data: await repo.facilities(req.query.all !== "1") });
}

export async function putFacility(req: Request, res: Response) {
  return res.json({ success: true, message: "Disposal facility saved", data: await repo.saveFacility(facilitySchema.parse(req.body)) });
}

// Company

export async function getCompanySummary(req: Request, res: Response) {
  return res.json({ success: true, message: "Disposal summary fetched", data: await repo.companySummary(await collectorOf(req), await periodOf(req)) });
}

export async function getCompanyTrips(req: Request, res: Response) {
  const page = parsePage(req.query);
  return sendList(res, "Trips fetched", await repo.listTrips(await periodOf(req), { organizationId: await collectorOf(req), states: statesOf(req) }, page), page);
}

export async function getCompanyTickets(req: Request, res: Response) {
  const page = parsePage(req.query);
  return sendList(res, "Weighbridge tickets fetched", await repo.listTickets(await periodOf(req), { organizationId: await collectorOf(req), unlinkedOnly: req.query.unlinked === "1" }, page), page);
}

export async function postExplanation(req: Request, res: Response) {
  const data = await repo.submitExplanation(await collectorOf(req), auth(req).userId, idParam(req, "tripId"), explanationSchema.parse(req.body));
  return res.status(201).json({ success: true, message: "Explanation sent to KCCA", data });
}

export async function patchLinkTicket(req: Request, res: Response) {
  const data = await repo.linkOwnTicket(await collectorOf(req), auth(req).userId, idParam(req), linkTicketSchema.parse(req.body).tripId);
  return res.json({ success: true, message: "Ticket linked to the trip", data });
}

// KCCA

export async function getCityOverview(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  return res.json({ success: true, message: "Disposal verification fetched", data: await repo.cityOverview(await periodOf(req)) });
}

export async function getCityTrips(req: Request, res: Response) {
  const page = parsePage(req.query);
  return sendList(res, "Trips fetched", await repo.listTrips(await periodOf(req), { organizationId: orgFilter(req), states: statesOf(req) }, page), page);
}

export async function getCityTickets(req: Request, res: Response) {
  const page = parsePage(req.query);
  return sendList(res, "Weighbridge tickets fetched", await repo.listTickets(await periodOf(req), { organizationId: orgFilter(req), unlinkedOnly: req.query.unlinked === "1" }, page), page);
}

export async function getExplanations(req: Request, res: Response) {
  const page = parsePage(req.query);
  const status = typeof req.query.status === "string" && ["submitted", "accepted", "rejected"].includes(req.query.status) ? req.query.status : "submitted";
  return sendList(res, "Explanations fetched", await repo.listExplanations({ organizationId: orgFilter(req), status }, page), page);
}

export async function patchReviewExplanation(req: Request, res: Response) {
  const input = reviewSchema.parse(req.body);
  const data = await repo.reviewExplanation(idParam(req), auth(req).userId, input.action, input.note);
  return res.json({ success: true, message: input.action === "accept" ? "Explanation accepted" : "Explanation rejected", data });
}

export async function patchAcceptWithoutTrip(req: Request, res: Response) {
  const data = await repo.acceptTicketWithoutTrip(idParam(req), auth(req).userId, acceptWithoutTripSchema.parse(req.body).reason);
  return res.json({ success: true, message: "Ticket accepted as a load without a trip", data });
}
