import { z } from "zod";

const customerType = z.enum(["residential", "commercial", "office_business", "industrial"]);
export const tariffBandSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,30}$/, "Use 2 to 30 letters, digits or _"),
  name: z.string().trim().min(2).max(120),
  customerType,
  description: z.string().trim().max(1000).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export const tariffBandUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean(),
});
export const tariffRateSchema = z.object({
  monthlyFeeUgx: z.number().int().min(0).max(100_000_000),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date"),
  noticeReference: z.string().trim().max(120).optional(),
});
