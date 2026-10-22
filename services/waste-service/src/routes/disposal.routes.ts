import { NextFunction, Request, Response, Router } from "express";
import * as c from "../controllers/disposal.controller";
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
const company = requireRoles("company_admin", "supervisor");
const kcca = requireRoles("kcca_admin", "system_admin");

r.get("/disposal/facilities", requireRoles("kcca_admin", "system_admin", "weighbridge_operator", "company_admin", "supervisor"), run(c.getFacilities));
r.put("/disposal/facilities", kcca, run(c.putFacility));

r.get("/disposal/summary", company, run(c.getCompanySummary));
r.get("/disposal/trips", company, run(c.getCompanyTrips));
r.get("/disposal/tickets", company, run(c.getCompanyTickets));
r.post("/disposal/trips/:tripId/explanation", company, run(c.postExplanation));
r.patch("/disposal/tickets/:id/link", company, run(c.patchLinkTicket));

r.get("/disposal/city", kcca, run(c.getCityOverview));
r.get("/disposal/city/trips", kcca, run(c.getCityTrips));
r.get("/disposal/city/tickets", kcca, run(c.getCityTickets));
r.get("/disposal/explanations", kcca, run(c.getExplanations));
r.patch("/disposal/explanations/:id/review", requireRoles("kcca_admin"), run(c.patchReviewExplanation));
r.patch("/disposal/tickets/:id/accept-without-trip", requireRoles("kcca_admin"), run(c.patchAcceptWithoutTrip));

export default r;
