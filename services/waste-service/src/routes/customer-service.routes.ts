import { NextFunction, Request, Response, Router } from "express";
import {
  getCustomersHandler,
  getMyCustomerServiceHandler,
  upsertMyCustomerServiceHandler,
  updateCustomerServiceStatusHandler,
} from "../controllers/customer-service.controller";
import { requireRoles } from "../middlewares/auth.middleware";
import { requireOrganizationPermission } from "../middlewares/organization-permission.middleware";

const router = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { await handler(req, res); } catch (error) { next(error); }
  };

router.get("/customer-service/me", requireRoles("citizen"), run(getMyCustomerServiceHandler));
router.put("/customer-service/me", requireRoles("citizen"), run(upsertMyCustomerServiceHandler));
router.get("/customers", requireOrganizationPermission("customers.read"), run(getCustomersHandler));
router.patch("/customers/:customerId/status", requireOrganizationPermission("customers.manage"), run(updateCustomerServiceStatusHandler));

export default router;
