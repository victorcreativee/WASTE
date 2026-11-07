import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest, requireRoles } from "../middlewares/auth.middleware";
import { requireOrganizationScope } from "../middlewares/organization-scope";
import * as repo from "../repositories/recycling-corrections.repository";

// Corrections change stock and money after the fact, so only the company administrator can make them.
const r = Router();
const admin = requireRoles("company_admin");
const run = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => { try { await handler(req, res); } catch (error) { next(error); } };
const org = (req: Request) => requireOrganizationScope(req as AuthenticatedRequest);
const user = (req: Request) => (req as AuthenticatedRequest).auth!.userId;
const reason = z.string().trim().min(5, "Give the reason for this correction (at least 5 characters)").max(300);
const material = z.string().trim().min(2).max(80);

export const transferSchema = z.object({ fromMaterial: material, toMaterial: material, quantityKg: z.number().positive().max(10000000), transferDate: z.string().date(), reason, allowNewMaterial: z.boolean().default(false) })
  .refine(d => d.fromMaterial.toLowerCase() !== d.toMaterial.toLowerCase(), { message: "Choose two different materials", path: ["toMaterial"] });
export const cashSchema = z.object({ account: z.enum(["office", "float"]), direction: z.enum(["add", "reduce"]), amountUgx: z.number().int().positive().max(100000000000), correctionDate: z.string().date(), reason });
export const cancelSchema = z.object({ entryType: z.enum(["expense", "float", "cash"]), id: z.guid(), reason });

r.post("/recycling/corrections/material-transfers", admin, run(async (req, res) => {
  const data = await repo.transferMaterial(org(req), user(req), transferSchema.parse(req.body));
  return res.status(201).json({ success: true, message: `${data.quantityKg.toLocaleString("en-GB")} kg moved from ${data.fromMaterial} to ${data.toMaterial}`, data });
}));
r.post("/recycling/corrections/material-transfers/:entryId/reverse", admin, run(async (req, res) => {
  const data = await repo.reverseMaterialTransfer(org(req), user(req), z.guid().parse(req.params.entryId), z.object({ reason }).parse(req.body).reason);
  return res.json({ success: true, message: `${data.quantityKg.toLocaleString("en-GB")} kg moved back to ${data.fromMaterial}`, data });
}));
r.post("/recycling/corrections/cash", admin, run(async (req, res) => {
  const data = await repo.reconcileCash(org(req), user(req), cashSchema.parse(req.body));
  return res.status(201).json({ success: true, message: `${data.account === "office" ? "Office cash" : "Manager float"} reconciled: UGX ${data.amountUgx.toLocaleString("en-GB")} ${data.direction === "add" ? "added" : "taken off"}. New balance UGX ${data.balanceUgx.toLocaleString("en-GB")}`, data });
}));
r.get("/recycling/corrections/cancellable", admin, run(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json({ success: true, message: "Entries fetched", data: await repo.cancellableEntries(org(req)) });
}));
r.post("/recycling/corrections/cancel", admin, run(async (req, res) => {
  const data = await repo.cancelEntry(org(req), user(req), cancelSchema.parse(req.body));
  return res.json({ success: true, message: `${data.label} cancelled`, data });
}));
export default r;
