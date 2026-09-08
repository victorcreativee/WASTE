import { NextFunction, Request, Response, Router } from "express";

import { getRoutingStatusHandler } from "../controllers/routing.controller";

const router = Router();

router.get(
  "/status",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await getRoutingStatusHandler(req, res);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
