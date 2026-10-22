import { NextFunction, Request, Response, Router } from "express";
import * as c from "../controllers/dumping.controller";
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
const everyone = requireRoles("kcca_admin", "system_admin", "company_admin", "supervisor", "citizen");
const kcca = requireRoles("kcca_admin", "system_admin");
const decide = requireRoles("kcca_admin");
const company = requireRoles("company_admin", "supervisor");

r.get("/dumping/divisions", everyone, run(c.getDivisions));
r.post("/dumping/reports", requireRoles("kcca_admin", "company_admin", "supervisor", "citizen"), run(c.postReport));
r.get("/dumping/my-reports", everyone, run(c.getMyReports));
r.get("/dumping/overview", kcca, run(c.getCityOverview));
r.get("/dumping/sites", kcca, run(c.getSites));
r.get("/dumping/company/overview", company, run(c.getCompanyOverview));
r.get("/dumping/company/sites", company, run(c.getCompanySites));
r.get("/dumping/sites/:id", everyone, run(c.getSite));
r.get("/dumping/photos/:id", everyone, run(c.getPhoto));
r.patch("/dumping/sites/:id/verify", decide, run(c.patchVerify));
r.patch("/dumping/sites/:id/dismiss", decide, run(c.patchDismiss));
r.patch("/dumping/sites/:id/responsibility", decide, run(c.patchResponsibility));
r.patch("/dumping/sites/:id/order-cleanup", decide, run(c.patchOrderCleanup));
r.patch("/dumping/sites/:id/confirm", decide, run(c.patchConfirm));
r.patch("/dumping/sites/:id/reject-cleanup", decide, run(c.patchReject));
r.patch("/dumping/sites/:id/cleanup-report", company, run(c.patchCleanupReport));

export default r;
