import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");
export const auditListQuerySchema = z.object({
  from: date.optional(), to: date.optional(),
  table: z.string().regex(/^[a-z_]{2,63}$/, "Unknown record type").optional(),
  action: z.enum(["insert", "update", "delete"]).optional(),
  actorId: z.string().uuid().optional(), recordId: z.string().trim().max(80).optional(),
  organizationId: z.string().uuid().optional(),
  origin: z.enum(["app", "direct"]).optional(),
  search: z.string().trim().max(100).optional(),
}).refine(q => !q.from || !q.to || q.from <= q.to, { path: ["to"], message: "The end date is before the start date" });
export const auditIdSchema = z.string().regex(/^\d{1,18}$/, "Unknown audit entry");
