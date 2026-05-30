import { Router, Request, Response, NextFunction } from "express";
import {
  createOrganizationHandler,
  getOrganizationById,
  getOrganizations,
} from "../controllers/organization.controller";

const router = Router();

router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getOrganizations(req, res);
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getOrganizationById(req, res);
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await createOrganizationHandler(req, res);
  } catch (error) {
    next(error);
  }
});

export default router;
