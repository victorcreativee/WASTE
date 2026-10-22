import { z } from "zod";

export const createCitizenIssueSchema = z.object({
  category: z.enum([
    "illegal_dumping",
    "missed_collection",
    "overflowing_bin",
    "pickup_request",
  ]),
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().min(10).max(4000),
  address: z.string().trim().max(500).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  // Illegal dumping only: a photo and the division, passed on to the dumping site the report joins.
  photo: z.string().max(2_800_000, "The photo must be 2 MB or smaller").regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, "Use a JPG, PNG or WebP photo").optional(),
  divisionId: z.string().uuid().optional(),
}).refine(
  (value) =>
    (value.latitude === undefined && value.longitude === undefined) ||
    (value.latitude !== undefined && value.longitude !== undefined),
  { message: "Latitude and longitude must be provided together" }
);

export const assignCitizenIssueSchema = z.object({
  organizationId: z.string().uuid(),
});

export const updateCitizenIssueStatusSchema = z.object({
  status: z.enum(["triaged", "assigned", "in_progress", "resolved", "rejected"]),
  resolutionNotes: z.string().trim().max(4000).optional(),
});

export type CreateCitizenIssueInput = z.infer<typeof createCitizenIssueSchema>;
export type UpdateCitizenIssueStatusInput = z.infer<typeof updateCitizenIssueStatusSchema>;
