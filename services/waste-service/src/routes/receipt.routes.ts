import { NextFunction, Request, Response, Router } from "express";
import * as c from "../controllers/receipt.controller";
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
const company = requireRoles("company_admin", "supervisor");
const kcca = requireRoles("kcca_admin", "system_admin");

r.get("/receipts", requireRoles("company_admin", "supervisor", "citizen", "kcca_admin", "system_admin"), run(c.getReceipts));
r.get("/receipts/summary", company, run(c.getReceiptSummary));
r.get("/receipts/chain-check", company, run(c.getOwnChainCheck));
r.post("/receipts/:id/void", requireRoles("company_admin"), run(c.postReceiptVoid));
r.get("/receipts/exports", requireRoles("company_admin", "supervisor", "kcca_admin", "system_admin"), run(c.getExports));
r.get("/receipts/exports/:id/download", requireRoles("company_admin", "supervisor", "kcca_admin", "system_admin"), run(c.downloadExport));

r.get("/receipts/city/operators", kcca, run(c.getCityOperators));
r.get("/receipts/city/operators/:organizationId/chain-check", kcca, run(c.getOperatorChainCheck));
r.put("/receipts/city/operators/:organizationId/code", kcca, run(c.putOperatorCode));
r.get("/receipts/settings", kcca, run(c.getSettings));
r.put("/receipts/settings", requireRoles("kcca_admin"), run(c.putSettings));

export default r;
