import { Router, Request, Response, NextFunction } from "express";
import { login, me, register } from "../controllers/auth.controller";
import { requireAuth } from "../middlewares/auth.middleware";

const router = Router();

router.post(
  "/register",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await register(req, res);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/login",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await login(req, res);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/me",
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await me(req, res);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
