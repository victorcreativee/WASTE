import { NextFunction, Request, Response, Router } from "express";
import { getCityReportById, getCityReportCsv, getCityReports, getLiveReport, getLiveReportCsv, postCityReport } from "../controllers/city-report.controller";
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

r.get("/city-reports/live", kcca, run(getLiveReport));
r.get("/city-reports/live/export.csv", kcca, run(getLiveReportCsv));
r.get("/city-reports", kcca, run(getCityReports));
r.post("/city-reports", requireRoles("kcca_admin"), run(postCityReport));
r.get("/city-reports/:id", kcca, run(getCityReportById));
r.get("/city-reports/:id/export.csv", kcca, run(getCityReportCsv));

export default r;
