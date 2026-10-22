import { operationalOrganizationScope } from "../middlewares/organization-scope";
import { Request, Response } from "express";
import { getCommandCenterSummary } from "../repositories/command-center.repository";
import { getCityCommandCenter } from "../repositories/city-command-center.repository";
import { serviceStandardsOverview, updateServiceStandards } from "../repositories/service-standards.repository";
import { updateServiceStandardsSchema } from "../validators/service-standards.validator";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";

export async function getCommandCenterSummaryHandler(req: Request, res: Response) {
  const organizationId = operationalOrganizationScope(req);
  const summary = await getCommandCenterSummary(organizationId ?? null);
  return res.status(200).json({
    success: true,
    message: "Command center summary fetched successfully",
    data: summary,
  });
}

/** City-wide live control room for KCCA. Never organization-scoped: route is limited to city roles. */
export async function getCityCommandCenterHandler(_req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    success: true,
    message: "City command center fetched",
    data: await getCityCommandCenter(),
  });
}

export async function getServiceStandardsHandler(_req: Request, res: Response) {
  try {
    return res.json({ success: true, message: "Service standards fetched", data: await serviceStandardsOverview() });
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") {
      return res.status(503).json({ success: false, message: "Service standards are not set up yet. Apply database migration 091." });
    }
    throw error;
  }
}

export async function putServiceStandardsHandler(req: Request, res: Response) {
  const input = updateServiceStandardsSchema.parse(req.body);
  const changed = await updateServiceStandards((req as AuthenticatedRequest).auth!.userId, input.standards, input.reason);
  return res.json({
    success: true,
    message: `${changed} service standard${changed === 1 ? "" : "s"} updated. The command centre uses the new standard from its next refresh.`,
    data: await serviceStandardsOverview(),
  });
}
