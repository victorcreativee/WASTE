import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import * as repo from "../repositories/regulatory-returns.repository";
import { toCsv } from "../services/recycling-oversight.rules";
import { returnResubmissionSchema, returnReviewSchema, returnSubmissionSchema } from "../validators/regulatory.validator";

const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
const noOrganization = (res: Response) => res.status(403).json({ success: false, message: "Your account is not linked to an organization" });
const UUID = /^[0-9a-f-]{36}$/i;

/** Defaults to last month, the one most recently due. */
async function periodOf(req: Request) {
  if (typeof req.query.period === "string" && req.query.period) return req.query.period;
  const [y, m] = (await repo.currentDate()).split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export async function getPortal(req: Request, res: Response) {
  const organizationId = auth(req).organizationId;
  if (!organizationId) return noOrganization(res);
  return res.json({ success: true, message: "Regulatory portal fetched", data: await repo.portal(organizationId) });
}

export async function getOrganizationReturns(req: Request, res: Response) {
  const organizationId = auth(req).organizationId;
  if (!organizationId) return noOrganization(res);
  return res.json({ success: true, message: "Returns fetched", data: await repo.organizationReturns(organizationId) });
}

export async function getReturnPrefill(req: Request, res: Response) {
  const organizationId = auth(req).organizationId;
  if (!organizationId) return noOrganization(res);
  return res.json({ success: true, message: "Return figures prepared", data: await repo.prefill(organizationId, String(req.query.period || "")) });
}

export async function getOrganizationReturn(req: Request, res: Response) {
  const organizationId = auth(req).organizationId;
  if (!organizationId) return noOrganization(res);
  if (!UUID.test(String(req.params.id))) return res.status(400).json({ success: false, message: "Invalid return id" });
  const data = await repo.returnDetail(String(req.params.id), organizationId);
  return data ? res.json({ success: true, message: "Return fetched", data }) : res.status(404).json({ success: false, message: "Return not found" });
}

export async function postReturn(req: Request, res: Response) {
  const { organizationId, userId } = auth(req);
  if (!organizationId) return noOrganization(res);
  const data = await repo.submitReturn(organizationId, userId, returnSubmissionSchema.parse(req.body));
  return res.status(201).json({ success: true, message: data.submitted_late ? "Return submitted after its due date" : "Return submitted to KCCA", data });
}

export async function putReturn(req: Request, res: Response) {
  const { organizationId, userId } = auth(req);
  if (!organizationId) return noOrganization(res);
  const data = await repo.resubmitReturn(organizationId, userId, String(req.params.id), returnResubmissionSchema.parse(req.body));
  return res.json({ success: true, message: "Corrected return resubmitted to KCCA", data });
}

export async function getRegister(req: Request, res: Response) {
  return res.json({ success: true, message: "Returns register fetched", data: await repo.register(await periodOf(req)) });
}

export async function getRegisterReturn(req: Request, res: Response) {
  if (!UUID.test(String(req.params.id))) return res.status(400).json({ success: false, message: "Invalid return id" });
  const data = await repo.returnDetail(String(req.params.id), null);
  return data ? res.json({ success: true, message: "Return fetched", data }) : res.status(404).json({ success: false, message: "Return not found" });
}

export async function patchRegisterReturn(req: Request, res: Response) {
  const input = returnReviewSchema.parse(req.body);
  const data = await repo.reviewReturn(String(req.params.id), auth(req).userId, input.action, input.notes);
  return res.json({ success: true, message: input.action === "accept" ? "Return accepted" : "Return queried; the company can correct and resubmit it", data });
}

export async function getRegisterCsv(req: Request, res: Response) {
  const data = await repo.register(await periodOf(req));
  const csv = toCsv(["Company", "Type", "Period", "Status", "Return", "Version", "Submitted", "Late", "Figures differing from platform records"],
    data.companies.map(c => [c.name, c.type === "recycling_company" ? "Recycling company" : "Waste collector", data.period, c.state, c.return_number, c.version,
      c.submitted_at ? new Date(c.submitted_at).toISOString().slice(0, 10) : null, c.submitted_late ? "yes" : c.return_id ? "no" : null, c.variance_count]));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="kcca-returns-${data.period}.csv"`);
  res.setHeader("Cache-Control", "private, no-store");
  return res.send(`﻿${csv}`);
}
