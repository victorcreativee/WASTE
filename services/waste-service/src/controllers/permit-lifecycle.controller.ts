import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import * as repo from "../repositories/permit-lifecycle.repository";
import { organizationPermitIssueSchema, renewalRequestSchema, renewalReviewSchema } from "../validators/regulatory.validator";

const organizationOf = (req: Request) => (req as AuthenticatedRequest).auth!.organizationId;
const userOf = (req: Request) => (req as AuthenticatedRequest).auth!.userId;
const noOrganization = (res: Response) => res.status(403).json({ success: false, message: "Your account is not linked to an organization" });
const RENEWAL_STATUSES = ["submitted", "approved", "rejected", "withdrawn"];

export async function getActivityTypes(_req: Request, res: Response) {
  return res.json({ success: true, message: "Permit activities fetched", data: await repo.activityTypes() });
}

export async function getPermitHistory(req: Request, res: Response) {
  return res.json({ success: true, message: "Permit history fetched", data: await repo.permitHistory(req.params.id as string) });
}

export async function getLifecycleOverview(_req: Request, res: Response) {
  return res.json({ success: true, message: "Permit lifecycle overview fetched", data: await repo.lifecycleOverview() });
}

export async function postLifecycleRun(_req: Request, res: Response) {
  const result = await repo.runLifecycle();
  if (!result) return res.status(503).json({ success: false, message: "Apply database migration 092 before running the permit lifecycle" });
  return res.json({ success: true, message: `${result.expired} permit(s) expired, ${result.reminders} reminder(s) issued`, data: result });
}

export async function getRenewalRequests(req: Request, res: Response) {
  const status = typeof req.query.status === "string" && RENEWAL_STATUSES.includes(req.query.status) ? req.query.status : undefined;
  return res.json({ success: true, message: "Renewal requests fetched", data: await repo.renewalRequests(status) });
}

export async function getRenewalEvidence(req: Request, res: Response) {
  const file = await repo.renewalEvidence(req.params.id as string);
  if (!file) return res.status(404).json({ success: false, message: "No evidence was attached to this request" });
  const [, base64 = ""] = String(file.evidence_data_url).split(",");
  res.setHeader("Content-Type", file.evidence_mime_type);
  res.setHeader("Content-Disposition", `inline; filename="${String(file.evidence_file_name).replace(/["\r\n]/g, "")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  return res.send(Buffer.from(base64, "base64"));
}

export async function patchRenewalRequest(req: Request, res: Response) {
  const input = renewalReviewSchema.parse(req.body);
  const data = await repo.reviewRenewalRequest(req.params.id as string, userOf(req), input);
  return res.json({ success: true, message: input.action === "approve" ? "Renewal approved and permit extended" : "Renewal request rejected", data });
}

export async function getOrganizationPermit(req: Request, res: Response) {
  const organizationId = organizationOf(req);
  if (!organizationId) return noOrganization(res);
  return res.json({ success: true, message: "Permit standing fetched", data: await repo.organizationPermitStanding(organizationId) });
}

export async function postRenewalRequest(req: Request, res: Response) {
  const organizationId = organizationOf(req);
  if (!organizationId) return noOrganization(res);
  const data = await repo.submitRenewalRequest(organizationId, userOf(req), renewalRequestSchema.parse(req.body));
  return res.status(201).json({ success: true, message: "Renewal request sent to KCCA", data });
}

export async function patchWithdrawRenewal(req: Request, res: Response) {
  const organizationId = organizationOf(req);
  if (!organizationId) return noOrganization(res);
  const data = await repo.withdrawRenewalRequest(organizationId, userOf(req), req.params.id as string);
  return res.json({ success: true, message: "Renewal request withdrawn", data });
}

export async function postAcknowledgeNotice(req: Request, res: Response) {
  const organizationId = organizationOf(req);
  if (!organizationId) return noOrganization(res);
  return res.json({ success: true, message: "Notice acknowledged", data: await repo.acknowledgeNotice(organizationId, userOf(req), req.params.id as string) });
}

export async function getCertificateVerification(req: Request, res: Response) {
  const data = await repo.verifyCertificate(String(req.params.code || ""));
  if (!data) return res.status(404).json({ success: false, message: "No KCCA permit matches this verification code" });
  return res.json({ success: true, message: "Permit verified", data });
}

export async function postOrganizationPermit(req: Request, res: Response) {
  const data = await repo.issuePermitToOrganization(req.params.id as string, userOf(req), organizationPermitIssueSchema.parse(req.body));
  return res.status(201).json({ success: true, message: `Permit ${data.permit_number} issued`, data });
}
