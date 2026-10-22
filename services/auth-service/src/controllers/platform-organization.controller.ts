import { Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { organizationResetPreview, resetOrganization } from "../repositories/platform-organization.repository";
import { resetOrganizationSchema } from "../validators/platform-organization.validator";

export async function getOrganizationResetPreview(req: AuthenticatedRequest, res: Response) {
  return res.json({ success: true, message: "Organization reset preview fetched", data: await organizationResetPreview(req.params.id as string) });
}

export async function postOrganizationReset(req: AuthenticatedRequest, res: Response) {
  const data = await resetOrganization(req.user!.userId, req.params.id as string, resetOrganizationSchema.parse(req.body));
  return res.json({ success: true, message: data.mode === "data_only" ? "Company operational data reset" : "Company data and credentials reset", data });
}
