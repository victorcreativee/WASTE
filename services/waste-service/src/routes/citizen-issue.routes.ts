import { NextFunction, Request, Response, Router } from "express";
import {
  assignCitizenIssueHandler,
  createCitizenIssueHandler,
  getCitizenIssues,
  updateCitizenIssueStatusHandler,
} from "../controllers/citizen-issue.controller";
import { requireRoles } from "../middlewares/auth.middleware";

const router = Router();
const canView = requireRoles("system_admin", "kcca_admin", "company_admin", "supervisor", "citizen");

router.get("/citizen-issues", canView, run(getCitizenIssues));
router.post("/citizen-issues", requireRoles("citizen"), run(createCitizenIssueHandler));
router.patch(
  "/citizen-issues/:id/assign",
  requireRoles("system_admin", "kcca_admin"),
  run(assignCitizenIssueHandler)
);
router.patch(
  "/citizen-issues/:id/status",
  requireRoles("system_admin", "kcca_admin", "company_admin", "supervisor"),
  run(updateCitizenIssueStatusHandler)
);

function run(handler: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

export default router;
