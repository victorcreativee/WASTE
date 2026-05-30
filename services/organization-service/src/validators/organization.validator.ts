import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().min(2, "Organization name is required"),
  type: z.enum([
    "kcca",
    "waste_collection_company",
    "recycling_company",
    "processing_plant",
    "environment_agency",
    "business",
    "citizen_group",
    "system",
  ]),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
