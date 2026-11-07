// Company settings from the Recycling settings page, sent with the recycling workspace. A phone still holding
// workspace data saved before settings existed falls back to these defaults, which match the server's.
export type SettingOption = { code: string; label: string; active: boolean };
export type CostKind = "purchase" | "sorting" | "sale";
export type RecyclingSettings = {
  expenseCategories?: SettingOption[];
  qualityGrades?: SettingOption[];
  lossReasons?: string[];
  costFields?: Partial<Record<CostKind, Record<string, { label: string; visible: boolean }>>>;
};
const options = (pairs: [string, string][]): SettingOption[] => pairs.map(([code, label]) => ({ code, label, active: true }));
export const DEFAULT_EXPENSE_CATEGORIES = options([["food", "Food"], ["transport", "Worker transport"], ["daily_wages", "Daily worker wages"], ["worker_credit", "Worker credit / advance"], ["fuel", "Fuel"], ["maintenance", "Maintenance"], ["payroll", "Payroll"], ["equipment", "Equipment"], ["utilities", "Utilities"], ["disposal_fees", "Disposal fees"], ["office", "Office"], ["other", "Other"]]);
export const DEFAULT_QUALITY = options([["sorted", "Sorted"], ["clean", "Clean"], ["mixed", "Mixed"], ["contaminated", "Contaminated"]]);

const list = (value: unknown, fallback: SettingOption[]) =>
  Array.isArray(value) && value.length ? value.filter((o): o is SettingOption => Boolean(o) && typeof o.code === "string" && typeof o.label === "string") : fallback;
/** Options to offer: turned-on ones, plus the record's current value so an edit never loses it. */
export const expenseCategories = (settings?: RecyclingSettings | null) => list(settings?.expenseCategories, DEFAULT_EXPENSE_CATEGORIES).filter(o => o.active !== false);
export const qualityGrades = (settings?: RecyclingSettings | null, current?: string) => list(settings?.qualityGrades, DEFAULT_QUALITY).filter(o => o.active !== false || o.code === current);
export const qualityLabel = (settings: RecyclingSettings | null | undefined, code: string) => list(settings?.qualityGrades, DEFAULT_QUALITY).find(o => o.code === code)?.label ?? code;
export const lossReasons = (settings?: RecyclingSettings | null) => Array.isArray(settings?.lossReasons) ? settings!.lossReasons!.filter(r => typeof r === "string" && r.trim()) : [];
export const costField = (settings: RecyclingSettings | null | undefined, kind: CostKind, key: string, fallback: string) => {
  const saved = settings?.costFields?.[kind]?.[key];
  return { label: typeof saved?.label === "string" && saved.label.trim() ? saved.label : fallback, visible: saved?.visible !== false };
};
