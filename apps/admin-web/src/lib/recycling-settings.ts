// Company settings served by the waste service (Recycling settings page). Forms read their lists and labels from
// here; the fallbacks keep a form usable before the settings have loaded.
export type SettingOption = { code: string; label: string; active: boolean; builtIn?: boolean };
export type CostKind = "purchase" | "sorting" | "sale";
export type RecyclingSettings = {
  expenseCategories: SettingOption[];
  qualityGrades: SettingOption[];
  lossReasons: string[];
  costFields: Record<CostKind, Record<string, { label: string; visible: boolean }>>;
  rules: { supplierCreditDays: number; buyerPaymentDays: number; dueSoonDays: number };
};
export const costField = (settings: RecyclingSettings | undefined, kind: CostKind, key: string, fallback: string) =>
  settings?.costFields?.[kind]?.[key] ?? { label: fallback, visible: true };
/** Options to offer: the turned-on ones, plus the record's current value so an edit never loses it. */
export const activeOptions = (options: SettingOption[] | undefined, current?: string | null) =>
  (options ?? []).filter(o => o.active || o.code === current);
export const optionLabel = (options: SettingOption[] | undefined, code: string | null | undefined) =>
  options?.find(o => o.code === code)?.label ?? String(code ?? "").replaceAll("_", " ");
