import { NextFunction, Request, Response, Router } from "express";
import * as c from "../controllers/privacy.controller";
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
const kcca = requireRoles("kcca_admin");
const holders = requireRoles("company_admin", "kcca_admin");

r.get("/privacy/gps/notice", run(c.getNotice));
r.get("/privacy/gps/mine", requireRoles("driver"), run(c.getMine));
r.post("/privacy/gps/consent", requireRoles("driver"), run(c.postConsent));
r.get("/privacy/gps/mine/export", requireRoles("driver"), run(c.exportMine));
r.get("/privacy/gps/overview", requireRoles("company_admin", "supervisor", "kcca_admin", "system_admin"), run(c.getOverview));
r.put("/privacy/gps/retention", kcca, run(c.putRetention));
r.post("/privacy/gps/notices", kcca, run(c.postNotice));
r.post("/privacy/gps/retention/run", kcca, run(c.postRunRetention));
r.post("/privacy/gps/holds", holders, run(c.postHold));
r.post("/privacy/gps/holds/:id/release", holders, run(c.postRelease));

export default r;
