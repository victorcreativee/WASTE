// Recycling factory rules: chain of custody between a recycler's sale and the factory's intake, processing yield, and
// how a processing batch draws on received material. Pure so KCCA can review the thresholds and tests can pin them.
import { daysBetween } from "./permit-lifecycle.rules";

export const CUSTODY_RULES = {
  /** A delivery not received this many days after the sale is overdue. */
  awaitDays: 7,
  /** Received weight below the sold weight by more than this share (and at least minShortfallKg) is a shortfall. */
  shortfallShare: 0.05,
  minShortfallKg: 10,
};

export type CustodyState = "awaiting" | "overdue" | "received" | "shortfall";

export function custodyState(delivery: { sold_kg: number; sold_on: string; received_kg: number | null }, today: string): CustodyState {
  if (delivery.received_kg === null) return daysBetween(delivery.sold_on, today) > CUSTODY_RULES.awaitDays ? "overdue" : "awaiting";
  const missing = delivery.sold_kg - delivery.received_kg;
  return missing >= CUSTODY_RULES.minShortfallKg && missing / delivery.sold_kg > CUSTODY_RULES.shortfallShare ? "shortfall" : "received";
}

/** Output as a share of input, one decimal place; null without input. */
export function yieldRate(outputKg: number, inputKg: number): number | null {
  return inputKg > 0 ? Math.round((outputKg / inputKg) * 1000) / 10 : null;
}

export type BatchInput = { intakeId: string; kg: number };
export type IntakeStock = { id: string; available_kg: number; status: string; material_category: string };

/**
 * Checks a batch's draw on received material. Returns the batch input weight, or throws a 400 with the reason.
 * Each intake may appear once, must be received (not voided) and must hold enough remaining material.
 */
export function validateBatchInputs(inputs: BatchInput[], stock: IntakeStock[], outputKg: number, residueKg: number): number {
  const fail = (message: string) => { throw Object.assign(new Error(message), { statusCode: 400 }); };
  if (!inputs.length) fail("Choose at least one intake to process");
  if (new Set(inputs.map(input => input.intakeId)).size !== inputs.length) fail("List each intake only once");
  const byId = new Map(stock.map(item => [item.id, item]));
  let total = 0;
  for (const input of inputs) {
    const intake = byId.get(input.intakeId);
    if (!intake) fail("One of the chosen intakes does not belong to this factory");
    if (intake!.status !== "received") fail("A voided intake cannot be processed");
    if (!(input.kg > 0)) fail("Each intake must contribute more than 0 kg");
    if (input.kg > intake!.available_kg + 1e-9) fail(`Only ${intake!.available_kg.toLocaleString("en-GB")} kg remain on one of the chosen intakes`);
    total += input.kg;
  }
  total = Math.round(total * 100) / 100;
  if (outputKg < 0 || residueKg < 0) fail("Output and residue cannot be negative");
  if (outputKg + residueKg > total + 1e-9) fail(`Output and residue (${(outputKg + residueKg).toLocaleString("en-GB")} kg) cannot exceed the material put in (${total.toLocaleString("en-GB")} kg)`);
  return total;
}
