import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { ApiKeyRequest, apiError } from "../middlewares/api-key.middleware";
import * as repo from "../repositories/open-api.repository";
import { openApiDocument } from "../services/openapi-spec";
import { PARTNER_SCOPES } from "../services/api-keys";
import { createKeySchema, dateRangeSchema, keyIdSchema, monthRangeSchema, pagingSchema, receiptDaySchema, revokeKeySchema } from "../validators/open-api.validator";

const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
const regulator = (req: Request) => auth(req).roles.some(role => role === "kcca_admin" || role === "system_admin");
/** Whose keys the caller manages: KCCA and system administrators every key, a company admin their company's. */
const owner = (req: Request) => regulator(req) ? null : auth(req).organizationId;

// ---- Key management (signed-in administrators) --------------------------------------------------------

export async function getKeys(req: Request, res: Response) {
  return res.json({ success: true, message: "API keys", data: await repo.listKeys(owner(req)) });
}

export async function postKey(req: Request, res: Response) {
  const input = createKeySchema.parse(req.body);
  const partner = regulator(req);
  if (partner) {
    if (!input.holderName || !input.contactEmail || !input.purpose) return res.status(400).json({ success: false, message: "Give the partner's name, contact email and what the data is for" });
    const refused = input.scopes.find(scope => !PARTNER_SCOPES.includes(scope));
    if (refused) return res.status(400).json({ success: false, message: "Partner keys cannot read household receipts" });
  }
  const data = await repo.createKey({
    organizationId: partner ? null : auth(req).organizationId, name: input.name, scopes: input.scopes, expiresInDays: input.expiresInDays,
    rateLimitPerMinute: partner ? input.rateLimitPerMinute ?? 60 : 60,
    ...(partner ? { holderName: input.holderName, contactEmail: input.contactEmail, purpose: input.purpose } : {}),
  }, auth(req).userId);
  return res.status(201).json({ success: true, message: "Key created. Copy it now: it will not be shown again.", data });
}

export async function postRevoke(req: Request, res: Response) {
  const { reason } = revokeKeySchema.parse(req.body);
  const data = await repo.revokeKey(keyIdSchema.parse(req.params.id), owner(req), reason, auth(req).userId);
  return res.json({ success: true, message: `${data.name} is revoked. Requests with it are refused from now on.`, data });
}

export async function getUsage(req: Request, res: Response) {
  return res.json({ success: true, message: "Key usage, last 30 days", data: await repo.keyUsage(keyIdSchema.parse(req.params.id), owner(req)) });
}

// ---- /api/v1 (API keys) -----------------------------------------------------------------------------

const key = (req: Request) => (req as ApiKeyRequest).apiKey!;

export function getSpec(_req: Request, res: Response) {
  return res.json(openApiDocument());
}

export function getMe(req: Request, res: Response) {
  const { name, holder_name, organization_id, scopes, rate_limit_per_minute, expires_at } = key(req);
  return res.json({ data: { name, holder: holder_name, operator_id: organization_id, access: organization_id ? "operator" : "city", scopes, rate_limit_per_minute, expires_at } });
}

export async function getOperators(req: Request, res: Response) {
  return res.json({ data: await repo.operators(key(req).organization_id) });
}

export async function getTonnage(req: Request, res: Response) {
  const { from, to } = dateRangeSchema.parse(req.query);
  return res.json({ data: await repo.tonnage(key(req).organization_id, from, to), meta: { from, to, timezone: "Africa/Kampala" } });
}

export async function getCertificates(req: Request, res: Response) {
  const { from, to } = dateRangeSchema.parse(req.query);
  return res.json(await repo.certificates(key(req).organization_id, from, to, pagingSchema.parse(req.query)));
}

export async function getCarbonBaseline(req: Request, res: Response) {
  const { from, to } = monthRangeSchema.parse(req.query);
  return res.json({ data: await repo.carbonBaseline(key(req).organization_id, from, to), meta: { from, to, unit: "tonnes", note: "Methane generation potential under KCCA's published factors; not verified emission reductions." } });
}

export async function getReceipts(req: Request, res: Response) {
  const organizationId = key(req).organization_id;
  if (!organizationId) return apiError(res, 403, "missing_scope", "Only a company's own key can read its receipts.");
  const { date } = receiptDaySchema.parse(req.query);
  return res.json(await repo.receipts(organizationId, date, pagingSchema.parse(req.query)));
}

/** Errors on /api/v1 in the API's own shape. */
export function apiErrors(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    return apiError(res, 400, "invalid_request", error.issues.map(i => `${i.path.join(".") || "request"}: ${i.message}`).join("; "));
  }
  const status = Number((error as { statusCode?: number }).statusCode);
  if (Number.isInteger(status) && status >= 400 && status < 500) return apiError(res, status, "request_refused", (error as Error).message);
  console.error("open-api request failed", error);
  return apiError(res, 500, "server_error", "Something went wrong on our side. Try again shortly.");
}
