import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import * as repo from "../repositories/dumping.repository";
import { STATUSES } from "../services/dumping.rules";
import { resolvePeriod } from "../services/recycling-oversight.rules";
import { parsePage, sendList } from "../utils/pagination";
import * as v from "../validators/dumping.validator";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
const bad = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
function idParam(req: Request) {
  const id = String(req.params.id);
  if (!UUID.test(id)) throw bad("Invalid id");
  return id;
}
const uuidQuery = (req: Request, name: string) => {
  const value = typeof req.query[name] === "string" ? String(req.query[name]) : "";
  if (value && !UUID.test(value)) throw bad(`Invalid ${name}`);
  return value || null;
};
/** KCCA and system admins see every site; company staff see their own; residents see what they reported. */
function scopeOf(req: Request): repo.Scope {
  const { userId, organizationId, roles } = auth(req);
  if (roles.some(role => role === "kcca_admin" || role === "system_admin")) return { userId, organizationId, kind: "kcca" };
  if (roles.some(role => role === "company_admin" || role === "supervisor") && organizationId) return { userId, organizationId, kind: "company" };
  if (roles.includes("citizen")) return { userId, organizationId: null, kind: "citizen" };
  throw Object.assign(new Error("You do not have access to dumping sites"), { statusCode: 403 });
}

export async function getDivisions(_req: Request, res: Response) {
  return res.json({ success: true, message: "Divisions fetched", data: await repo.divisions() });
}

export async function postReport(req: Request, res: Response) {
  const scope = scopeOf(req), input = v.reportSchema.parse(req.body);
  const data = await repo.createReport({ ...input, userId: scope.userId, organizationId: scope.kind === "company" ? scope.organizationId : null,
    source: scope.kind === "kcca" ? "kcca_officer" : scope.kind === "company" ? "collector" : "resident" });
  const message = data.outcome === "new_site" ? "Dumping site reported" : data.outcome === "recurred" ? "Reported again at a site that had been cleared" : "Added to a site already reported nearby";
  return res.status(201).json({ success: true, message, data });
}

export async function getMyReports(req: Request, res: Response) {
  const page = parsePage(req.query);
  return sendList(res, "Reports fetched", await repo.myReports(auth(req).userId, page), page);
}

export async function getSite(req: Request, res: Response) {
  return res.json({ success: true, message: "Dumping site fetched", data: await repo.siteDetail(idParam(req), scopeOf(req)) });
}

export async function getPhoto(req: Request, res: Response) {
  const image = await repo.photo(idParam(req), scopeOf(req));
  res.setHeader("Content-Type", image.mimeType);
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.send(image.data);
}

// KCCA

export async function getCityOverview(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  return res.json({ success: true, message: "Illegal dumping overview fetched", data: await repo.cityOverview(resolvePeriod(req.query, await repo.today())) });
}

export async function getSites(req: Request, res: Response) {
  const status = typeof req.query.status === "string" && req.query.status ? req.query.status : null;
  if (status && status !== "open" && status !== "overdue" && !(STATUSES as readonly string[]).includes(status)) throw bad("Unknown status");
  const page = parsePage(req.query);
  return sendList(res, "Dumping sites fetched", await repo.listSites({ status, divisionId: uuidQuery(req, "divisionId"),
    cleanupOrganizationId: uuidQuery(req, "cleanupOrganizationId"), responsibleOrganizationId: uuidQuery(req, "responsibleOrganizationId") }, page), page);
}

export async function patchVerify(req: Request, res: Response) {
  return res.json({ success: true, message: "Site verified", data: await repo.verifySite(idParam(req), auth(req).userId, v.verifySchema.parse(req.body)) });
}
export async function patchDismiss(req: Request, res: Response) {
  return res.json({ success: true, message: "Report closed", data: await repo.dismissSite(idParam(req), auth(req).userId, v.dismissSchema.parse(req.body).reason) });
}
export async function patchResponsibility(req: Request, res: Response) {
  const input = v.responsibilitySchema.parse(req.body);
  return res.json({ success: true, message: input.organizationId ? "Responsibility recorded" : "Responsibility removed", data: await repo.setResponsibility(idParam(req), auth(req).userId, input) });
}
export async function patchOrderCleanup(req: Request, res: Response) {
  return res.json({ success: true, message: "Cleanup ordered", data: await repo.orderCleanup(idParam(req), auth(req).userId, v.orderSchema.parse(req.body)) });
}
export async function patchConfirm(req: Request, res: Response) {
  return res.json({ success: true, message: "Site confirmed clear", data: await repo.confirmCleared(idParam(req), auth(req).userId, v.confirmSchema.parse(req.body)) });
}
export async function patchReject(req: Request, res: Response) {
  return res.json({ success: true, message: "Cleanup sent back", data: await repo.rejectCleanup(idParam(req), auth(req).userId, v.rejectSchema.parse(req.body)) });
}

// Company

export async function getCompanyOverview(req: Request, res: Response) {
  const scope = scopeOf(req);
  if (scope.kind !== "company") throw Object.assign(new Error("Cleanup orders belong to a company"), { statusCode: 403 });
  return res.json({ success: true, message: "Cleanup overview fetched", data: await repo.companyOverview(scope.organizationId!) });
}

export async function getCompanySites(req: Request, res: Response) {
  const scope = scopeOf(req);
  if (scope.kind !== "company") throw Object.assign(new Error("Cleanup orders belong to a company"), { statusCode: 403 });
  const attributed = req.query.kind === "attributed", page = parsePage(req.query);
  const status = req.query.status === "open" ? "open" : null;
  return sendList(res, "Dumping sites fetched", await repo.listSites({ status, divisionId: null,
    cleanupOrganizationId: attributed ? null : scope.organizationId, responsibleOrganizationId: attributed ? scope.organizationId : null }, page), page);
}

export async function patchCleanupReport(req: Request, res: Response) {
  const scope = scopeOf(req);
  if (scope.kind !== "company") throw Object.assign(new Error("Only the company KCCA ordered can report the cleanup"), { statusCode: 403 });
  return res.json({ success: true, message: "Cleanup reported to KCCA", data: await repo.reportCleanup(idParam(req), scope.userId, scope.organizationId!, v.cleanupReportSchema.parse(req.body)) });
}
