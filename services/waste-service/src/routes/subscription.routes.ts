import { NextFunction, Request, Response, Router } from "express";
import * as c from "../controllers/subscription.controller";
import { requireRoles } from "../middlewares/auth.middleware";

const r = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
const company = requireRoles("company_admin");
const platform = requireRoles("system_admin");

r.get("/subscription", company, run(c.getMine));
r.get("/subscription/invoices", company, run(c.getMyInvoices));
r.patch("/subscription/plan", company, run(c.patchPlan));
r.post("/subscription/cancel", company, run(c.postCancel));
r.post("/subscription/resume", company, run(c.postResume));
r.post("/subscription/invoices/:id/payment", company, run(c.postPayment));

r.get("/saas/overview", platform, run(c.getOverview));
r.get("/saas/plans", platform, run(c.getAllPlans));
r.put("/saas/plans/:code", platform, run(c.putPlan));
r.get("/saas/subscriptions", platform, run(c.getSubscriptions));
r.get("/saas/unsubscribed", platform, run(c.getUnsubscribed));
r.post("/saas/subscriptions", platform, run(c.postStart));
r.get("/saas/subscriptions/:organizationId", platform, run(c.getSubscription));
r.patch("/saas/subscriptions/:organizationId", platform, run(c.patchAction));
r.get("/saas/invoices", platform, run(c.getInvoices));
r.patch("/saas/invoices/:id/confirm", platform, run(c.patchConfirm));
r.patch("/saas/invoices/:id/reject-payment", platform, run(c.patchReject));
r.patch("/saas/invoices/:id/void", platform, run(c.patchVoid));
r.post("/saas/run-billing", platform, run(c.postRunBilling));

export default r;
