import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import * as repo from "../repositories/subscription.repository";
import { STATUSES } from "../services/subscription.rules";
import { parsePage, sendList } from "../utils/pagination";
import * as v from "../validators/subscription.validator";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
const bad = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
function uuidParam(req: Request, name: string) {
  const id = String(req.params[name]);
  if (!UUID.test(id)) throw bad("Invalid id");
  return id;
}
function companyOf(req: Request) {
  const id = auth(req).organizationId;
  if (!id) throw Object.assign(new Error("Subscriptions belong to a company"), { statusCode: 403 });
  return id;
}

// Public
export async function getPublicPlans(req: Request, res: Response) {
  const type = typeof req.query.type === "string" && ["waste_collection_company", "recycling_company", "processing_plant"].includes(req.query.type) ? req.query.type : null;
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.json({ success: true, message: "Plans fetched", data: await repo.plans({ publicOnly: true, organizationType: type }) });
}

// Company
export async function getMine(req: Request, res: Response) {
  return res.json({ success: true, message: "Subscription fetched", data: await repo.companySubscription(companyOf(req)) });
}
export async function getMyInvoices(req: Request, res: Response) {
  const page = parsePage(req.query);
  return sendList(res, "Invoices fetched", await repo.companyInvoices(companyOf(req), page), page);
}
export async function patchPlan(req: Request, res: Response) {
  const data = await repo.changePlan(companyOf(req), auth(req).userId, v.changePlanSchema.parse(req.body));
  return res.json({ success: true, message: data.timing === "now" ? `You are now on ${data.plan}` : `${data.plan} starts on ${"effective_on" in data ? data.effective_on : "the next period"}`, data });
}
export async function postCancel(req: Request, res: Response) {
  return res.json({ success: true, message: "The subscription will end at the end of the current period", data: await repo.setCancellation(companyOf(req), auth(req).userId, true) });
}
export async function postResume(req: Request, res: Response) {
  return res.json({ success: true, message: "The subscription will continue", data: await repo.setCancellation(companyOf(req), auth(req).userId, false) });
}
export async function postPayment(req: Request, res: Response) {
  return res.json({ success: true, message: "Payment sent for confirmation", data: await repo.submitPayment(companyOf(req), auth(req).userId, uuidParam(req, "id"), v.paymentSchema.parse(req.body)) });
}

// Platform
export async function getOverview(_req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  return res.json({ success: true, message: "Subscriptions overview fetched", data: await repo.overview() });
}
export async function getSubscriptions(req: Request, res: Response) {
  const status = typeof req.query.status === "string" && (STATUSES as readonly string[]).includes(req.query.status) ? req.query.status : null;
  const q = typeof req.query.q === "string" && req.query.q.trim() ? req.query.q.trim().slice(0, 100) : null;
  const page = parsePage(req.query);
  return sendList(res, "Subscriptions fetched", await repo.listSubscriptions({ status, q }, page), page);
}
export async function getSubscription(req: Request, res: Response) {
  return res.json({ success: true, message: "Subscription fetched", data: await repo.subscriptionDetail(uuidParam(req, "organizationId")) });
}
export async function getUnsubscribed(_req: Request, res: Response) {
  return res.json({ success: true, message: "Companies without a subscription fetched", data: await repo.unsubscribedCompanies() });
}
export async function postStart(req: Request, res: Response) {
  const input = v.startSchema.parse(req.body);
  return res.status(201).json({ success: true, message: "Subscription started", data: await repo.startSubscription(input.organizationId, auth(req).userId, input) });
}
export async function patchAction(req: Request, res: Response) {
  return res.json({ success: true, message: "Subscription updated", data: await repo.adminAction(uuidParam(req, "organizationId"), auth(req).userId, v.adminActionSchema.parse(req.body)) });
}
export async function getInvoices(req: Request, res: Response) {
  const status = typeof req.query.status === "string" && ["open", "payment_submitted", "paid", "void", "overdue"].includes(req.query.status) ? req.query.status : null;
  const organizationId = typeof req.query.organizationId === "string" && UUID.test(req.query.organizationId) ? req.query.organizationId : null;
  const page = parsePage(req.query);
  return sendList(res, "Invoices fetched", await repo.listInvoices({ status, organizationId }, page), page);
}
export async function patchConfirm(req: Request, res: Response) {
  return res.json({ success: true, message: "Payment confirmed", data: await repo.confirmInvoice(uuidParam(req, "id"), auth(req).userId, v.confirmSchema.parse(req.body)) });
}
export async function patchReject(req: Request, res: Response) {
  return res.json({ success: true, message: "Payment rejected", data: await repo.rejectPayment(uuidParam(req, "id"), auth(req).userId, v.reasonSchema.parse(req.body).reason) });
}
export async function patchVoid(req: Request, res: Response) {
  return res.json({ success: true, message: "Invoice voided", data: await repo.voidInvoice(uuidParam(req, "id"), auth(req).userId, v.reasonSchema.parse(req.body).reason) });
}
export async function getAllPlans(_req: Request, res: Response) {
  return res.json({ success: true, message: "Plans fetched", data: await repo.plans({ publicOnly: false }) });
}
export async function putPlan(req: Request, res: Response) {
  return res.json({ success: true, message: "Plan saved", data: await repo.updatePlan(String(req.params.code), v.planSchema.parse(req.body)) });
}
export async function postRunBilling(_req: Request, res: Response) {
  return res.json({ success: true, message: "Billing cycle run", data: await repo.runBillingCycle() });
}
