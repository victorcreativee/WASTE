import { z } from "zod";

export const upsertCustomerServiceSchema = z.object({
  customerType: z.enum(["residential", "commercial", "office_business", "industrial"]),
  label: z.string().trim().min(2).max(100).default("Primary location"),
  address: z.string().trim().min(5).max(500),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const updateCustomerServiceStatusSchema = z.object({
  status: z.enum(["active", "suspended", "inactive"]),
});
