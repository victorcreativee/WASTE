import { operationalOrganizationScope } from "../middlewares/organization-scope";
import { Request, Response } from "express";
import { getCommandCenterSummary } from "../repositories/command-center.repository";

export async function getCommandCenterSummaryHandler(req: Request, res: Response) {
  const organizationId = operationalOrganizationScope(req);
  const summary = await getCommandCenterSummary(organizationId ?? null);
  return res.status(200).json({
    success: true,
    message: "Command center summary fetched successfully",
    data: summary,
  });
}
