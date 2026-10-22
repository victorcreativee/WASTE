import { z } from "zod";

const weight = z.coerce.number().positive("Enter a weight above 0").max(100000000);
const date = z.string().date("Use a date in the form YYYY-MM-DD");
const text = (max: number) => z.string().trim().max(max).optional().transform(value => value || undefined);
const category = z.enum(["plastic", "paper", "metal", "glass", "organic", "textile", "other"]);

export const intakeSchema = z.object({
  sourceSaleId: z.string().uuid().optional(),
  supplierName: text(160),
  materialCategory: category.optional(),
  materialDescription: text(160),
  declaredKg: weight.optional(),
  receivedKg: weight,
  rejectedKg: z.coerce.number().min(0).max(100000000).default(0),
  receivedOn: date,
  vehicleRegistration: text(40),
  notes: text(1000),
}).strict().superRefine((value, ctx) => {
  if (!value.sourceSaleId && (!value.supplierName || !value.materialCategory || !value.materialDescription)) {
    ctx.addIssue({ code: "custom", path: ["supplierName"], message: "Name the supplier, material category and material, or receive an expected delivery" });
  }
});

export const voidIntakeSchema = z.object({ reason: z.string().trim().min(5, "Explain why the intake is voided").max(500) }).strict();

export const batchSchema = z.object({
  processedOn: date,
  productName: z.string().trim().min(2, "Name the product made").max(120),
  inputs: z.array(z.object({ intakeId: z.string().uuid(), kg: weight }).strict()).min(1, "Choose at least one intake").max(50),
  outputKg: z.coerce.number().min(0).max(100000000),
  residueKg: z.coerce.number().min(0).max(100000000).default(0),
  residueDisposal: text(200),
  notes: text(1000),
}).strict();

export const dispatchSchema = z.object({
  batchId: z.string().uuid().optional(),
  productName: z.string().trim().min(2).max(120),
  quantityKg: weight,
  buyerName: z.string().trim().min(2, "Name the buyer").max(160),
  destination: text(200),
  dispatchedOn: date,
  notes: text(1000),
}).strict();
