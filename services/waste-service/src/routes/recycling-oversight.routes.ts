import { NextFunction, Request, Response, Router } from "express";
import { getCityOverview, getOverviewCsv, getRecyclerDetail } from "../controllers/recycling-oversight.controller";
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
const kcca = requireRoles("kcca_admin", "system_admin");

r.get("/recycling-oversight", kcca, run(getCityOverview));
r.get("/recycling-oversight/export.csv", kcca, run(getOverviewCsv));
r.get("/recycling-oversight/recyclers/:id", kcca, run(getRecyclerDetail));

export default r;
