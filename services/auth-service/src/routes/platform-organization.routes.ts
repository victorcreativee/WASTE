import { NextFunction, Response, Router } from "express";
import { AuthenticatedRequest, requireAuth, requireRoles } from "../middlewares/auth.middleware";
import { getOrganizationResetPreview, postOrganizationReset } from "../controllers/platform-organization.controller";

const router = Router();
const run = (handler: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) => async (req: AuthenticatedRequest, res: Response, next: NextFunction) => { try { await handler(req, res); } catch (error) { next(error); } };
router.use("/platform-organizations", requireAuth, requireRoles("system_admin"));
router.get("/platform-organizations/:id/reset-preview", run(getOrganizationResetPreview));
router.post("/platform-organizations/:id/reset", run(postOrganizationReset));

export default router;
