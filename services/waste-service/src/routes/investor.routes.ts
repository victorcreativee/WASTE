import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { AuthenticatedRequest, requireRoles } from "../middlewares/auth.middleware";
import { requireOrganizationPermission } from "../middlewares/organization-permission.middleware";
import { requireOrganizationScope } from "../middlewares/organization-scope";
import * as repo from "../repositories/investor.repository";

const r = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => { try { await handler(req, res); } catch (error) { next(error); } };
const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
const org = (req: Request) => requireOrganizationScope(req as AuthenticatedRequest);
const id = (req: Request, name = "id") => z.guid().parse(req.params[name]);
const readers = requireRoles("company_admin", "company_owner", "company_investor"), manage = requireOrganizationPermission("recycling.finance.manage");

const optionalText = z.string().trim().max(500).optional().transform(value => value || undefined);
const investor = {
  displayName: z.string().trim().min(2).max(160),
  sharePercent: z.number().min(0).max(100).optional(),
  userId: z.union([z.guid(), z.literal("")]).optional().transform(value => value || undefined),
  notes: optionalText,
};
export const investorSchema = z.object(investor);
export const investorUpdateSchema = z.object({ ...investor, active: z.boolean().default(true) });
const amountUgx = z.number().int().positive().max(100000000000);
const entry = {
  transactionDate: z.string().date(),
  reference: z.string().trim().min(2).max(120),
  movesCash: z.boolean().default(true),
  notes: optionalText,
};
export const transactionSchema = z.object({ ...entry, transactionType: z.enum(["investment", "payout"]), amountUgx });
export const distributionSchema = z.object({ ...entry, totalUgx: amountUgx });
export const reversalSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export const updateSchema = z.object({ title: z.string().trim().min(3).max(160), body: z.string().trim().min(3).max(4000) });

// An investor sees only their own position; the owner and the administrator see everyone's.
r.get("/recycling/investor-overview", readers, run(async (req, res) => {
  const { roles, userId } = auth(req), ownOnly = !roles.some(role => ["company_admin", "company_owner"].includes(role));
  res.setHeader("Cache-Control", "no-store");
  return res.json({ success: true, message: "Investor overview fetched", data: await repo.investorOverview(org(req), ownOnly ? userId : null) });
}));
r.get("/recycling/investors", manage, run(async (req, res) => res.json({ success: true, message: "Investors fetched", data: await repo.investorManagement(org(req)) })));
r.post("/recycling/investors", manage, run(async (req, res) => res.status(201).json({ success: true, message: "Investor added", data: await repo.createInvestor(org(req), auth(req).userId, investorSchema.parse(req.body)) })));
r.patch("/recycling/investors/:id", manage, run(async (req, res) => {
  const data = await repo.updateInvestor(org(req), id(req), investorUpdateSchema.parse(req.body));
  return data ? res.json({ success: true, message: "Investor updated", data }) : res.status(404).json({ success: false, message: "Investor not found" });
}));
r.post("/recycling/investors/:id/transactions", manage, run(async (req, res) => {
  const input = transactionSchema.parse(req.body), data = await repo.recordInvestorTransaction(org(req), auth(req).userId, id(req), input);
  return data ? res.status(201).json({ success: true, message: input.transactionType === "investment" ? "Investment recorded" : "Payout recorded", data }) : res.status(404).json({ success: false, message: "Investor not found" });
}));
r.post("/recycling/investor-transactions/:id/reverse", manage, run(async (req, res) => {
  const data = await repo.reverseInvestorTransaction(org(req), auth(req).userId, id(req), reversalSchema.parse(req.body).reason);
  return data ? res.json({ success: true, message: "Entry cancelled", data }) : res.status(404).json({ success: false, message: "Entry not found" });
}));
r.post("/recycling/investor-distributions", manage, run(async (req, res) => {
  const data = await repo.distributeToInvestors(org(req), auth(req).userId, distributionSchema.parse(req.body));
  return res.status(201).json({ success: true, message: `UGX ${data.paidUgx.toLocaleString("en-GB")} paid to ${data.investors} investor${data.investors === 1 ? "" : "s"}`, data });
}));
r.post("/recycling/investor-updates", manage, run(async (req, res) => res.status(201).json({ success: true, message: "Update posted to investors", data: await repo.createInvestorUpdate(org(req), auth(req).userId, updateSchema.parse(req.body)) })));
r.delete("/recycling/investor-updates/:id", manage, run(async (req, res) => (await repo.deleteInvestorUpdate(org(req), id(req))) ? res.json({ success: true, message: "Update removed" }) : res.status(404).json({ success: false, message: "Update not found" })));
export default r;
