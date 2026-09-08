import { NextFunction, Request, Response, Router } from "express";
import {
  createJobProblemHandler,
  getJobProblemsHandler,
  updateJobProblemHandler,
} from "../controllers/job-problem.controller";
import { requireRoles } from "../middlewares/auth.middleware";

const router = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try { await handler(req, res); } catch (error) { next(error); }
  };

router.get("/driver-job-problems", requireRoles("driver", "company_admin", "supervisor", "kcca_admin", "system_admin"), run(getJobProblemsHandler));
router.post("/driver-jobs/:jobId/problems", requireRoles("driver"), run(createJobProblemHandler));
router.patch("/driver-job-problems/:problemId", requireRoles("company_admin", "supervisor", "kcca_admin", "system_admin"), run(updateJobProblemHandler));

export default router;
