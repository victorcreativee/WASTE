import { NextFunction, Request, Response, Router } from "express";
import * as c from "../controllers/penalty.controller";
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
const view = requireRoles("kcca_admin", "system_admin", "company_admin");
const kcca = requireRoles("kcca_admin", "system_admin");
const decide = requireRoles("kcca_admin");
const company = requireRoles("company_admin");

r.get("/penalties/schedule", requireRoles("kcca_admin", "system_admin", "company_admin", "supervisor"), run(c.getSchedule));
r.put("/penalties/schedule/:code", decide, run(c.putScheduleItem));
r.get("/penalties/overview", kcca, run(c.getOverview));
r.get("/penalties/company/summary", company, run(c.getCompanySummary));
r.get("/penalties/notices", view, run(c.getNotices));
r.post("/penalties/notices", decide, run(c.postNotice));
r.get("/penalties/notices/:id", view, run(c.getNotice));
r.post("/penalties/notices/:id/appeal", company, run(c.postAppeal));
r.post("/penalties/notices/:id/payment", company, run(c.postPayment));
r.patch("/penalties/notices/:id/confirm-payment", decide, run(c.patchConfirmPayment));
r.patch("/penalties/notices/:id/reject-payment", decide, run(c.patchRejectPayment));
r.patch("/penalties/notices/:id/decide-appeal", decide, run(c.patchDecideAppeal));
r.patch("/penalties/notices/:id/withdraw", decide, run(c.patchWithdraw));
r.patch("/penalties/notices/:id/escalate", decide, run(c.patchEscalate));

export default r;
