import { z } from "zod";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month like 2026-10");
const stream = z.string().regex(/^[a-z_]{2,30}$/);

export const baselineRangeSchema = z.object({ from: month, to: month }).refine(v => v.from <= v.to, { path: ["to"], message: "The last month must be on or after the first" });

export const loadListSchema = z.object({
  from: z.iso.date(), to: z.iso.date(),
  composition: z.enum(["all", "missing", "recorded"]).default("all"),
}).refine(v => v.from <= v.to, { path: ["to"], message: "The end date must be on or after the start date" })
  .refine(v => Date.parse(v.to) - Date.parse(v.from) <= 92 * 86400000, { path: ["to"], message: "Choose up to three months of loads" });

const shares = z.record(stream, z.number().positive().max(100))
  .refine(s => Object.keys(s).length > 0, "Give at least one stream")
  .refine(s => Math.abs(Object.values(s).reduce((n, v) => n + v, 0) - 100) <= 0.05, "The shares must add up to 100%");

export const compositionSchema = z.object({
  method: z.enum(["visual_estimate", "sample_sort"]),
  sampleKg: z.number().positive().max(100000).optional(),
  notes: z.string().trim().max(500).optional(),
  shares,
}).refine(v => v.method !== "sample_sort" || v.sampleKg !== undefined, { path: ["sampleKg"], message: "Give the weight of the sorted sample" });

const fraction = z.number().gt(0).max(1);
export const factorSetSchema = z.object({
  methodology: z.string().trim().min(5).max(2000),
  docf: fraction, mcf: fraction, methaneFraction: fraction,
  oxidation: z.number().min(0).lt(1),
  gwpCh4: z.number().positive().max(1000),
  changeSummary: z.string().trim().min(5, "Say what changed and why").max(300),
  streams: z.record(stream, z.object({ doc: z.number().min(0).max(1), defaultSharePct: z.number().min(0).max(100) })),
}).refine(v => Math.abs(Object.values(v.streams).reduce((n, s) => n + s.defaultSharePct, 0) - 100) <= 0.05,
  { path: ["streams"], message: "The assumed composition must add up to 100%" });

export const certificateCodeSchema = z.string().trim().toUpperCase().regex(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
export const ticketIdSchema = z.string().uuid();
