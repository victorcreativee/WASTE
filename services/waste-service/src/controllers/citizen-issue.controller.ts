import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { CitizenIssueScope } from "../repositories/citizen-issue.repository";
import {
  assignIssue,
  changeIssueStatus,
  listCitizenIssues,
  submitCitizenIssue,
} from "../services/citizen-issue.service";
import {
  assignCitizenIssueSchema,
  createCitizenIssueSchema,
  updateCitizenIssueStatusSchema,
} from "../validators/citizen-issue.validator";

function getScope(req: Request): CitizenIssueScope {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw new Error("Unauthorized");
  return {
    userId: auth.userId,
    organizationId: auth.organizationId,
    isCitizen: auth.roles.includes("citizen"),
    isCompany: auth.roles.some((role) => ["company_admin", "supervisor"].includes(role)),
  };
}

export async function getCitizenIssues(req: Request, res: Response) {
  const issues = await listCitizenIssues(getScope(req));
  return res.status(200).json({ success: true, message: "Citizen issues fetched successfully", data: issues });
}

export async function createCitizenIssueHandler(req: Request, res: Response) {
  const scope = getScope(req);
  const input = createCitizenIssueSchema.parse(req.body);
  const issue = await submitCitizenIssue(scope.userId, input);
  return res.status(201).json({ success: true, message: "Issue submitted successfully", data: issue });
}

export async function assignCitizenIssueHandler(req: Request, res: Response) {
  const input = assignCitizenIssueSchema.parse(req.body);
  const issue = await assignIssue(req.params.id as string, input.organizationId, getScope(req));
  if (!issue) return res.status(404).json({ success: false, message: "Issue or active company not found" });
  return res.status(200).json({ success: true, message: "Issue assigned successfully", data: issue });
}

export async function updateCitizenIssueStatusHandler(req: Request, res: Response) {
  const scope = getScope(req);
  const input = updateCitizenIssueStatusSchema.parse(req.body);
  if (scope.isCompany && !["in_progress", "resolved"].includes(input.status)) {
    return res.status(403).json({ success: false, message: "Companies may only start or resolve assigned issues" });
  }
  const issue = await changeIssueStatus(req.params.id as string, input, scope);
  if (!issue) return res.status(404).json({ success: false, message: "Issue not found in your scope" });
  return res.status(200).json({ success: true, message: "Issue status updated successfully", data: issue });
}
