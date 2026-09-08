import { NextFunction, Request, Response, Router } from "express";
import {
  getCustomersHandler,
  getMyCustomerServiceHandler,
  upsertMyCustomerServiceHandler,
  updateCustomerServiceStatusHandler,
} from "../controllers/customer-service.controller";
import { requireRoles } from "../middlewares/auth.middleware";

const router = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { await handler(req, res); } catch (error) { next(error); }
  };

router.get("/customer-service/me", requireRoles("citizen"), run(getMyCustomerServiceHandler));
router.put("/customer-service/me", requireRoles("citizen"), run(upsertMyCustomerServiceHandler));
router.get("/customers", requireRoles("company_admin", "supervisor"), run(getCustomersHandler));
router.patch("/customers/:customerId/status", requireRoles("company_admin"), run(updateCustomerServiceStatusHandler));

export default router;
