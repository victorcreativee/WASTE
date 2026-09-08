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
  approvedPermitId: z.string().uuid().optional(),
}).superRefine((value,ctx)=>{if(value.type==='waste_collection_company'&&!value.approvedPermitId)ctx.addIssue({code:'custom',path:['approvedPermitId'],message:'Select a KCCA-approved permit'});});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
