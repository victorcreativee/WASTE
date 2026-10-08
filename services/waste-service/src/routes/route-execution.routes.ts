import { NextFunction, Request, Response, Router } from "express";
import {
  arriveAtRouteStopHandler,
  cancelCollectionRouteHandler,
  completeRouteStopHandler,
  dispatchCollectionRouteHandler,
  getDriverDashboardHandler,
  getDriverRouteDetailsHandler,
  getDriverRoutesHandler,
  startDriverRouteHandler,
} from "../controllers/route-execution.controller";
import { requireRoles } from "../middlewares/auth.middleware";

const router = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
  try { await handler(req, res); } catch (error) { next(error); }
};
const canMonitor = requireRoles("driver", "company_admin", "supervisor", "kcca_admin", "system_admin");

router.get("/driver/routes", canMonitor, run(getDriverRoutesHandler));
router.get("/driver/dashboard", requireRoles("driver"), run(getDriverDashboardHandler));
router.get("/drivers/:driverId/routes", canMonitor, run(getDriverRoutesHandler));
router.get("/driver-routes/:routeId", canMonitor, run(getDriverRouteDetailsHandler));
router.patch("/collection-routes/:routeId/dispatch", requireRoles("company_admin", "supervisor"), run(dispatchCollectionRouteHandler));
router.patch("/collection-routes/:routeId/cancel", requireRoles("company_admin", "supervisor"), run(cancelCollectionRouteHandler));
router.patch("/driver-routes/:routeId/start", requireRoles("driver"), run(startDriverRouteHandler));
router.patch("/driver-route-stops/:stopId/arrive", requireRoles("driver"), run(arriveAtRouteStopHandler));
router.patch("/driver-route-stops/:stopId/complete", requireRoles("driver"), run(completeRouteStopHandler));

export default router;
