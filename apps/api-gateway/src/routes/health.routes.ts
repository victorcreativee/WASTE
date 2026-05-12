import { Router, Request, Response, NextFunction } from "express";
import { healthCheck } from "../controllers/health.controller";

const router = Router();

router.get(
  "/health",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await healthCheck(req, res);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
