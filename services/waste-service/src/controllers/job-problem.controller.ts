import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import {
  createDriverJobProblem,
  findDriverJobProblems,
  updateDriverJobProblem,
} from "../repositories/job-problem.repository";
import {
  createJobProblemSchema,
  updateJobProblemSchema,
} from "../validators/job-problem.validator";

function auth(req: Request) {
  return (req as AuthenticatedRequest).auth!;
}

export async function createJobProblemHandler(req: Request, res: Response) {
  const input = createJobProblemSchema.parse(req.body);
  const problem = await createDriverJobProblem(
    req.params.jobId as string,
    auth(req).userId,
    input.category,
    input.description
  );
  if (!problem) return res.status(404).json({ success: false, message: "Active assigned job not found" });
  return res.status(201).json({ success: true, message: "Problem reported", data: problem });
}

export async function getJobProblemsHandler(req: Request, res: Response) {
  const identity = auth(req);
  const isDriver = identity.roles.includes("driver");
  const organizationId = identity.roles.some((role) => ["company_admin", "supervisor"].includes(role)) ? identity.organizationId : null;
  const problems = await findDriverJobProblems(organizationId, isDriver ? identity.userId : null);
  return res.status(200).json({ success: true, message: "Job problems fetched", data: problems });
}

export async function updateJobProblemHandler(req: Request, res: Response) {
  const input = updateJobProblemSchema.parse(req.body);
  const identity = auth(req);
  const organizationId = identity.roles.some((role) => ["company_admin", "supervisor"].includes(role)) ? identity.organizationId : null;
  const problem = await updateDriverJobProblem(
    req.params.problemId as string,
    organizationId,
    input.status,
    input.resolutionNotes
  );
  if (!problem) return res.status(404).json({ success: false, message: "Problem not found in your scope" });
  return res.status(200).json({ success: true, message: "Problem updated", data: problem });
}
