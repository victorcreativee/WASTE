import { z } from "zod";

export const createJobProblemSchema = z.object({
  category: z.enum([
    "blocked_access",
    "truck_problem",
    "unsafe_site",
    "waste_mismatch",
    "other",
  ]),
  description: z.string().trim().min(5).max(1000),
});

export const updateJobProblemSchema = z.object({
  status: z.enum(["acknowledged", "resolved"]),
  resolutionNotes: z.string().trim().max(1000).optional(),
});
