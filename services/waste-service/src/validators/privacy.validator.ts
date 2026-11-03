import { z } from "zod";

export const consentSchema = z.object({
  decision: z.enum(["granted", "declined", "withdrawn"]),
  noticeVersion: z.number().int().positive(),
});
export const retentionSchema = z.object({
  rawPointDays: z.number().int().min(30, "Keep positions for at least 30 days").max(730, "Keep positions for at most 2 years"),
});
export const noticeSchema = z.object({
  title: z.string().trim().min(3).max(150),
  body: z.string().trim().min(50, "Write the full notice drivers will read").max(8000),
  changeSummary: z.string().trim().min(5, "Say what changed, for drivers who read the old version").max(300),
});
export const holdSchema = z.object({
  tripNumber: z.string().trim().min(3).max(60),
  reason: z.string().trim().min(5, "Say why this trip's positions must be kept").max(500),
});
export const releaseSchema = z.object({ note: z.string().trim().min(5, "Say why the hold can be released").max(500) });
