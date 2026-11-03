import { NextFunction, Request, Response, Router } from "express";
import * as c from "../controllers/tariff.controller";
import { requireRoles } from "../middlewares/auth.middleware";

const r = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => handler(req, res).catch(next);
const kcca = requireRoles("kcca_admin");

r.get("/tariffs", run(c.getTariffs));
r.get("/tariffs/:id/rates", requireRoles("kcca_admin", "system_admin", "company_admin", "supervisor"), run(c.getTariffRates));
r.post("/tariffs", kcca, run(c.postTariffBand));
r.put("/tariffs/:id", kcca, run(c.putTariffBand));
r.post("/tariffs/:id/rates", kcca, run(c.postTariffRate));
r.delete("/tariffs/:id/rates/:rateId", kcca, run(c.deleteTariffRate));

export default r;
