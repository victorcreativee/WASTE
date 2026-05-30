import {
  createOrganization,
  findOrganizationById,
  findOrganizations,
} from "../repositories/organization.repository";
import { CreateOrganizationInput } from "../validators/organization.validator";

export async function listOrganizations() {
  return findOrganizations();
}

export async function getOrganization(id: string) {
  const organization = await findOrganizationById(id);

  if (!organization) {
    const error = new Error("Organization not found");
    (error as any).statusCode = 404;
    throw error;
  }

  return organization;
}

export async function addOrganization(input: CreateOrganizationInput) {
  return createOrganization(input);
}
