import { z } from "zod";

export const completeRouteStopSchema = z.object({
  collectedWeightKg: z.number().nonnegative().optional(),
  completionNotes: z.string().trim().max(1000).optional(),
  evidenceUrl: z.string().url().max(1000).optional(),
});

export const cancelCollectionRouteSchema = z.object({
  reason: z.enum([
    "operational_delay",
    "vehicle_breakdown",
    "driver_unavailable",
    "safety_issue",
    "weather",
    "service_change",
    "other",
  ]),
  notes: z.string().trim().min(3, "Explain why this route is being cancelled").max(1000),
});
