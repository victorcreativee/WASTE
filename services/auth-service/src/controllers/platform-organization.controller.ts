import { Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { deleteOrganizationBusinessDay, organizationBusinessDayPreview, organizationResetPreview, resetOrganization } from "../repositories/platform-organization.repository";
import { deleteOrganizationBusinessDaySchema, resetOrganizationSchema } from "../validators/platform-organization.validator";

export async function getOrganizationResetPreview(req: AuthenticatedRequest, res: Response) {
  return res.json({ success: true, message: "Organization reset preview fetched", data: await organizationResetPreview(req.params.id as string) });
}

export async function postOrganizationReset(req: AuthenticatedRequest, res: Response) {
  const data = await resetOrganization(req.user!.userId, req.params.id as string, resetOrganizationSchema.parse(req.body));
  return res.json({ success: true, message: data.mode === "data_only" ? "Company operational data reset" : "Company data and credentials reset", data });
}

export async function getOrganizationBusinessDayPreview(req: AuthenticatedRequest, res: Response) {
  const operatingDate = String(req.query.operatingDate || "");
  const data = await organizationBusinessDayPreview(req.params.id as string, operatingDate);
  return res.json({ success: true, message: "Business day deletion preview fetched", data });
}

export async function deleteOrganizationBusinessDayRecords(req: AuthenticatedRequest, res: Response) {
  const input = deleteOrganizationBusinessDaySchema.parse(req.body);
  const data = await deleteOrganizationBusinessDay(req.user!.userId, req.params.id as string, input);
  return res.json({ success: true, message: "Company business-day transactions deleted", data });
}
