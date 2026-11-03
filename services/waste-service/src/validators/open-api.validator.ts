import { z } from "zod";
import { API_SCOPES } from "../services/api-keys";

const days = (max: number) => (v: { from: string; to: string }) => Date.parse(v.to) - Date.parse(v.from) <= max * 86400000;
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-10");

export const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});
export const dateRangeSchema = z.object({ from: z.iso.date(), to: z.iso.date() })
  .refine(v => v.from <= v.to, { path: ["to"], message: "to must be on or after from" })
  .refine(days(92), { path: ["to"], message: "Ask for at most 92 days at a time" });
export const monthRangeSchema = z.object({ from: month, to: month })
  .refine(v => v.from <= v.to, { path: ["to"], message: "to must be on or after from" });
export const receiptDaySchema = z.object({ date: z.iso.date() });

export const createKeySchema = z.object({
  name: z.string().trim().min(3, "Name the key after the system that will use it").max(100),
  scopes: z.array(z.enum(API_SCOPES)).min(1, "Choose at least one kind of data").transform(s => [...new Set(s)]),
  expiresInDays: z.number().int().min(30).max(730).default(365),
  rateLimitPerMinute: z.number().int().min(1).max(600).optional(),
  holderName: z.string().trim().min(2).max(150).optional(),
  contactEmail: z.email().max(200).optional(),
  purpose: z.string().trim().min(10, "Say what the partner will use the data for").max(500).optional(),
});
export const revokeKeySchema = z.object({ reason: z.string().trim().min(5, "Say why the key is revoked").max(300) });
export const keyIdSchema = z.string().uuid();
