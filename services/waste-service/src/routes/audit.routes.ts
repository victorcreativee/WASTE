import { NextFunction, Request, Response, Router } from "express";
import * as c from "../controllers/audit.controller";
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
const readers = requireRoles("company_admin", "kcca_admin", "system_admin");

r.get("/audit", readers, run(c.getAuditLog));
r.get("/audit/filters", readers, run(c.getAuditFilters));
r.get("/audit/isolation", requireRoles("kcca_admin", "system_admin"), run(c.getIsolationStatus));
r.get("/audit/:id", readers, run(c.getAuditEntry));

export default r;
