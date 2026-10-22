import { NextFunction, Request, Response, Router } from "express";
import {
  getBatches, getDispatches, getExpectedDeliveries, getFactoryDirectory, getIntakes, getOrganizationContext, getOverview,
  patchVoidIntake, postBatch, postDispatch, postIntake,
} from "../controllers/factory.controller";
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
const factoryStaff = requireRoles("company_admin", "supervisor");

r.get("/organization-context", run(getOrganizationContext));
r.get("/factories/directory", requireRoles("company_admin", "supervisor", "recycling_sales", "recycling_field_manager", "kcca_admin", "system_admin"), run(getFactoryDirectory));
r.get("/factory/overview", factoryStaff, run(getOverview));
r.get("/factory/expected-deliveries", factoryStaff, run(getExpectedDeliveries));
r.get("/factory/intakes", factoryStaff, run(getIntakes));
r.post("/factory/intakes", factoryStaff, run(postIntake));
r.patch("/factory/intakes/:id/void", requireRoles("company_admin"), run(patchVoidIntake));
r.get("/factory/batches", factoryStaff, run(getBatches));
r.post("/factory/batches", factoryStaff, run(postBatch));
r.get("/factory/dispatches", factoryStaff, run(getDispatches));
r.post("/factory/dispatches", factoryStaff, run(postDispatch));

export default r;
