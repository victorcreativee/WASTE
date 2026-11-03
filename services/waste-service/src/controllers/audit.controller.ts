import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { PAGE_DEFAULT, parsePage, sendList } from "../utils/pagination";
import * as repo from "../repositories/audit.repository";
import { auditIdSchema, auditListQuerySchema } from "../validators/audit.validator";

const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
const isRegulator = (roles: string[]) => roles.includes("kcca_admin") || roles.includes("system_admin");
/** KCCA sees every organization (optionally one); a company only its own. */
const organizationOf = (req: Request, requested?: string) => isRegulator(auth(req).roles) ? requested ?? null : auth(req).organizationId;

export async function getAuditLog(req: Request, res: Response) {
  const query = auditListQuerySchema.parse(req.query), page = parsePage(req.query) ?? { limit: PAGE_DEFAULT, offset: 0 };
  const result = await repo.listAudit({ ...query, organizationId: organizationOf(req, query.organizationId) }, page);
  return sendList(res, "Audit log fetched", result, page);
}

export async function getAuditEntry(req: Request, res: Response) {
  const entry = await repo.findAuditEntry(auditIdSchema.parse(req.params.id), organizationOf(req));
  if (!entry) return res.status(404).json({ success: false, message: "Audit entry not found" });
  return res.json({ success: true, message: "Audit entry fetched", data: entry });
}

export async function getAuditFilters(req: Request, res: Response) {
  return res.json({ success: true, message: "Audit filters fetched", data: await repo.auditFilterOptions(organizationOf(req)) });
}

export async function getIsolationStatus(_req: Request, res: Response) {
  return res.json({ success: true, message: "Isolation status fetched", data: await repo.isolationStatus() });
}
