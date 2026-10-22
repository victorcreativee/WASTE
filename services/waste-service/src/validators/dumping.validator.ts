import { z } from "zod";
import { SIZES, WASTE_TYPES } from "../services/dumping.rules";

const photo = z.string().max(2_800_000, "The photo must be 2 MB or smaller").regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, "Use a JPG, PNG or WebP photo");
const note = (message: string, min = 5) => z.string().trim().min(min, message).max(2000);
const date = z.string().date("Use a date in the form YYYY-MM-DD");

export const reportSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  landmark: z.string().trim().max(300).optional(),
  divisionId: z.string().uuid().optional(),
  description: note("Describe what was dumped"),
  photo: photo.optional(),
}).strict();

export const verifySchema = z.object({
  divisionId: z.string().uuid().optional(),
  size: z.enum(SIZES, "Choose the size"),
  wasteTypes: z.array(z.enum(WASTE_TYPES)).min(1, "Choose at least one kind of waste").max(WASTE_TYPES.length),
  hazardous: z.boolean().default(false),
  note: note("Record what the inspection found"),
  photo: photo.optional(),
}).strict();

export const dismissSchema = z.object({ reason: note("Say why the report is closed") }).strict();

export const responsibilitySchema = z.object({
  organizationId: z.string().uuid().nullable(),
  basis: z.string().trim().max(2000).optional(),
}).strict();

export const orderSchema = z.object({
  organizationId: z.string().uuid().nullable(),
  dueOn: date.optional(),
  note: z.string().trim().max(2000).optional(),
}).strict();

export const confirmSchema = z.object({ note: note("Record what KCCA found at the site", 3), photo: photo.optional() }).strict();
export const rejectSchema = z.object({ reason: note("Say what is still wrong"), dueOn: date.optional() }).strict();
export const cleanupReportSchema = z.object({ note: note("Describe the cleanup", 3), photo: photo }).strict();
