import {
  assignCitizenIssue,
  CitizenIssueScope,
  createCitizenIssue,
  findCitizenIssueById,
  findCitizenIssues,
  updateCitizenIssueStatus,
} from "../repositories/citizen-issue.repository";
import {
  CreateCitizenIssueInput,
  UpdateCitizenIssueStatusInput,
} from "../validators/citizen-issue.validator";

export function listCitizenIssues(scope: CitizenIssueScope) {
  return findCitizenIssues(scope);
}

export function submitCitizenIssue(userId: string, input: CreateCitizenIssueInput) {
  return createCitizenIssue(userId, input);
}

export async function assignIssue(
  id: string,
  organizationId: string,
  scope: CitizenIssueScope
) {
  const updated = await assignCitizenIssue(id, organizationId);
  return updated ? findCitizenIssueById(id, scope) : null;
}

export async function changeIssueStatus(
  id: string,
  input: UpdateCitizenIssueStatusInput,
  scope: CitizenIssueScope
) {
  const organizationId = scope.isCompany ? scope.organizationId : null;
  const updated = await updateCitizenIssueStatus(id, input, organizationId);
  return updated ? findCitizenIssueById(id, scope) : null;
}
