import { NextFunction, Request, Response, Router } from "express";
import * as c from "../controllers/landfill.controller";
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
const readers = requireRoles("company_admin", "supervisor", "kcca_admin", "system_admin", "weighbridge_operator");
const kcca = requireRoles("kcca_admin");

r.get("/landfill/streams", readers, run(c.getStreams));
r.get("/landfill/overview", readers, run(c.getOverview));
r.get("/landfill/loads", readers, run(c.getLoads));
r.put("/landfill/loads/:ticketId/composition", requireRoles("weighbridge_operator", "kcca_admin"), run(c.putComposition));
r.get("/landfill/certificates/:id/pdf", readers, run(c.getCertificatePdf));
r.get("/landfill/baseline/export", requireRoles("company_admin", "kcca_admin", "system_admin"), run(c.exportBaseline));
r.post("/landfill/factors", kcca, run(c.postFactors));
r.post("/landfill/baseline/refresh", kcca, run(c.postRefresh));

export const landfillPublicRoutes = Router();
landfillPublicRoutes.get("/load-certificates/:code", run(c.getPublicCertificate));

export default r;
