import { Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import {
  createOrganizationUser,
  listOrganizationUsers,
  changeOrganizationUserStatus,
  assignDriversToSupervisor,
  createOrganizationCustomer,
} from "../services/organization-user.service";
import {
  createOrganizationUserSchema,
  updateOrganizationUserStatusSchema,
  assignSupervisorDriversSchema,
  createOrganizationCustomerSchema,
} from "../validators/auth.validator";

function organizationId(req: AuthenticatedRequest) {
  const id = req.user?.organizationId;
  if (!id) {
    const error = new Error("Your account is not linked to an organization") as Error & { statusCode?: number };
    error.statusCode = 403;
    throw error;
  }
  return id;
}

export async function assignSupervisorDriversHandler(req: AuthenticatedRequest, res: Response) {
  const input = assignSupervisorDriversSchema.parse(req.body);
  const assignment = await assignDriversToSupervisor(
    req.params.supervisorUserId as string,
    input.driverIds,
    organizationId(req), req.user!.userId
  );
  if (!assignment) return res.status(400).json({ success: false, message: "Select a valid active supervisor and drivers from your organization" });
  return res.status(200).json({ success: true, message: "Supervisor team updated", data: assignment });
}

export async function getOrganizationUsersHandler(req: AuthenticatedRequest, res: Response) {
  const users = await listOrganizationUsers(organizationId(req));
  return res.status(200).json({ success: true, message: "Organization staff fetched", data: users });
}

export async function createOrganizationUserHandler(req: AuthenticatedRequest, res: Response) {
  const user = await createOrganizationUser(organizationId(req), createOrganizationUserSchema.parse(req.body), req.user!.userId);
  return res.status(201).json({ success: true, message: user.verificationEmailSent ? "Staff account created. The user must verify their email before signing in." : "Staff account created, but the verification email could not be delivered. Check email delivery settings and resend it.", data: user });
}

export async function createOrganizationCustomerHandler(req: AuthenticatedRequest, res: Response) {
  const customer = await createOrganizationCustomer(
    organizationId(req), createOrganizationCustomerSchema.parse(req.body), req.user!.userId
  );
  return res.status(201).json({ success: true, message: customer.verificationRequired ? (customer.verificationEmailSent ? "Customer account created. The customer must verify their email before signing in." : "Customer account created, but its verification email could not be delivered.") : "Customer account and service location created", data: customer });
}

export async function updateOrganizationUserStatusHandler(req: AuthenticatedRequest, res: Response) {
  const input = updateOrganizationUserStatusSchema.parse(req.body);
  const user = await changeOrganizationUserStatus(req.params.userId as string, organizationId(req), input.status, req.user!.userId);
  if (!user) return res.status(404).json({ success: false, message: "Staff account not found or cannot be changed" });
  return res.status(200).json({ success: true, message: "Staff status updated", data: user });
}
