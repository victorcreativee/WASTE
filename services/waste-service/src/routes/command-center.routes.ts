import { NextFunction, Request, Response, Router } from "express";
import {
  getCityCommandCenterHandler,
  getCommandCenterSummaryHandler,
  getServiceStandardsHandler,
  putServiceStandardsHandler,
} from "../controllers/command-center.controller";
import { requireRoles } from "../middlewares/auth.middleware";

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
export default router;
