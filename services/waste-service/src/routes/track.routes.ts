import { NextFunction, Request, Response, Router } from "express";
import * as c from "../controllers/track.controller";
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
const view = requireRoles("kcca_admin", "system_admin", "company_admin", "supervisor");
const kcca = requireRoles("kcca_admin", "system_admin");

r.get("/tracks/facilities", requireRoles("kcca_admin", "system_admin", "weighbridge_operator"), run(c.getFacilities));
r.put("/tracks/facilities/:code/location", requireRoles("kcca_admin"), run(c.putFacilityLocation));
r.get("/tracks/overview", view, run(c.getOverview));
r.get("/tracks/checks", view, run(c.getChecks));
r.get("/tracks/checks/:tripId", view, run(c.getCheck));
r.post("/tracks/checks/:tripId/recheck", kcca, run(c.postRecheck));
r.post("/tracks/run", requireRoles("system_admin"), run(c.postRun));

export default r;
