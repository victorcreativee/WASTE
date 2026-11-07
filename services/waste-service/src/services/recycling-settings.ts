import { z } from "zod";

/**
 * Company settings that used to be fixed in code. Stored values are merged over these defaults, so a company that
 * never opens the settings page keeps today's behaviour, and new defaults reach every company automatically.
 */
type Option = { code: string; label: string; active: boolean; builtIn?: boolean };
type CostField = { label: string; visible: boolean };

export const BUILT_IN_EXPENSE_CATEGORIES: Array<[string, string]> = [
  ["food", "Food"], ["transport", "Worker transport"], ["daily_wages", "Daily worker wages"], ["worker_credit", "Worker credit / advance"],
  ["fuel", "Fuel"], ["maintenance", "Maintenance"], ["payroll", "Payroll"], ["equipment", "Equipment"], ["utilities", "Utilities"],
  ["disposal_fees", "Disposal fees"], ["office", "Office"], ["other", "Other"],
];
export const BUILT_IN_QUALITY: Array<[string, string]> = [["sorted", "Sorted"], ["clean", "Clean"], ["mixed", "Mixed"], ["contaminated", "Contaminated"]];
export const COST_FIELDS = {
  purchase: [["workerWagesUgx", "Worker wages"], ["foodUgx", "Food"], ["transportUgx", "Transport"], ["driverFeeUgx", "Driver fee"], ["otherExpenseUgx", "Other expenses"]],
  sorting: [["workerWagesUgx", "Worker wages"], ["utilitiesUgx", "Power / utilities"], ["transportUgx", "Processing transport"], ["consumablesUgx", "Bags and consumables"], ["otherExpenseUgx", "Other processing cost"]],
  sale: [["workerWagesUgx", "Worker wages"], ["foodUgx", "Food"], ["transportUgx", "Transport"], ["otherExpenseUgx", "Other expenses"]],
} as const;
export const DEFAULT_LOSS_REASONS = ["Damaged in storage", "Moisture / weight loss", "Theft", "Counting error", "Contaminated, thrown away"];
export const DEFAULT_RULES = { supplierCreditDays: 30, buyerPaymentDays: 30, dueSoonDays: 7 };

export type RecyclingSettings = {
  expenseCategories: Option[];
  qualityGrades: Option[];
  lossReasons: string[];
  costFields: { [K in keyof typeof COST_FIELDS]: Record<string, CostField> };
  rules: typeof DEFAULT_RULES;
};

const options = (builtIn: Array<[string, string]>, stored: unknown): Option[] => {
  const saved = new Map((Array.isArray(stored) ? stored : []).filter((o: any) => o && typeof o.code === "string").map((o: any) => [o.code, o]));
  const base = builtIn.map(([code, label]) => ({ code, label: String(saved.get(code)?.label ?? label), active: saved.get(code)?.active !== false, builtIn: true }));
  const custom = [...saved.values()].filter((o: any) => !builtIn.some(([code]) => code === o.code)).map((o: any) => ({ code: o.code, label: String(o.label ?? o.code), active: o.active !== false }));
  return [...base, ...custom];
};

/** The full settings for a company: what it saved, with defaults for everything else. */
export function resolveSettings(stored: any = {}): RecyclingSettings {
  const costFields = Object.fromEntries(Object.entries(COST_FIELDS).map(([kind, fields]) => [kind, Object.fromEntries(fields.map(([key, label]) => {
    const saved = stored?.costFields?.[kind]?.[key];
    return [key, { label: typeof saved?.label === "string" && saved.label.trim() ? saved.label.trim() : label, visible: saved?.visible !== false }];
  }))])) as RecyclingSettings["costFields"];
  const rules = { ...DEFAULT_RULES };
  for (const key of Object.keys(DEFAULT_RULES) as Array<keyof typeof DEFAULT_RULES>) {
    const value = Number(stored?.rules?.[key]);
    if (Number.isInteger(value) && value >= 0 && value <= 365) rules[key] = value;
  }
  return {
    expenseCategories: options(BUILT_IN_EXPENSE_CATEGORIES, stored?.expenseCategories),
    qualityGrades: options(BUILT_IN_QUALITY, stored?.qualityGrades),
    lossReasons: Array.isArray(stored?.lossReasons) ? stored.lossReasons.filter((r: unknown) => typeof r === "string" && r.trim()).map((r: string) => r.trim()) : DEFAULT_LOSS_REASONS,
    costFields,
    rules,
  };
}

/** A short code made from a label, used to store a new category or grade. */
export const codeFor = (label: string) => label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);

const label = z.string().trim().min(2, "Each name needs at least 2 characters").max(60);
const option = z.object({ code: z.string().regex(/^[a-z0-9_]{2,30}$/).optional(), label, active: z.boolean() });
const costField = z.object({ label: z.string().trim().min(2).max(40), visible: z.boolean() });
const days = z.number().int().min(0).max(365);
export const settingsSchema = z.object({
  expenseCategories: z.array(option).max(60).optional(),
  qualityGrades: z.array(option).max(30).optional(),
  lossReasons: z.array(z.string().trim().min(2).max(80)).max(30).optional(),
  costFields: z.object(Object.fromEntries(Object.entries(COST_FIELDS).map(([kind, fields]) => [kind, z.object(Object.fromEntries(fields.map(([key]) => [key, costField.optional()]))).optional()]))).optional(),
  rules: z.object({ supplierCreditDays: days, buyerPaymentDays: days, dueSoonDays: days.max(90) }).partial().optional(),
});

/** Checks a submitted change and gives every new category or grade a code. Built-in codes cannot be removed, only turned off. */
export function normaliseSettings(input: z.infer<typeof settingsSchema>, current: RecyclingSettings) {
  const list = (submitted: z.infer<typeof option>[] | undefined, existing: Option[], what: string) => {
    if (!submitted) return undefined;
    const used = new Set<string>(), out: Array<{ code: string; label: string; active: boolean }> = [];
    for (const o of submitted) {
      const code = o.code ?? codeFor(o.label);
      if (code.length < 2) throw Object.assign(new Error(`"${o.label}" cannot be used as a ${what} name`), { statusCode: 400 });
      if (used.has(code)) throw Object.assign(new Error(`The ${what} "${o.label}" is listed twice`), { statusCode: 400 });
      used.add(code); out.push({ code, label: o.label, active: o.active });
    }
    for (const o of existing.filter(o => o.builtIn && !used.has(o.code))) out.push({ code: o.code, label: o.label, active: o.active });
    if (!out.some(o => o.active)) throw Object.assign(new Error(`Keep at least one ${what} turned on`), { statusCode: 400 });
    return out;
  };
  return {
    ...(input.expenseCategories && { expenseCategories: list(input.expenseCategories, current.expenseCategories, "expense category") }),
    ...(input.qualityGrades && { qualityGrades: list(input.qualityGrades, current.qualityGrades, "quality grade") }),
    ...(input.lossReasons && { lossReasons: [...new Set(input.lossReasons)] }),
    ...(input.costFields && { costFields: input.costFields }),
    ...(input.rules && { rules: input.rules }),
  };
}
