import { requireOrganizationScope } from "../middlewares/organization-scope";
import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import {
  findCustomerServiceOverview,
  findCustomers,
  upsertCustomerService,
  updateCustomerServiceStatus,
} from "../repositories/customer-service.repository";
import { updateCustomerServiceStatusSchema, upsertCustomerServiceSchema } from "../validators/customer-service.validator";

function identity(req: Request) { return (req as AuthenticatedRequest).auth!; }

export async function upsertMyCustomerServiceHandler(req: Request, res: Response) {
  const result = await upsertCustomerService(identity(req).userId, upsertCustomerServiceSchema.parse(req.body));
  return res.status(200).json({ success: true, message: "Customer service location saved", data: result });
}

export async function getMyCustomerServiceHandler(req: Request, res: Response) {
  const overview = await findCustomerServiceOverview(identity(req).userId);
  return res.status(200).json({ success: true, message: "Customer service overview fetched", data: overview });
}

export async function getCustomersHandler(req: Request, res: Response) {
  const organizationId = requireOrganizationScope(req);
  const customers = await findCustomers(organizationId);
  return res.status(200).json({ success: true, message: "Customers fetched", data: customers });
}

export async function updateCustomerServiceStatusHandler(req: Request, res: Response) {
  const auth = identity(req);
  if (!auth.organizationId) return res.status(403).json({ success: false, message: "Your account is not linked to an organization" });
  const input = updateCustomerServiceStatusSchema.parse(req.body);
  const customer = await updateCustomerServiceStatus(req.params.customerId as string, auth.organizationId, input.status);
  if (!customer) return res.status(404).json({ success: false, message: "Customer was not found in your organization" });
  return res.status(200).json({ success: true, message: `Customer service ${input.status}`, data: customer });
}
