import { Router, Request, Response, NextFunction } from "express";
import {
  createOrganizationHandler,
  getOrganizationById,
  getOrganizations,
} from "../controllers/organization.controller";
import { requireRoles } from "../middlewares/auth.middleware";

const router = Router();
const canReadOrganizations = requireRoles(
  "system_admin",
  "kcca_admin",
  "company_admin"
  , "supervisor"
  , "weighbridge_operator"
);
const canCreateOrganizations = requireRoles("system_admin");

router.get("/", canReadOrganizations, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getOrganizations(req, res);
  } catch (error) {
    next(error);
  }
});

router.get("/:id", canReadOrganizations, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getOrganizationById(req, res);
  } catch (error) {
    next(error);
  }
});

router.post("/", canCreateOrganizations, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await createOrganizationHandler(req, res);
  } catch (error) {
    next(error);
  }
});

export default router;
