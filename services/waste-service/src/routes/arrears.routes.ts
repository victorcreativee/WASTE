import { NextFunction, Request, Response, Router } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { requireOrganizationPermission } from "../middlewares/organization-permission.middleware";
import * as repo from "../repositories/arrears.repository";
import { arrearsListSchema, cancelPlanSchema, followUpSchema, idSchema, planSchema } from "../validators/arrears.validator";

// Arrears management (migration 117), under /billing so the billing package gate applies. Reading needs billing.read;
// recording follow-ups and plans needs billing.payment.record, the permission of staff who collect payments.
const r = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
const company = (req: Request) => {
  const id = auth(req).organizationId;
  if (!id) throw Object.assign(new Error("Arrears belong to a collection company account"), { statusCode: 403 });
  return id;
};
const read = requireOrganizationPermission("billing.read"), act = requireOrganizationPermission("billing.payment.record");
/** Spreadsheet programs run cells starting with these as formulas. */
const cell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

r.get("/billing/arrears/summary", read, run(async (req, res) =>
  res.json({ success: true, message: "Arrears summary", data: await repo.arrearsSummary(company(req)) })));
r.get("/billing/arrears", read, run(async (req, res) =>
  res.json({ success: true, message: "Households in arrears", data: await repo.listArrears(company(req), arrearsListSchema.parse(req.query)) })));
r.get("/billing/arrears/export", read, run(async (req, res) => {
  const rows = await repo.arrearsRows(company(req));
  const header = ["full_name", "phone", "location", "overdue_ugx", "days_1_30_ugx", "days_31_60_ugx", "days_61_90_ugx", "days_over_90_ugx",
    "oldest_due_on", "days_late", "last_paid_at", "last_outcome", "promised_on", "plan_progress"];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="arrears.csv"');
  return res.send([header.join(","), ...rows.map(row => header.map(key => cell((row as Record<string, unknown>)[key])).join(","))].join("\n"));
}));
r.get("/billing/arrears/customers/:customerId", read, run(async (req, res) =>
  res.json({ success: true, message: "Household arrears", data: await repo.customerArrears(company(req), idSchema.parse(req.params.customerId)) })));
r.post("/billing/arrears/customers/:customerId/follow-ups", act, run(async (req, res) => {
  const data = await repo.addFollowUp(company(req), idSchema.parse(req.params.customerId), followUpSchema.parse(req.body), auth(req).userId);
  return res.status(201).json({ success: true, message: "Follow-up recorded", data });
}));
r.post("/billing/arrears/customers/:customerId/plans", act, run(async (req, res) => {
  const data = await repo.createPlan(company(req), idSchema.parse(req.params.customerId), planSchema.parse(req.body), auth(req).userId);
  return res.status(201).json({ success: true, message: "Payment plan agreed. The household is not sent overdue reminders while it keeps to the plan.", data });
}));
r.post("/billing/arrears/plans/:planId/cancel", act, run(async (req, res) => {
  const { reason } = cancelPlanSchema.parse(req.body);
  return res.json({ success: true, message: "Payment plan cancelled", data: await repo.cancelPlan(company(req), idSchema.parse(req.params.planId), reason, auth(req).userId) });
}));

export default r;
