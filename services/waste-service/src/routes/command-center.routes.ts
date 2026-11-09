import { NextFunction, Request, Response, Router } from "express";
import {
  getCityCommandCenterHandler,
  getCommandCenterSummaryHandler,
  getServiceStandardsHandler,
  putServiceStandardsHandler,
} from "../controllers/command-center.controller";
import { AuthenticatedRequest, requireRoles } from "../middlewares/auth.middleware";
import { pendingRequests } from "../repositories/request-queue.repository";

const router = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };

router.get("/command-center/summary", run(getCommandCenterSummaryHandler));
router.get("/command-center/city", requireRoles("kcca_admin", "system_admin"), run(getCityCommandCenterHandler));
router.get("/command-center/standards", requireRoles("kcca_admin", "system_admin"), run(getServiceStandardsHandler));
// Only KCCA sets city service standards; system administrators can view them.
router.put("/command-center/standards", requireRoles("kcca_admin"), run(putServiceStandardsHandler));
// Requests waiting on a city administrator (company sign-ups, permits, appeals, explanations, ...), for the dashboard.
router.get("/command-center/requests", requireRoles("kcca_admin", "system_admin"), run(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ success: true, message: "Waiting requests fetched", data: await pendingRequests((req as AuthenticatedRequest).auth!.roles) });
}));
export default router;
