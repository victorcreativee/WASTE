import { NextFunction, Request, Response, Router } from "express";
import * as c from "../controllers/mobile-money.controller";
import { requireRoles } from "../middlewares/auth.middleware";
import { requireOrganizationPermission } from "../middlewares/organization-permission.middleware";

const r = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => handler(req, res).catch(next);
const admin = requireRoles("company_admin");
const confirm = requireOrganizationPermission("billing.payment.confirm");

r.get("/billing/mobile-money/accounts", admin, run(c.getAccounts));
r.put("/billing/mobile-money/accounts/:provider", admin, run(c.putAccount));
r.patch("/billing/mobile-money/accounts/:provider/status", admin, run(c.patchAccountStatus));
r.post("/billing/mobile-money/accounts/:provider/test", admin, run(c.postAccountTest));
r.get("/billing/mobile-money/reconciliation", confirm, run(c.getReconciliation));
r.get("/billing/mobile-money/statement", confirm, run(c.getStatement));
r.post("/billing/payments/:paymentId/check", confirm, run(c.postPaymentCheck));
r.post("/billing/payments/:paymentId/review", confirm, run(c.postReviewResolution));
r.get("/billing/payments/:paymentId", requireRoles("citizen"), run(c.getHouseholdPayment));

export const mobileMoneyPublicRoutes = Router();
mobileMoneyPublicRoutes.put("/payments/mtn/:paymentId", run(c.mtnCallback));
mobileMoneyPublicRoutes.post("/payments/mtn/:paymentId", run(c.mtnCallback));
mobileMoneyPublicRoutes.post("/payments/airtel", run(c.airtelCallback));

export default r;
