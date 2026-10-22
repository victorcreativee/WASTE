import { z } from "zod";
import { ISSUE_CATEGORIES } from "../services/city-command-center.service";

export const updateServiceStandardsSchema = z
  .object({
    standards: z
      .array(
        z.object({
          category: z.enum(ISSUE_CATEGORIES),
          responseHours: z.number().int("Use whole hours").min(1, "At least 1 hour").max(720, "At most 30 days (720 hours)"),
        })
      )
      .min(1)
      .max(ISSUE_CATEGORIES.length)
      .refine((items) => new Set(items.map((item) => item.category)).size === items.length, "Each category may appear once"),
    reason: z.string().trim().min(5, "Explain why the standard is changing").max(500),
  })
  .strict();
