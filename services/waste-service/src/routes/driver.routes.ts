import { NextFunction, Request, Response, Router } from "express";
import {
  completeDriverJobHandler,
  getDriverJobsHandler,
  startDriverJobHandler,
} from "../controllers/waste.controller";
import { requireRoles } from "../middlewares/auth.middleware";

const router = Router();
const canUseDriverOperations = requireRoles(
  "system_admin",
  "kcca_admin",
  "company_admin",
  "supervisor",
  "driver"
);

router.get("/drivers/:driverId/jobs", canUseDriverOperations, run(getDriverJobsHandler));
router.get("/driver/jobs", canUseDriverOperations, run(getDriverJobsHandler));
router.patch("/driver-jobs/:jobId/start", canUseDriverOperations, run(startDriverJobHandler));
router.patch("/driver-jobs/:jobId/complete", canUseDriverOperations, run(completeDriverJobHandler));

function run(handler: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

export default router;
