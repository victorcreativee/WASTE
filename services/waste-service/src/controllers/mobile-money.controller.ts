import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import * as repo from "../repositories/mobile-money.repository";
import { accountStatusSchema, airtelAccountSchema, mtnAccountSchema, providerParamSchema, reconciliationQuerySchema, reviewResolutionSchema } from "../validators/mobile-money.validator";

const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
const org = (req: Request) => auth(req).organizationId!;

export async function getAccounts(req: Request, res: Response) {
  return res.json({ success: true, message: "Mobile money accounts fetched", data: await repo.listPaymentAccounts(org(req)) });
}
export async function putAccount(req: Request, res: Response) {
  const provider = providerParamSchema.parse(req.params.provider);
  const input = provider === "mtn_momo" ? mtnAccountSchema.parse(req.body) : airtelAccountSchema.parse(req.body);
  const result = await repo.savePaymentAccount(org(req), provider, input, auth(req).userId);
  return res.json({ success: true, message: result.verified ? "Account connected and verified" : `Saved, but the provider check failed: ${result.error}`, data: result });
}
export async function patchAccountStatus(req: Request, res: Response) {
  const data = await repo.setPaymentAccountStatus(org(req), providerParamSchema.parse(req.params.provider), accountStatusSchema.parse(req.body).status);
  if (!data) return res.status(404).json({ success: false, message: "This provider is not connected" });
  return res.json({ success: true, message: data.status === "active" ? "Payments switched on" : "Payments switched off; households are asked to pay by hand", data });
}
export async function postAccountTest(req: Request, res: Response) {
  const result = await repo.testPaymentAccount(org(req), providerParamSchema.parse(req.params.provider));
  return res.json({ success: true, message: result.verified ? "The provider accepted the credentials" : `The provider check failed: ${result.error}`, data: result });
}
export async function getReconciliation(req: Request, res: Response) {
  const { from, to } = reconciliationQuerySchema.parse(req.query);
  return res.json({ success: true, message: "Mobile money reconciliation fetched", data: await repo.mobileMoneyReconciliation(org(req), from, to) });
}
/** The period's mobile money payments as CSV, to tick off against the MTN or Airtel statement. */
export async function getStatement(req: Request, res: Response) {
  const { from, to } = reconciliationQuerySchema.parse(req.query);
  const rows = await repo.mobileMoneyStatement(org(req), from, to);
  const columns = ["day", "created_at", "provider", "provider_environment", "provider_request_id", "provider_reference", "payer_phone", "amount_ugx", "status", "provider_status", "receipt_number", "needs_review", "review_reason", "invoice_number", "customer_name"];
  const cell = (value: unknown) => {
    const text = value instanceof Date ? value.toISOString() : value === null || value === undefined ? "" : String(value);
    return /[",\n]|^[=+\-@]/.test(text) ? `"${text.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : text;
  };
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="mobile-money-${from}-to-${to}.csv"`);
  return res.send([columns.join(","), ...rows.map(row => columns.map(column => cell(row[column])).join(","))].join("\n"));
}
export async function postPaymentCheck(req: Request, res: Response) {
  const data = await repo.checkCompanyPayment(req.params.paymentId as string, org(req));
  if (!data) return res.status(404).json({ success: false, message: "Payment not found" });
  const messages = { confirmed: "Confirmed: the bill is paid", failed: "The provider says the payment failed", pending: "Still waiting for the payer", review: "Set aside for review", skipped: "This payment is not waiting on a provider" };
  return res.json({ success: true, message: messages[data.outcome], data });
}
export async function postReviewResolution(req: Request, res: Response) {
  const data = await repo.resolvePaymentReview(req.params.paymentId as string, org(req), auth(req).userId, reviewResolutionSchema.parse(req.body));
  if (!data) return res.status(404).json({ success: false, message: "No payment waiting for review" });
  return res.json({ success: true, message: "Review closed", data });
}
export async function getHouseholdPayment(req: Request, res: Response) {
  const data = await repo.findHouseholdPayment(req.params.paymentId as string, auth(req).userId);
  if (!data) return res.status(404).json({ success: false, message: "Payment not found" });
  return res.json({ success: true, message: "Payment fetched", data });
}

// Provider callbacks (public). They are acknowledged at once and only prompt a status check with the provider.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function mtnCallback(req: Request, res: Response) {
  const paymentId = String(req.params.paymentId);
  if (uuid.test(paymentId)) await repo.recordCallback("mtn_momo", { paymentId }, req.body, req.ip);
  return res.status(200).json({ received: true });
}
export async function airtelCallback(req: Request, res: Response) {
  const requestId = req.body?.transaction?.id;
  if (typeof requestId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(requestId)) await repo.recordCallback("airtel_money", { requestId }, req.body, req.ip);
  return res.status(200).json({ received: true });
}
