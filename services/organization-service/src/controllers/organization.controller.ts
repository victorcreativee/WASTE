import { Request, Response } from "express";
import { createOrganizationSchema } from "../validators/organization.validator";
import {
  addOrganization,
  getOrganization,
  listOrganizations,
} from "../services/organization.service";

export async function getOrganizations(req: Request, res: Response) {
  try {
    const organizations = await listOrganizations();

    return res.status(200).json({
      success: true,
      message: "Organizations fetched successfully",
      data: organizations,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to fetch organizations",
    });
  }
}

export async function getOrganizationById(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!id || Array.isArray(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid organization id",
      });
    }

    const organization = await getOrganization(id);

    return res.status(200).json({
      success: true,
      message: "Organization fetched successfully",
      data: organization,
    });
  } catch (error) {
    const statusCode = (error as any).statusCode || 500;

    return res.status(statusCode).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to fetch organization",
    });
  }
}

export async function createOrganizationHandler(req: Request, res: Response) {
  try {
    const input = createOrganizationSchema.parse(req.body);
    const organization = await addOrganization(input);

    return res.status(201).json({
      success: true,
      message: "Organization created successfully",
      data: organization,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to create organization",
    });
  }
}
