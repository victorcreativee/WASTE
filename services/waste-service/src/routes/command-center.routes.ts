import { NextFunction, Request, Response, Router } from "express";
import { getCommandCenterSummaryHandler } from "../controllers/command-center.controller";

const router = Router();
router.get("/command-center/summary", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getCommandCenterSummaryHandler(req, res);
  } catch (error) {
    next(error);
  }
});
export default router;
