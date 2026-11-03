import { NextFunction, Request, Response, Router } from "express";
import * as c from "../controllers/open-api.controller";
import { requireRoles } from "../middlewares/auth.middleware";
import { apiError, requireApiKey, requireScope } from "../middlewares/api-key.middleware";

const run = (handler: (req: Request, res: Response) => unknown) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };

// Key management, under /api/waste for signed-in administrators.
const r = Router();
const managers = requireRoles("company_admin", "kcca_admin", "system_admin");
r.get("/api-keys", managers, run(c.getKeys));
r.post("/api-keys", requireRoles("company_admin", "kcca_admin"), run(c.postKey));
r.post("/api-keys/:id/revoke", managers, run(c.postRevoke));
r.get("/api-keys/:id/usage", managers, run(c.getUsage));

// The open API itself, mounted at /api/v1. Read-only.
export const openApiRoutes = Router();
openApiRoutes.get("/openapi.json", run(c.getSpec));
openApiRoutes.use(requireApiKey);
openApiRoutes.get("/me", run(c.getMe));
openApiRoutes.get("/operators", requireScope("operators:read"), run(c.getOperators));
openApiRoutes.get("/tonnage", requireScope("tonnage:read"), run(c.getTonnage));
openApiRoutes.get("/load-certificates", requireScope("certificates:read"), run(c.getCertificates));
openApiRoutes.get("/carbon-baseline", requireScope("carbon:read"), run(c.getCarbonBaseline));
openApiRoutes.get("/receipts", requireScope("receipts:read"), run(c.getReceipts));
openApiRoutes.use((_req: Request, res: Response) => apiError(res, 404, "not_found", "No such endpoint. See /api/v1/openapi.json."));
openApiRoutes.use(c.apiErrors);

export default r;
