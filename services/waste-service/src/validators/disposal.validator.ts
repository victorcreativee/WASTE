import { z } from "zod";
import { EXPLANATION_REASONS } from "../services/disposal.rules";

const reasons = Object.keys(EXPLANATION_REASONS) as [keyof typeof EXPLANATION_REASONS, ...Array<keyof typeof EXPLANATION_REASONS>];

export const explanationSchema = z.object({
  reason: z.enum(reasons, "Choose a reason"),
  details: z.string().trim().min(5, "Describe what happened").max(2000),
  relatedTicketId: z.string().uuid().optional().nullable(),
}).strict();

export const linkTicketSchema = z.object({ tripId: z.string().uuid("Choose a trip") }).strict();

export const reviewSchema = z.object({
  action: z.enum(["accept", "reject"]),
  note: z.string().trim().max(1000).optional(),
}).strict().refine(value => value.action === "accept" || (value.note?.length ?? 0) >= 5, { message: "Say why the explanation is rejected", path: ["note"] });

export const acceptWithoutTripSchema = z.object({ reason: z.string().trim().min(5, "Say why this load has no trip").max(1000) }).strict();

export const facilitySchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/, "Use 2–20 capital letters, digits or _"),
  name: z.string().trim().min(2).max(160),
  kind: z.enum(["landfill", "transfer_station", "composting", "materials_recovery"]),
  isActive: z.boolean().default(true),
}).strict();
