import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import * as repo from "../repositories/penalty.repository";
import { STATUSES } from "../services/penalty.rules";
import { resolvePeriod } from "../services/recycling-oversight.rules";
import { parsePage, sendList } from "../utils/pagination";
import * as v from "../validators/penalty.validator";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
const bad = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
function idParam(req: Request) {
  const id = String(req.params.id);
  if (!UUID.test(id)) throw bad("Invalid id");
  return id;
}
function scopeOf(req: Request): repo.Scope {
  const { userId, organizationId, roles } = auth(req);
  if (roles.some(role => role === "kcca_admin" || role === "system_admin")) return { userId, organizationId, kind: "kcca" };
  if (!organizationId) throw Object.assign(new Error("Penalty notices belong to a company"), { statusCode: 403 });
  return { userId, organizationId, kind: "company" };
}
function statusOf(req: Request) {
  const status = typeof req.query.status === "string" && req.query.status ? req.query.status : null;
  if (status && !["open", "overdue", "escalate", ...STATUSES].includes(status)) throw bad("Unknown status");
  return status;
}

export async function getSchedule(req: Request, res: Response) {
  return res.json({ success: true, message: "Penalty schedule fetched", data: await repo.schedule(req.query.all !== "1") });
}
export async function putScheduleItem(req: Request, res: Response) {
  return res.json({ success: true, message: "Penalty schedule updated", data: await repo.updateScheduleItem(String(req.params.code), auth(req).userId, v.scheduleSchema.parse(req.body)) });
}

export async function getOverview(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  return res.json({ success: true, message: "Penalties overview fetched", data: await repo.cityOverview(resolvePeriod(req.query, await repo.today())) });
}
export async function getNotices(req: Request, res: Response) {
  const scope = scopeOf(req), page = parsePage(req.query);
  const organizationId = scope.kind === "company" ? scope.organizationId
    : typeof req.query.organizationId === "string" && UUID.test(req.query.organizationId) ? req.query.organizationId : null;
  return sendList(res, "Penalty notices fetched", await repo.listNotices({ status: statusOf(req), organizationId }, page), page);
}
export async function getNotice(req: Request, res: Response) {
  return res.json({ success: true, message: "Penalty notice fetched", data: await repo.noticeDetail(idParam(req), scopeOf(req)) });
}
export async function getCompanySummary(req: Request, res: Response) {
  const scope = scopeOf(req);
  if (scope.kind !== "company") throw Object.assign(new Error("Penalty notices belong to a company"), { statusCode: 403 });
  return res.json({ success: true, message: "Penalty summary fetched", data: await repo.companySummary(scope.organizationId!) });
}

export async function postNotice(req: Request, res: Response) {
  const data = await repo.issueNotice(auth(req).userId, v.issueSchema.parse(req.body));
  return res.status(201).json({ success: true, message: `Penalty notice ${data.notice_number} issued`, data });
}
export async function postAppeal(req: Request, res: Response) {
  return res.status(201).json({ success: true, message: "Appeal sent to KCCA", data: await repo.appeal(idParam(req), scopeOf(req), v.appealSchema.parse(req.body).grounds) });
}
export async function postPayment(req: Request, res: Response) {
  return res.json({ success: true, message: "Payment sent to KCCA for confirmation", data: await repo.submitPayment(idParam(req), scopeOf(req), v.paymentSchema.parse(req.body)) });
}
export async function patchConfirmPayment(req: Request, res: Response) {
  return res.json({ success: true, message: "Payment confirmed", data: await repo.confirmPayment(idParam(req), auth(req).userId, v.confirmSchema.parse(req.body)) });
}
export async function patchRejectPayment(req: Request, res: Response) {
  return res.json({ success: true, message: "Payment rejected", data: await repo.rejectPayment(idParam(req), auth(req).userId, v.reasonSchema.parse(req.body).reason) });
}
export async function patchDecideAppeal(req: Request, res: Response) {
  const input = v.decisionSchema.parse(req.body);
  return res.json({ success: true, message: input.decision === "withdrawn" ? "Penalty withdrawn" : input.decision === "reduced" ? "Penalty reduced" : "Appeal not allowed", data: await repo.decideAppeal(idParam(req), auth(req).userId, input) });
}
export async function patchWithdraw(req: Request, res: Response) {
  return res.json({ success: true, message: "Penalty withdrawn", data: await repo.withdraw(idParam(req), auth(req).userId, v.reasonSchema.parse(req.body).reason) });
}
export async function patchEscalate(req: Request, res: Response) {
  const data = await repo.escalate(idParam(req), auth(req).userId, v.escalateSchema.parse(req.body).note);
  return res.json({ success: true, message: `Permit ${data.permit_number} suspended`, data });
}
